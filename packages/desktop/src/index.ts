/**
 * @praetor/desktop — Electron wrapper around @praetor/api + @praetor/dashboard.
 *
 * Architecture:
 *
 *   1. main.ts (Electron entry) → calls bootstrap() from this file.
 *   2. bootstrap() picks a free local port, sets sane defaults for the
 *      api server's required env vars (Supabase shim — desktop runs
 *      single-user local-only by default), starts the api server.
 *   3. main.ts opens an Electron BrowserWindow pointing at the api's
 *      bundled dashboard surface.
 *   4. On window close: stop the api server, exit the app.
 *
 * This index.ts is intentionally Electron-free so the bootstrap logic is
 * testable without pulling Electron into devDeps. Electron is an optional
 * peer dep — `npm install electron` to actually run the desktop shell.
 *
 * Per `feedback_security_first_doctrine.md`: desktop mode is single-user
 * local-only. The dashboard's createClient shim auto-signs the user in as
 * `dev-user` so they don't see a Supabase login screen. Real multi-user
 * deployment goes through `@praetor/api` directly + a real auth provider.
 */

import { createServer } from "node:net";
import type { Server } from "node:http";

export interface BootstrapOptions {
  /** Preferred port; falls back to a random free one if taken. */
  preferredPort?: number;
  /** Override the host. Defaults to "127.0.0.1" (loopback only). */
  host?: string;
  /** Override the repo root the api server uses for charter / artifact storage. */
  repoRoot?: string;
  /**
   * Test injection — provide your own factory instead of the real
   * `@praetor/api` createApp. Lets unit tests verify port selection +
   * env defaulting without spinning up a real server.
   */
  __createApp?: () => { listen: (port: number, host: string, cb: () => void) => Server };
}

export interface PraetorDesktopHandle {
  /** URL the dashboard window should load. */
  url: string;
  /** Bound port. */
  port: number;
  /** Stops the api server. Idempotent. */
  shutdown: () => Promise<void>;
}

/**
 * Stand up the api server inside the desktop process. Must be called
 * before opening the BrowserWindow.
 */
export async function bootstrap(opts: BootstrapOptions = {}): Promise<PraetorDesktopHandle> {
  await ensureDesktopEnvDefaults(opts.repoRoot);
  const host = opts.host ?? "127.0.0.1";
  const port = await pickPort(opts.preferredPort ?? 8788);

  const createApp = opts.__createApp ?? (await defaultCreateApp());
  const app = createApp();
  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    (s as unknown as { on(event: string, cb: (err: Error) => void): void }).on("error", reject);
  });

  let stopped = false;
  return {
    url: `http://${host}:${port}/`,
    port,
    shutdown: async () => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Pick a local port. Tries `preferred` first, falls through to whatever
 * the OS hands out (port 0). Always returns a real listening-checked
 * number, never the literal 0.
 */
export async function pickPort(preferred: number): Promise<number> {
  if (preferred && preferred > 0) {
    const ok = await tryBind(preferred);
    if (ok !== null) return ok;
  }
  // Fall back to OS-assigned ephemeral port.
  const ok = await tryBind(0);
  if (ok === null) throw new Error("PraetorDesktop: failed to bind any port");
  return ok;
}

function tryBind(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(null));
    probe.listen(port, "127.0.0.1", () => {
      const addr = probe.address();
      probe.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else resolve(null);
      });
    });
  });
}

/**
 * Set the env defaults that `@praetor/api` requires at module-load time.
 * Desktop mode is single-user local — Supabase isn't actually called for
 * auth (the dashboard's createClient shim auto-signs `dev-user`), but the
 * api's env loader throws if these vars are absent. Stub them with safe
 * placeholders so the api builds.
 */
export async function ensureDesktopEnvDefaults(repoRoot?: string): Promise<void> {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "praetor-desktop-shim";
  if (repoRoot) {
    process.env.PRAETOR_REPO_ROOT = repoRoot;
  } else {
    process.env.PRAETOR_REPO_ROOT = process.env.PRAETOR_REPO_ROOT ?? process.cwd();
  }
  // Permit the dashboard to talk to localhost — the dashboard's CORS layer
  // only auto-allows localhost / 127.0.0.1 by default, but Electron uses
  // file:// for the renderer in some configurations. Keeping the default.
}

async function defaultCreateApp(): Promise<() => { listen: (port: number, host: string, cb: () => void) => Server }> {
  // Lazy-import @praetor/api so this module stays Electron-free + cheap to
  // import in tests that just check pickPort / env defaulting. Indirect the
  // specifier through a variable so tsc doesn't try to resolve the package
  // at compile time (it isn't built yet during composite project graph
  // bootstrap; resolved at runtime via the workspaces symlink).
  const apiSpec = "@praetor/api";
  const mod = (await import(apiSpec)) as unknown as { createApp: () => { listen: (port: number, host: string, cb: () => void) => Server } };
  return mod.createApp;
}
