import { exec } from "node:child_process";
import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function runCommand(command: string, cwd: string = process.cwd()): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error ? (error.code ?? 1) : 0,
      });
    });
  });
}

export async function readFile(path: string): Promise<{ content: string; error?: string }> {
  try {
    const content = await fsReadFile(path, "utf-8");
    return { content };
  } catch (err: any) {
    return { content: "", error: err.message };
  }
}

export async function writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }> {
  try {
    await fsWriteFile(path, content, "utf-8");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function listDir(path: string): Promise<{ items: { name: string; isDir: boolean }[]; error?: string }> {
  try {
    const entries = await readdir(path);
    const items = await Promise.all(
      entries.map(async (name) => {
        try {
          const s = await stat(join(path, name));
          return { name, isDir: s.isDirectory() };
        } catch {
          return { name, isDir: false };
        }
      })
    );
    return { items };
  } catch (err: any) {
    return { items: [], error: err.message };
  }
}
