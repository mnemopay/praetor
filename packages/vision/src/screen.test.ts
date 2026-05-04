import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PraetorScreen, type ScreenAdapter } from "./screen.js";

describe("PraetorScreen — backend detection", () => {
  it("uses an attached adapter when supplied", async () => {
    const captured = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG signature start
    const adapter: ScreenAdapter = {
      name: "test",
      capture: async () => captured,
    };
    const screen = new PraetorScreen({ adapter });
    expect(await screen.detectBackend()).toBe("adapter");
    const frame = await screen.capture();
    expect(frame.backend).toBe("adapter");
    expect(frame.pngBuffer).toEqual(captured);
    expect(typeof frame.ts).toBe("string");
  });

  it("picks the powershell backend on win32", async () => {
    const screen = new PraetorScreen({ platform: "win32" });
    expect(await screen.detectBackend()).toBe("powershell");
  });

  it("picks screencapture on darwin", async () => {
    const screen = new PraetorScreen({ platform: "darwin" });
    expect(await screen.detectBackend()).toBe("macos-screencapture");
  });

  it("probes Linux backends in order and picks the first that exists", async () => {
    const tried: string[] = [];
    const screen = new PraetorScreen({
      platform: "linux",
      linuxBackends: ["grim", "gnome-screenshot", "spectacle", "import"],
      spawnImpl: async (cmd, args) => {
        if (cmd === "which") {
          tried.push(args[0]);
          return { code: args[0] === "spectacle" ? 0 : 1, stderr: "" };
        }
        return { code: 0, stderr: "" };
      },
    });
    expect(await screen.detectBackend()).toBe("linux-spectacle");
    expect(tried.slice(0, 3)).toEqual(["grim", "gnome-screenshot", "spectacle"]);
  });

  it("throws a helpful error when no Linux backend is found", async () => {
    const screen = new PraetorScreen({
      platform: "linux",
      spawnImpl: async () => ({ code: 1, stderr: "" }),
    });
    await expect(screen.detectBackend()).rejects.toThrow(/no Linux capture backend found/);
  });
});

describe("PraetorScreen — capture pipeline", () => {
  it("invokes the platform tool and reads back the produced file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "praetor-screen-test-"));
    const tmpPath = join(dir, "frame.png");
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad]);

    const screen = new PraetorScreen({
      platform: "darwin",
      mktmp: () => tmpPath,
      spawnImpl: async (cmd, args) => {
        // simulate `screencapture` writing the temp file
        if (cmd === "screencapture") {
          writeFileSync(args[args.length - 1], fakePng);
          return { code: 0, stderr: "" };
        }
        return { code: 1, stderr: "unknown cmd" };
      },
    });
    const frame = await screen.capture();
    expect(frame.backend).toBe("macos-screencapture");
    expect(frame.pngBuffer).toEqual(fakePng);
  });

  it("throws when the backend exits non-zero", async () => {
    const screen = new PraetorScreen({
      platform: "darwin",
      spawnImpl: async () => ({ code: 1, stderr: "screencapture: permission denied" }),
    });
    await expect(screen.capture()).rejects.toThrow(/permission denied/);
  });
});

describe("PraetorScreen — streaming", () => {
  it("yields multiple frames and stops on AbortSignal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "praetor-stream-"));
    const tmpPath = join(dir, "frame.png");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const screen = new PraetorScreen({
      platform: "darwin",
      mktmp: () => tmpPath,
      spawnImpl: async (cmd, args) => {
        if (cmd === "screencapture") {
          writeFileSync(args[args.length - 1], png);
          return { code: 0, stderr: "" };
        }
        return { code: 1, stderr: "" };
      },
    });

    const ac = new AbortController();
    const frames: number[] = [];
    const iter = screen.streamFrames({ intervalMs: 50, signal: ac.signal });
    let count = 0;
    for await (const _ of iter) {
      count += 1;
      frames.push(Date.now());
      if (count >= 3) ac.abort();
    }
    expect(count).toBe(3);
  });
});
