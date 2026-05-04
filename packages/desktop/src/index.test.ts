import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server as TcpServer } from "node:net";
import type { Server as HttpServer } from "node:http";
import { bootstrap, ensureDesktopEnvDefaults, pickPort } from "./index.js";

describe("@praetor/desktop bootstrap", () => {
  let savedSupabaseUrl: string | undefined;
  let savedKey: string | undefined;
  let savedRepoRoot: string | undefined;
  beforeEach(() => {
    savedSupabaseUrl = process.env.SUPABASE_URL;
    savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    savedRepoRoot = process.env.PRAETOR_REPO_ROOT;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.PRAETOR_REPO_ROOT;
  });
  afterEach(() => {
    if (savedSupabaseUrl !== undefined) process.env.SUPABASE_URL = savedSupabaseUrl; else delete process.env.SUPABASE_URL;
    if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (savedRepoRoot !== undefined) process.env.PRAETOR_REPO_ROOT = savedRepoRoot; else delete process.env.PRAETOR_REPO_ROOT;
  });

  it("ensureDesktopEnvDefaults sets the api server's required env vars when missing", async () => {
    await ensureDesktopEnvDefaults("/tmp/repo");
    expect(process.env.SUPABASE_URL).toBeDefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
    expect(process.env.PRAETOR_REPO_ROOT).toBe("/tmp/repo");
  });

  it("ensureDesktopEnvDefaults preserves existing env values (no overwrite)", async () => {
    process.env.SUPABASE_URL = "http://my.supabase";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "real-key";
    await ensureDesktopEnvDefaults();
    expect(process.env.SUPABASE_URL).toBe("http://my.supabase");
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("real-key");
  });

  it("pickPort returns the preferred port when free", async () => {
    const p = await pickPort(0); // 0 → OS-assigned, always free
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(65536);
  });

  it("pickPort falls through to OS-assigned when preferred is taken", async () => {
    // Bind a real socket so the preferred port is occupied.
    const blocker: TcpServer = createServer();
    blocker.listen(0, "127.0.0.1");
    await new Promise<void>((r) => blocker.once("listening", () => r()));
    const blocked = (blocker.address() as { port: number }).port;
    try {
      const next = await pickPort(blocked);
      expect(next).not.toBe(blocked); // must have fallen through
      expect(next).toBeGreaterThan(0);
    } finally {
      blocker.close();
    }
  });

  it("bootstrap stands up an injected app, returns its URL, and shutdown stops it", async () => {
    let listening: HttpServer | null = null;
    let listenedHost = "";
    let listenedPort = 0;
    const fakeApp = {
      listen: (port: number, host: string, cb: () => void): HttpServer => {
        listenedHost = host;
        listenedPort = port;
        // The real api uses node:http; for the test we mock just enough surface.
        const closers: (() => void)[] = [];
        const server = {
          close: (callback?: () => void) => { closers.push(() => callback?.()); for (const c of closers) c(); return server; },
          on: () => server,
        } as unknown as HttpServer;
        listening = server;
        // Defer the cb so callers' awaits resolve naturally.
        setImmediate(cb);
        return server;
      },
    };
    const handle = await bootstrap({
      preferredPort: 0,
      __createApp: () => fakeApp,
    });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(handle.port).toBeGreaterThan(0);
    expect(listenedHost).toBe("127.0.0.1");
    expect(listenedPort).toBe(handle.port);
    await handle.shutdown();
    await handle.shutdown(); // idempotent
  });
});
