import type { Sandbox } from "@praetor/sandbox";

export class SysadminModule {
  constructor(private sandbox?: Sandbox) {}

  async runCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.sandbox) {
      const res = await this.sandbox.exec(command, { cwd });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    }
    // Fallback to local native (legacy)
    const { exec } = await import("node:child_process");
    return new Promise((resolve) => {
      exec(command, { cwd: cwd ?? process.cwd(), timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode: error ? (error.code ?? 1) : 0 });
      });
    });
  }

  async readFile(path: string): Promise<{ content: string; error?: string }> {
    try {
      if (this.sandbox) {
        const content = await this.sandbox.readFile(path);
        return { content };
      }
      const { readFile: fsReadFile } = await import("node:fs/promises");
      const content = await fsReadFile(path, "utf-8");
      return { content };
    } catch (err: any) {
      return { content: "", error: err.message };
    }
  }

  async writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.sandbox) {
        await this.sandbox.writeFile(path, content);
        return { success: true };
      }
      const { writeFile: fsWriteFile } = await import("node:fs/promises");
      await fsWriteFile(path, content, "utf-8");
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async listDir(path: string): Promise<{ items: { name: string; isDir: boolean }[]; error?: string }> {
    try {
      if (this.sandbox) {
        const res = await this.sandbox.exec(`ls -lA "${path}"`);
        if (res.exitCode !== 0) throw new Error(res.stderr);
        const items = res.stdout.trim().split("\n").slice(1).map(line => {
          const parts = line.trim().split(/\s+/);
          const isDir = parts[0]?.startsWith("d") ?? false;
          const name = parts.slice(8).join(" ");
          return { name, isDir };
        }).filter(i => i.name);
        return { items };
      }
      const { readdir, stat } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const entries = await readdir(path);
      const items = await Promise.all(entries.map(async (name) => {
        try {
          const s = await stat(join(path, name));
          return { name, isDir: s.isDirectory() };
        } catch { return { name, isDir: false }; }
      }));
      return { items };
    } catch (err: any) {
      return { items: [], error: err.message };
    }
  }
}

