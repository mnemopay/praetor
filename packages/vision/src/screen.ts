/**
 * PraetorScreen — Praetor-native screen capture.
 *
 * No third-party libs in the default codepath. On each platform Praetor
 * shells out to the OS's built-in capture tool:
 *
 *   - Windows  → `powershell.exe` + `System.Drawing` (always available)
 *   - macOS    → `screencapture -x -t png` (always available)
 *   - Linux    → `grim` (Wayland) → `gnome-screenshot` → `spectacle` → `import`
 *
 * Per `feedback_praetor_native_tools.md` — `screenshot-desktop` is removed
 * from the default codepath. Custom backends can still be plugged in via
 * `attachAdapter(...)` for environments that need a specific tool.
 *
 * This module also exposes a streaming API (`streamFrames`) so the
 * "watch what the agent is doing" surface can pump screenshots into the
 * activity bus at a configurable interval without re-implementing the
 * capture loop in every caller.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type ScreenBackend = "powershell" | "macos-screencapture" | "linux-grim" | "linux-gnome" | "linux-spectacle" | "linux-import" | "adapter";

export interface ScreenFrame {
  /** PNG bytes. */
  pngBuffer: Buffer;
  /** Capture wall-clock timestamp. */
  ts: string;
  /** Which backend produced the frame. */
  backend: ScreenBackend;
}

export interface ScreenAdapter {
  /** Display-friendly identifier for telemetry. */
  name: string;
  capture(): Promise<Buffer>;
}

function powershellScript(targetPath: string): string {
  // Path is inlined because `-Command` does not bind a $args array. Forward
  // slashes are safe; backslashes need doubling to survive the PowerShell
  // single-quote tokenizer is not actually escape-aware, so use the raw
  // literal-quoted form: PowerShell single-quoted strings treat everything
  // verbatim except the embedded single-quote, which doubles.
  const safe = targetPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
    "$g=[System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)",
    `$bmp.Save('${safe}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    "$g.Dispose(); $bmp.Dispose()",
  ].join("; ");
}

interface SpawnOpts {
  /** Override for tests — return a synthetic exit + buffer. */
  spawnImpl?: (cmd: string, args: string[]) => Promise<{ code: number; stderr: string }>;
  /** Override the platform. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Tmp-dir factory; tests inject a deterministic path. */
  mktmp?: () => string;
}

export interface PraetorScreenOptions extends SpawnOpts {
  /** Pluggable adapter — when present, takes priority over OS detection. */
  adapter?: ScreenAdapter;
  /** Optional probe order override (Linux only). */
  linuxBackends?: ReadonlyArray<"grim" | "gnome-screenshot" | "spectacle" | "import">;
}

export class PraetorScreen {
  private resolvedBackend: ScreenBackend | null = null;
  private resolvedLinuxCmd: string | null = null;
  constructor(private readonly opts: PraetorScreenOptions = {}) {}

  /** Returns the backend that will be used. Detects on first call. */
  async detectBackend(): Promise<ScreenBackend> {
    if (this.resolvedBackend) return this.resolvedBackend;
    if (this.opts.adapter) {
      this.resolvedBackend = "adapter";
      return this.resolvedBackend;
    }
    const platform = this.opts.platform ?? process.platform;
    if (platform === "win32") {
      this.resolvedBackend = "powershell";
      return this.resolvedBackend;
    }
    if (platform === "darwin") {
      this.resolvedBackend = "macos-screencapture";
      return this.resolvedBackend;
    }
    // Linux: probe each candidate in order; first one that exits 0 wins.
    const probeOrder = this.opts.linuxBackends ?? ["grim", "gnome-screenshot", "spectacle", "import"];
    for (const cmd of probeOrder) {
      if (await this.commandExists(cmd)) {
        this.resolvedLinuxCmd = cmd;
        switch (cmd) {
          case "grim": this.resolvedBackend = "linux-grim"; break;
          case "gnome-screenshot": this.resolvedBackend = "linux-gnome"; break;
          case "spectacle": this.resolvedBackend = "linux-spectacle"; break;
          case "import": this.resolvedBackend = "linux-import"; break;
        }
        return this.resolvedBackend!;
      }
    }
    throw new Error(
      "PraetorScreen: no Linux capture backend found (looked for grim, gnome-screenshot, spectacle, import). Install one or attach a custom ScreenAdapter.",
    );
  }

  /** Capture one frame. Returns the raw PNG buffer. */
  async capture(): Promise<ScreenFrame> {
    const backend = await this.detectBackend();
    const ts = new Date().toISOString();
    if (backend === "adapter") {
      const buf = await this.opts.adapter!.capture();
      return { pngBuffer: buf, ts, backend };
    }
    const tmp = this.tmpPath();
    try {
      if (backend === "powershell") {
        await this.run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", powershellScript(tmp)]);
      } else if (backend === "macos-screencapture") {
        await this.run("screencapture", ["-x", "-t", "png", tmp]);
      } else if (backend === "linux-grim") {
        await this.run("grim", [tmp]);
      } else if (backend === "linux-gnome") {
        await this.run("gnome-screenshot", ["-f", tmp]);
      } else if (backend === "linux-spectacle") {
        await this.run("spectacle", ["-b", "-n", "-o", tmp]);
      } else if (backend === "linux-import") {
        await this.run("import", ["-window", "root", tmp]);
      }
      if (!existsSync(tmp)) {
        throw new Error(`PraetorScreen: ${backend} did not produce a file at ${tmp}`);
      }
      const pngBuffer = readFileSync(tmp);
      return { pngBuffer, ts, backend };
    } finally {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best-effort */ }
    }
  }

  /**
   * Stream frames at a configured cadence. Yields until `signal` is aborted.
   * Honors `intervalMs` between captures (subtracts capture time).
   */
  async *streamFrames(args: { intervalMs: number; signal?: AbortSignal }): AsyncGenerator<ScreenFrame> {
    const intervalMs = Math.max(50, args.intervalMs);
    while (!args.signal?.aborted) {
      const t0 = Date.now();
      let frame: ScreenFrame;
      try {
        frame = await this.capture();
      } catch (err) {
        // Surface the error to the caller; they decide whether to retry.
        throw err;
      }
      yield frame;
      if (args.signal?.aborted) return;
      const elapsed = Date.now() - t0;
      const wait = Math.max(0, intervalMs - elapsed);
      if (wait > 0) await sleepInterruptible(wait, args.signal);
    }
  }

  /** Plug in a custom capture backend at runtime. */
  attachAdapter(adapter: ScreenAdapter): void {
    this.opts.adapter = adapter;
    this.resolvedBackend = "adapter";
  }

  private async run(cmd: string, args: string[]): Promise<void> {
    const impl = this.opts.spawnImpl;
    const { code, stderr } = impl
      ? await impl(cmd, args)
      : await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
          const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
          const errChunks: Buffer[] = [];
          child.stderr.on("data", (d) => errChunks.push(d));
          child.on("error", (err) => reject(err));
          child.on("close", (c) => resolve({ code: c ?? -1, stderr: Buffer.concat(errChunks).toString("utf8") }));
        });
    if (code !== 0) {
      throw new Error(`PraetorScreen: ${cmd} exited ${code}: ${stderr.trim()}`);
    }
  }

  private async commandExists(cmd: string): Promise<boolean> {
    const impl = this.opts.spawnImpl;
    try {
      const { code } = impl
        ? await impl("which", [cmd])
        : await new Promise<{ code: number; stderr: string }>((resolve) => {
            const child = spawn("which", [cmd], { stdio: ["ignore", "ignore", "ignore"] });
            child.on("error", () => resolve({ code: 1, stderr: "" }));
            child.on("close", (c) => resolve({ code: c ?? 1, stderr: "" }));
          });
      return code === 0;
    } catch {
      return false;
    }
  }

  private tmpPath(): string {
    if (this.opts.mktmp) return this.opts.mktmp();
    const dir = mkdtempSync(join(tmpdir(), "praetor-screen-"));
    return join(dir, `${randomBytes(4).toString("hex")}.png`);
  }
}

function sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
