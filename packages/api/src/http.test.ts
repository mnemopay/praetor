import { describe, expect, it } from "vitest";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { jsonBodyParser, praetorHttp, praetorRouter } from "./http.js";

interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function withApp(setup: (app: ReturnType<typeof praetorHttp>) => void): Promise<{ port: number; close: () => Promise<void> }> {
  const app = praetorHttp();
  setup(app);
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
    server.on("error", reject);
  });
}

function send(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

describe("PraetorHTTP", () => {
  it("routes GET with path params and query string", async () => {
    const ctx = await withApp((app) => {
      app.get("/items/:id", (req, res) => {
        res.json({ id: req.params.id, q: req.query.search });
      });
    });
    try {
      const r = await send(ctx.port, { path: "/items/abc?search=hello%20world" });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ id: "abc", q: "hello world" });
    } finally {
      await ctx.close();
    }
  });

  it("parses JSON body when content-type is application/json", async () => {
    const ctx = await withApp((app) => {
      app.use(jsonBodyParser({ limit: "1mb" }));
      app.post("/echo", (req, res) => {
        res.json({ got: req.body });
      });
    });
    try {
      const r = await send(ctx.port, {
        method: "POST",
        path: "/echo",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ got: { hello: "world" } });
    } finally {
      await ctx.close();
    }
  });

  it("rejects bodies over the limit with 413", async () => {
    const ctx = await withApp((app) => {
      app.use(jsonBodyParser({ limit: 64 }));
      app.post("/echo", (req, res) => res.json({ got: req.body }));
    });
    try {
      const big = JSON.stringify({ data: "x".repeat(200) });
      const r = await send(ctx.port, {
        method: "POST",
        path: "/echo",
        headers: { "content-type": "application/json" },
        body: big,
      });
      expect(r.status).toBe(413);
    } finally {
      await ctx.close();
    }
  });

  it("runs middleware chain and respects next() ordering", async () => {
    const log: string[] = [];
    const ctx = await withApp((app) => {
      app.use((req, _res, next) => {
        log.push(`a:${req.method}`);
        (req as Record<string, unknown>).tag = "tagged";
        next();
      });
      app.get("/x", (req, res) => {
        log.push(`handler:${(req as Record<string, unknown>).tag}`);
        res.json({ ok: true });
      });
    });
    try {
      const r = await send(ctx.port, { path: "/x" });
      expect(r.status).toBe(200);
      expect(log).toEqual(["a:GET", "handler:tagged"]);
    } finally {
      await ctx.close();
    }
  });

  it("mounts a sub-router under a path prefix", async () => {
    const ctx = await withApp((app) => {
      const sub = praetorRouter();
      sub.get("/missions/:id", (req, res) => res.json({ id: req.params.id }));
      app.use("/api/v1", sub);
    });
    try {
      const r = await send(ctx.port, { path: "/api/v1/missions/m-42" });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ id: "m-42" });
    } finally {
      await ctx.close();
    }
  });

  it("auth-style middleware can short-circuit with status().json()", async () => {
    const ctx = await withApp((app) => {
      app.use("/api", (req, res, next) => {
        if (req.header("authorization") !== "Bearer ok") {
          res.status(401).json({ ok: false, error: "Missing bearer token" });
          return;
        }
        next();
      });
      app.get("/api/secret", (_req, res) => res.json({ ok: true }));
    });
    try {
      const denied = await send(ctx.port, { path: "/api/secret" });
      expect(denied.status).toBe(401);
      expect(JSON.parse(denied.body).error).toMatch(/bearer/i);
      const allowed = await send(ctx.port, { path: "/api/secret", headers: { authorization: "Bearer ok" } });
      expect(allowed.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  it("returns 404 JSON when no route matches", async () => {
    const ctx = await withApp((app) => {
      app.get("/known", (_req, res) => res.json({ ok: true }));
    });
    try {
      const r = await send(ctx.port, { path: "/unknown" });
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ ok: false, error: "Not Found" });
    } finally {
      await ctx.close();
    }
  });

  it("supports SSE-style write/flushHeaders/keepalive", async () => {
    const ctx = await withApp((app) => {
      app.get("/sse", (_req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.flushHeaders();
        res.write("data: 1\n\n");
        res.write("data: 2\n\n");
        res.end();
      });
    });
    try {
      const r = await send(ctx.port, { path: "/sse" });
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toBe("text/event-stream");
      expect(r.body).toContain("data: 1");
      expect(r.body).toContain("data: 2");
    } finally {
      await ctx.close();
    }
  });

  it("OPTIONS preflight terminates with 204 from CORS middleware", async () => {
    const ctx = await withApp((app) => {
      app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        if (req.method === "OPTIONS") {
          res.status(204).end();
          return;
        }
        next();
      });
      app.get("/ping", (_req, res) => res.json({ ok: true }));
    });
    try {
      const r = await send(ctx.port, { method: "OPTIONS", path: "/ping" });
      expect(r.status).toBe(204);
      expect(r.headers["access-control-allow-methods"]).toContain("GET");
    } finally {
      await ctx.close();
    }
  });
});
