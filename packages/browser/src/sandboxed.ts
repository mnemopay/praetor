/**
 * SandboxedBrowserAdapter — the design + scaffold for running PraetorBrowser
 * INSIDE a Praetor Docker sandbox instead of alongside it on the host.
 *
 * Why this matters (per `feedback_security_first_doctrine.md`):
 *
 *   When PraetorBrowser launches Chromium directly via playwright-core in
 *   the host process, every page's JavaScript runs on the host. A scraped
 *   site that exploits a Chromium 0-day, or a charter coerced via prompt
 *   injection into navigating somewhere hostile, escapes Praetor's
 *   isolation boundary entirely. The agent sandbox is meaningless if the
 *   browser sits outside it.
 *
 *   The right shape: spawn a Docker container with a headless Chromium
 *   bundled in the image, expose CDP over a port mapping, and have the
 *   host PraetorBrowser drive that remote Chromium via WebSocket. Then
 *   the browser inherits the same kernel-level isolation, resource caps,
 *   and dangerous-mount refusal that DockerSandboxFactory already applies
 *   to coding-agent commands.
 *
 * Status: SCAFFOLD. The full implementation requires:
 *   1. A Praetor-published Docker image with playwright-core's Chromium
 *      preinstalled. Build pipeline in deploy-consolidation work (#11).
 *   2. CDP-over-WebSocket transport (Chromium exposes this on
 *      `--remote-debugging-port`).
 *   3. Port-mapping handshake between DockerSandbox and the runtime.
 *   4. `playwright-core` connect() rather than launch().
 *
 * This file documents the public surface so downstream packages (cli,
 * dashboard, charter authors) can target it ahead of the implementation.
 * The factory currently throws a clear "not yet implemented" error. When
 * the build pipeline lands, swap the body for the real CDP connect.
 */

import type { BrowserAdapter } from "./index.js";

export interface SandboxedBrowserAdapterOptions {
  /**
   * The DockerSandbox-equivalent factory. The runtime is supplied by
   * @kpanks/sandbox so this package stays free of a hard sandbox dep.
   * Adapter implementer: call `sandboxFactory.create()`, get back a
   * Sandbox handle, expose its CDP port via `docker run -p` flag during
   * factory construction, then connect playwright-core via the resulting
   * ws://localhost:<port>/devtools/browser/<id> URL.
   */
  sandboxFactory: { create: () => Promise<{ id: string; close: () => Promise<void> }> };
  /**
   * Image tag containing a preinstalled headless Chromium. Defaults to
   * the canonical Praetor browser image once published.
   */
  image?: string;
  /**
   * Local port to bind the container's `--remote-debugging-port` to.
   * Default 9222. Pass `0` to let the OS pick.
   */
  cdpPort?: number;
}

/**
 * Placeholder factory. When the implementation lands it will:
 *
 *   1. sandboxFactory.create() → spawn container with image, port-map cdpPort
 *   2. Wait for `http://localhost:<cdpPort>/json/version` to respond
 *   3. Read `webSocketDebuggerUrl` from that response
 *   4. `await playwright.chromium.connect(webSocketDebuggerUrl)`
 *   5. Return a BrowserAdapter that delegates to the connected Browser
 *      handle. close() ALSO closes the sandbox.
 *
 * Throws today so charter authors get a clear "not yet" rather than a
 * silent fall-through to an insecure host launch.
 */
export class SandboxedBrowserAdapter implements BrowserAdapter {
  readonly backend = "playwright" as const;
  readonly displayName = "Sandboxed Chromium (CDP-over-Docker — design scaffold)";

  constructor(private readonly opts: SandboxedBrowserAdapterOptions) {
    void this.opts; // referenced by future impl
  }

  async navigate(): Promise<void> { throw notImplemented(); }
  async click(): Promise<void> { throw notImplemented(); }
  async fill(): Promise<void> { throw notImplemented(); }
  async press(): Promise<void> { throw notImplemented(); }
  async snapshot(): Promise<never> { throw notImplemented(); }
  async screenshot(): Promise<never> { throw notImplemented(); }
  async evaluate<T>(): Promise<T> { throw notImplemented(); }
  async close(): Promise<void> { /* no-op */ }
}

function notImplemented(): Error {
  return new Error(
    "SandboxedBrowserAdapter is a design scaffold — full implementation requires the Praetor-published Chromium image (deploy-consolidation work). Use the host PlaywrightAdapter for now and treat browser charters as trusted, OR run Praetor itself inside a Docker container.",
  );
}
