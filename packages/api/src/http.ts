/**
 * PraetorHTTP — Praetor's native HTTP framework. Replaces Express in the API
 * package. Uses Node's `node:http` directly with a small, opinionated
 * router + middleware chain.
 *
 * Why native: per `feedback_praetor_native_tools.md` every Praetor tool/runtime
 * surface is custom-native. Express was the only third-party HTTP framework
 * left in the API process.
 *
 * Surface intentionally matches the subset of Express semantics that the API
 * actually uses, so route handlers translate one-to-one:
 *   - `app.use(handler)` / `app.use(path, handler)` / `app.use(path, router)`
 *   - `app.get/post/put/delete(path, ...handlers)`
 *   - JSON body parser (default 1mb cap)
 *   - `:param` path matching, prefix-mounted sub-routers
 *   - `req.params`, `req.query`, `req.headers`, `req.header(name)`, `req.body`
 *   - `req.on('close', cb)` for SSE cleanup
 *   - `res.status(n).json(x)`, `res.send`, `res.sendFile`, `res.setHeader`,
 *     `res.write`, `res.end`, `res.flushHeaders`
 *
 * Out of scope (intentionally): view engines, cookie parser, multipart upload,
 * trust-proxy logic. Not used by the Praetor API; if a future route needs
 * them, add a focused module — do not pull in Express.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { stat, createReadStream } from "node:fs";
import { extname } from "node:path";
import { log } from "@kpanks/core";

export interface PraetorRequest extends IncomingMessage {
  /** Path component of the URL with the mount prefix already stripped. */
  pathname: string;
  /** Original request URL (always populated). */
  url: string;
  /** Parsed `?key=value` pairs. Repeated keys collapse to string[]. */
  query: Record<string, string | string[]>;
  /** Path parameters extracted from `:param` segments. */
  params: Record<string, string>;
  /** Parsed JSON body when the JSON parser middleware ran. */
  body?: unknown;
  /** Convenience reader matching the Express signature. */
  header(name: string): string | undefined;
  /** Anything else handlers stash (e.g. `req.user` from auth middleware). */
  [k: string]: unknown;
}

export interface PraetorResponse extends ServerResponse {
  status(code: number): PraetorResponse;
  json(body: unknown): void;
  send(body: string | Buffer): void;
  sendFile(absPath: string): void;
  setHeader(name: string, value: number | string | readonly string[]): this;
  flushHeaders(): void;
}

export type NextFunction = (err?: unknown) => void;
export type Handler = (req: PraetorRequest, res: PraetorResponse, next: NextFunction) => void | Promise<void>;
export type ErrorHandler = (err: unknown, req: PraetorRequest, res: PraetorResponse, next: NextFunction) => void | Promise<void>;

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

interface CompiledPattern {
  re: RegExp;
  keys: string[];
  /** True when this pattern is a prefix mount (e.g. `app.use("/api/v1", ...)`). */
  prefix: boolean;
  /** The original mount path, used to strip when delegating to sub-routers. */
  mountPath: string;
}

interface RouteEntry {
  method: Method | null; // null = all methods (mounted middleware/router)
  pattern: CompiledPattern;
  handlers: Handler[];
  /** Optional sub-router this entry mounts. */
  subRouter?: PraetorRouter;
}

const HTTP_METHODS: readonly Method[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

function compilePattern(path: string, prefix: boolean): CompiledPattern {
  if (path === "" || path === "/") {
    return {
      re: prefix ? /^\/?/ : /^\/?$/,
      keys: [],
      prefix,
      mountPath: path === "" ? "/" : path,
    };
  }
  const keys: string[] = [];
  const segments = path.split("/").filter(Boolean);
  const escaped = segments
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const source = prefix ? `^/${escaped}(?=/|$)` : `^/${escaped}/?$`;
  return { re: new RegExp(source), keys, prefix, mountPath: path };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseQuery(rawQs: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!rawQs) return out;
  const qs = rawQs.startsWith("?") ? rawQs.slice(1) : rawQs;
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decode(eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, " ");
    const val = eq < 0 ? "" : decode(part.slice(eq + 1).replace(/\+/g, " "));
    const existing = out[key];
    if (existing === undefined) out[key] = val;
    else if (Array.isArray(existing)) existing.push(val);
    else out[key] = [existing, val];
  }
  return out;
}

function splitUrl(rawUrl: string): { pathname: string; query: Record<string, string | string[]> } {
  const qIdx = rawUrl.indexOf("?");
  const pathname = qIdx < 0 ? rawUrl : rawUrl.slice(0, qIdx);
  const query = parseQuery(qIdx < 0 ? "" : rawUrl.slice(qIdx + 1));
  return { pathname: pathname || "/", query };
}

function decorateRequest(raw: IncomingMessage, pathname: string, query: Record<string, string | string[]>): PraetorRequest {
  const req = raw as PraetorRequest;
  req.pathname = pathname;
  req.query = query;
  req.params = {};
  req.header = (name: string) => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : (value as string | undefined);
  };
  return req;
}

function decorateResponse(raw: ServerResponse): PraetorResponse {
  const res = raw as PraetorResponse;
  res.status = function status(code: number) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(body: unknown) {
    if (!res.headersSent && !res.getHeader("content-type")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(body));
  };
  res.send = function send(body: string | Buffer) {
    if (!res.headersSent && !res.getHeader("content-type")) {
      res.setHeader("content-type", typeof body === "string" ? "text/plain; charset=utf-8" : "application/octet-stream");
    }
    res.end(body);
  };
  res.sendFile = function sendFile(absPath: string) {
    stat(absPath, (err, stats) => {
      if (err || !stats || !stats.isFile()) {
        if (!res.headersSent) res.statusCode = 404;
        res.end("Not Found");
        return;
      }
      if (!res.getHeader("content-type")) {
        res.setHeader("content-type", contentTypeFor(absPath));
      }
      res.setHeader("content-length", String(stats.size));
      const stream = createReadStream(absPath);
      stream.on("error", () => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
      stream.pipe(res);
    });
  };
  return res;
}

function contentTypeFor(absPath: string): string {
  switch (extname(absPath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".glb": return "model/gltf-binary";
    case ".gltf": return "model/gltf+json";
    case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

/**
 * JSON body parser. Reads up to `limit` bytes (default 1mb) and parses as
 * JSON when the request advertises a JSON Content-Type. Non-JSON requests
 * pass through with `req.body` unset.
 */
export function jsonBodyParser(opts: { limit?: string | number } = {}): Handler {
  const limitBytes = parseLimit(opts.limit ?? "1mb");
  return async (req, _res, next) => {
    const ct = req.header("content-type") ?? "";
    if (!/application\/(.+\+)?json/i.test(ct)) {
      next();
      return;
    }
    try {
      const buf = await readBody(req, limitBytes);
      if (buf.length === 0) {
        req.body = undefined;
      } else {
        req.body = JSON.parse(buf.toString("utf8"));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    const onData = (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > limit) {
        aborted = true;
        // Stop consuming further chunks but DO NOT destroy the socket — the
        // chain runner needs the response writable so it can send 413 back.
        req.off("data", onData);
        req.resume(); // drain the rest into /dev/null so node finishes the request
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function parseLimit(limit: string | number): number {
  if (typeof limit === "number") return limit;
  const m = /^(\d+)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
  if (!m) return 1_048_576;
  const n = Number(m[1]);
  switch ((m[2] ?? "b").toLowerCase()) {
    case "kb": return n * 1024;
    case "mb": return n * 1024 * 1024;
    case "gb": return n * 1024 * 1024 * 1024;
    default: return n;
  }
}

/* ─── Router + App ─────────────────────────────────────────────────────── */

export class PraetorRouter {
  /** Parent-relative routes registered on this router. */
  readonly stack: RouteEntry[] = [];

  use(handler: Handler): this;
  use(path: string, handler: Handler): this;
  use(path: string, ...handlers: Handler[]): this;
  use(path: string, router: PraetorRouter): this;
  use(...args: [Handler] | [string, Handler] | [string, ...Handler[]] | [string, PraetorRouter]): this {
    const { path, handlers, sub } = parseUseArgs(args);
    if (sub) {
      this.stack.push({
        method: null,
        pattern: compilePattern(path, true),
        handlers: [],
        subRouter: sub,
      });
    } else {
      this.stack.push({
        method: null,
        pattern: compilePattern(path, true),
        handlers,
      });
    }
    return this;
  }

  get(path: string, ...handlers: Handler[]) { return this.add("GET", path, handlers); }
  post(path: string, ...handlers: Handler[]) { return this.add("POST", path, handlers); }
  put(path: string, ...handlers: Handler[]) { return this.add("PUT", path, handlers); }
  delete(path: string, ...handlers: Handler[]) { return this.add("DELETE", path, handlers); }
  patch(path: string, ...handlers: Handler[]) { return this.add("PATCH", path, handlers); }

  protected add(method: Method, path: string, handlers: Handler[]): this {
    this.stack.push({
      method,
      pattern: compilePattern(path, false),
      handlers,
    });
    return this;
  }

  /**
   * Walks this router's stack against (method, pathname). Calls each matching
   * middleware/handler in order. Sub-routers recurse with the prefix stripped.
   */
  async dispatch(req: PraetorRequest, res: PraetorResponse, basePathname: string): Promise<boolean> {
    for (const entry of this.stack) {
      const m = entry.pattern.re.exec(basePathname);
      if (!m) continue;
      if (entry.method && entry.method !== req.method) continue;

      // Bind path params.
      for (let i = 0; i < entry.pattern.keys.length; i++) {
        const key = entry.pattern.keys[i];
        const val = m[i + 1];
        if (val !== undefined) req.params[key] = decode(val);
      }

      if (entry.subRouter) {
        const stripLen = entry.pattern.mountPath === "/" ? 0 : entry.pattern.mountPath.length;
        const sub = basePathname.slice(stripLen) || "/";
        const handled = await entry.subRouter.dispatch(req, res, sub);
        if (handled || res.writableEnded) return true;
        continue;
      }

      const handled = await runChain(entry.handlers, req, res);
      if (handled || res.writableEnded) return true;
    }
    return false;
  }
}

async function runChain(handlers: Handler[], req: PraetorRequest, res: PraetorResponse): Promise<boolean> {
  let stopped = false;
  let chainErr: unknown = null;
  for (const handler of handlers) {
    if (stopped || res.writableEnded) break;
    let advanced = false;
    let nextErr: unknown = null;
    await new Promise<void>((resolve) => {
      const next: NextFunction = (err) => {
        advanced = true;
        if (err !== undefined) nextErr = err;
        resolve();
      };
      try {
        const ret = handler(req, res, next);
        if (ret instanceof Promise) {
          ret.then(() => { if (!advanced) resolve(); }, (err) => { nextErr = err; resolve(); });
        } else if (!advanced) {
          // Synchronous handler that didn't call next() and didn't end the
          // response — treat as terminal (matches Express behaviour where a
          // handler that returns without next() owns the response).
          resolve();
        }
      } catch (err) {
        nextErr = err;
        resolve();
      }
    });
    if (nextErr !== null && nextErr !== undefined) {
      chainErr = nextErr;
      break;
    }
    if (!advanced) {
      // Handler ran terminally (didn't call next()).
      return true;
    }
  }
  if (chainErr) throw chainErr;
  return res.writableEnded;
}

function parseUseArgs(args: unknown[]): { path: string; handlers: Handler[]; sub?: PraetorRouter } {
  let path = "/";
  let rest: unknown[] = args;
  if (typeof args[0] === "string") {
    path = args[0];
    rest = args.slice(1);
  }
  if (rest.length === 1 && rest[0] instanceof PraetorRouter) {
    return { path, handlers: [], sub: rest[0] };
  }
  return { path, handlers: rest as Handler[] };
}

export class PraetorApp extends PraetorRouter {
  private server?: Server;

  /**
   * Start listening. Signature matches Express: (port[, host[, cb]]).
   */
  listen(port: number, host?: string | (() => void), cb?: () => void): Server {
    let actualHost: string | undefined;
    let actualCb: (() => void) | undefined;
    if (typeof host === "function") {
      actualCb = host;
    } else {
      actualHost = host;
      actualCb = cb;
    }
    this.server = createServer((raw, rawRes) => {
      void this.handle(raw, rawRes);
    });
    if (actualHost) this.server.listen(port, actualHost, actualCb);
    else this.server.listen(port, actualCb);
    return this.server;
  }

  /** Build the same routing tree but without binding a port. Useful for tests. */
  toListener() {
    return (raw: IncomingMessage, rawRes: ServerResponse): void => {
      void this.handle(raw, rawRes);
    };
  }

  private async handle(raw: IncomingMessage, rawRes: ServerResponse): Promise<void> {
    const url = raw.url ?? "/";
    const { pathname, query } = splitUrl(url);
    const req = decorateRequest(raw, pathname, query);
    const res = decorateResponse(rawRes);
    try {
      const handled = await this.dispatch(req, res, pathname);
      if (!handled && !res.writableEnded) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "Not Found" }));
      }
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode ?? 500;
      if (!res.writableEnded) {
        res.statusCode = status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        const message = err instanceof Error ? err.message : "Internal Error";
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      // Only log unexpected (5xx) errors; 4xx is normal client traffic.
      if (status >= 500) {
        log.error("[praetor-http] unhandled request error", {
          status,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  }
}

/** Factory matching `express()`. */
export function praetorHttp(): PraetorApp {
  return new PraetorApp();
}

/** Factory matching `express.Router()`. */
export function praetorRouter(): PraetorRouter {
  return new PraetorRouter();
}
