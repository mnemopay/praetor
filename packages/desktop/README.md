# @kpanks/desktop

Electron-wrapped Praetor for single-user local installs.

## Status

**Scaffold.** The bootstrap path (port selection, api startup, env
defaulting, shutdown) is real and tested. The Electron entry
(`src/main.ts`) is documented and lazy-loads `electron` as an optional
peer dep — it's not auto-installed because Electron is a 150 MB+ binary
that bloats the workspace for non-desktop consumers.

## Architecture

```
              ┌──────────────────────────────────────────┐
              │ Electron main process (src/main.ts)      │
              │                                          │
              │  1. bootstrap() → port + api server      │
              │  2. new BrowserWindow                    │
              │  3. win.loadURL(handle.url)              │
              │  4. on window-all-closed → shutdown api  │
              └──────────────────┬───────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ @kpanks/api (in-process)    │
                  │  • createApp() PraetorHTTP   │
                  │  • dashboard at /            │
                  │  • mission api at /api/v1    │
                  │  • SSE activity at /api/v1/  │
                  └──────────────────────────────┘
```

The Electron renderer (the BrowserWindow's webview) is just the existing
`@kpanks/dashboard` UI talking to localhost. **Praetor's headless
Chromium** (the one PraetorBrowser launches via playwright-core when a
charter calls `browser_navigate`) is **separate** — it's a *different*
Chromium binary, headless, never visible to the user, and lives only for
the lifetime of a charter that needs it.

## Run it locally

```bash
# 1. Install electron in the desktop workspace
npm install electron --workspace=@kpanks/desktop --save-dev

# 2. Build everything
npx tsc -b

# 3. Launch
cd packages/desktop && npx electron dist/main.js
```

## What's missing (for v1 ship)

- `electron-builder` config — produces `.exe` / `.dmg` / `.AppImage` installers.
- Auto-update channel (Squirrel for Windows, Sparkle for macOS).
- Code-signing certs (Apple Developer cert + Windows EV cert).
- Replace the dashboard's `createClient` Supabase shim with a desktop-mode
  identity provider so `req.user.id` is the local OS user.
- Bundle headless Chromium for PraetorBrowser so the user doesn't run
  `npx playwright install chromium` after install.
- Tray icon + global hotkey to summon the chat window.

## Why this is a scaffold not a finished app

Per the senior-engineer call: shipping Electron-builder-packaged binaries
with code signing is a multi-day commitment per platform, and the
strategic value lands on the engine layer (api + browser + sandbox +
caching), not on the wrapper. Get the engine right; wrap when there's
demand.
