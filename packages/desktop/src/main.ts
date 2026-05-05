/**
 * Electron main process. Spawns the Praetor api server in-process, opens
 * a BrowserWindow pointing at the dashboard, tears everything down on
 * close.
 *
 * Electron is an optional peer dep — install it locally with
 *   npm install electron --workspace=@kpanks/desktop --save-dev
 * then run `npm start` from packages/desktop.
 *
 * This file is the entry referenced by package.json#main; it dynamically
 * imports `electron` so the shared @kpanks/desktop package stays
 * importable in non-Electron contexts (Node tests, server-only deploys).
 */

import { bootstrap, type PraetorDesktopHandle } from "./index.js";

/**
 * Minimal subset of Electron's surface that we actually use. Pulled out as
 * a structural interface so the dynamic import doesn't drag in
 * `@types/electron` for non-desktop consumers.
 */
interface ElectronModuleLike {
  app: {
    whenReady: () => Promise<void>;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    quit: () => void;
    getName?: () => string;
  };
  BrowserWindow: new (opts: {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
    backgroundColor?: string;
    webPreferences?: { contextIsolation?: boolean; sandbox?: boolean; nodeIntegration?: boolean };
  }) => {
    loadURL: (url: string) => Promise<void>;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    show: () => void;
  };
}

async function loadElectron(): Promise<ElectronModuleLike> {
  try {
    const specifier = "electron";
    return (await import(/* @vite-ignore */ specifier)) as unknown as ElectronModuleLike;
  } catch {
    throw new Error(
      "@kpanks/desktop: 'electron' peer dep is not installed. Run `npm install electron --workspace=@kpanks/desktop --save-dev` and retry.",
    );
  }
}

export async function runDesktop(): Promise<void> {
  const electron = await loadElectron();
  let handle: PraetorDesktopHandle | null = null;

  await electron.app.whenReady();
  handle = await bootstrap();

  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 920,
    minHeight: 600,
    title: "Praetor",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(handle.url);
  win.show();

  electron.app.on("window-all-closed", () => {
    void handle?.shutdown().finally(() => electron.app.quit());
  });
}

// Auto-run when this file is the entry. ESM check.
const isEntry = (() => {
  try {
    const here = new URL(import.meta.url).pathname;
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const norm = (p: string) => p.replace(/^\/?[A-Za-z]:/, "").replace(/\\/g, "/").toLowerCase();
    return norm(here) === norm(argv1);
  } catch {
    return false;
  }
})();
if (isEntry) {
  runDesktop().catch((err) => {
    process.stderr.write(`[praetor-desktop] ${String(err)}\n`);
    process.exit(1);
  });
}
