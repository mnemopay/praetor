/**
 * `praetor design serve <dir>` — tiny live-reload preview server for
 * Praetor design output (hypeframes, Spline, Remotion bundles).
 *
 *  - Serves files from <dir> over HTTP.
 *  - Watches <dir> recursively for any change → fans out an SSE event.
 *  - Injects a 12-line reload script into HTML responses so any open
 *    browser tab picks up new renders without manual refresh.
 *
 * Zero dependencies — uses node:http and node:fs/watch only.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { join, resolve, extname, normalize, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".tsx": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".splinecode": "application/octet-stream",
};

const RELOAD_SNIPPET = `
<script>(function(){
  try {
    var es = new EventSource("/__praetor_reload__");
    es.onmessage = function(e){ if (e.data === "reload") location.reload(); };
    es.onerror = function(){ /* silent — tab can stay open across server restarts */ };
  } catch (e) { /* no SSE support */ }
})();</script>
`.trim();

interface ServeOpts {
  dir: string;
  port: number;
  host?: string;
  log?: (msg: string) => void;
}

export interface ServeHandle {
  url: string;
  port: number;
  close(): Promise<void>;
  /** Trigger a manual reload pulse. */
  reload(): void;
}

export async function startDesignServer(opts: ServeOpts): Promise<ServeHandle> {
  const root = resolve(opts.dir);
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? ((m: string) => process.stderr.write(m + "\n"));

  const clients = new Set<ServerResponse>();
  const broadcast = (data: string) => {
    for (const c of clients) {
      try { c.write(`data: ${data}\n\n`); } catch { /* client may have hung up */ }
    }
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) { res.statusCode = 400; return res.end(); }
      const u = new URL(req.url, `http://${host}`);

      if (u.pathname === "/__praetor_reload__") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        });
        res.write(`data: hello\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      let p = decodeURIComponent(u.pathname);
      if (p.endsWith("/")) p += "index.html";
      const target = normalize(join(root, p));
      // Path-traversal guard
      if (!target.startsWith(root + sep) && target !== root) {
        res.statusCode = 403; res.end("forbidden"); return;
      }

      let s;
      try { s = await stat(target); } catch { res.statusCode = 404; res.end("not found"); return; }
      if (s.isDirectory()) {
        const idx = join(target, "index.html");
        try { await stat(idx); return res.writeHead(302, { location: u.pathname.replace(/\/?$/, "/") + "" }).end(); } catch { /* fall through */ }
        res.statusCode = 404; res.end("not found"); return;
      }

      const ext = extname(target).toLowerCase();
      const mime = MIME[ext] ?? "application/octet-stream";
      let body: Buffer | string = await readFile(target);
      if (mime.startsWith("text/html") && body.length > 0) {
        const html = body.toString("utf8");
        const injected = html.includes("</body>")
          ? html.replace("</body>", RELOAD_SNIPPET + "\n</body>")
          : html + RELOAD_SNIPPET;
        body = injected;
      }
      res.writeHead(200, {
        "content-type": mime,
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch (e) {
      res.statusCode = 500;
      res.end((e as Error).message);
    }
  });

  await new Promise<void>((rsv, rj) => {
    server.once("error", rj);
    server.listen(opts.port, host, () => rsv());
  });

  // Recursive watch — Linux falls back to polling, Mac/Win support recursive.
  let watcher: ReturnType<typeof watch> | undefined;
  let pulseTimer: NodeJS.Timeout | undefined;
  const pulse = () => {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => broadcast("reload"), 80);
  };
  try {
    watcher = watch(root, { recursive: true }, () => pulse());
  } catch {
    // recursive not supported on this platform — degrade to top-level
    try { watcher = watch(root, () => pulse()); } catch { /* watcher disabled */ }
  }

  const port = (server.address() as { port: number }).port;
  const url = `http://${host}:${port}`;
  log(`[praetor] design serve listening on ${url} (root=${root})`);

  return {
    url,
    port,
    reload: () => broadcast("reload"),
    async close() {
      if (watcher) watcher.close();
      for (const c of clients) { try { c.end(); } catch { /* hung up */ } }
      clients.clear();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
