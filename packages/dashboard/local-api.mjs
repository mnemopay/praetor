import { createServer } from "node:http";
import { exec } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const host = "127.0.0.1";
const port = 8788;

const server = createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && req.url === "/api/execute") {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      json(res, 400, { ok: false, error: "Invalid JSON" });
      return;
    }

    const command = String(payload.command ?? "").trim();
    if (!isAllowed(command)) {
      json(res, 400, {
        ok: false,
        error: "Command not allowed. Only Praetor commands are executable.",
      });
      return;
    }

    exec(command, { cwd: repoRoot, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      json(res, 200, {
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout,
        stderr,
      });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/upload") {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      json(res, 400, { ok: false, error: "Invalid JSON" });
      return;
    }
    const { filename, data } = payload;
    if (!filename || !data) {
      json(res, 400, { ok: false, error: "filename and data (base64) are required" });
      return;
    }

    try {
      const uploadDir = resolve(repoRoot, ".praetor", "uploads");
      await mkdir(uploadDir, { recursive: true });
      const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
      const id = randomBytes(4).toString("hex");
      const finalName = `${id}-${safeName}`;
      const filePath = join(uploadDir, finalName);
      
      const buffer = Buffer.from(data, "base64");
      await writeFile(filePath, buffer);
      
      json(res, 200, { ok: true, path: filePath });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/praetor") {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      json(res, 400, { ok: false, error: "Invalid JSON" });
      return;
    }
    const prompt = String(payload.prompt ?? "").trim();
    if (!prompt) {
      json(res, 400, { ok: false, error: "prompt is required" });
      return;
    }

    try {
      const missionDir = resolve(repoRoot, ".praetor");
      await mkdir(missionDir, { recursive: true });
      const id = randomBytes(4).toString("hex");
      const charterPath = join(missionDir, `temp-${id}.yaml`);
      
      const charterContent = `
name: Dash Mission ${id}
goal: |
  ${prompt.replace(/\n/g, "\n  ")}
budget:
  maxUsd: 5.00
  approvalThresholdUsd: 0.00
agents:
  - role: developer
outputs:
  - result
`.trim();

      await writeFile(charterPath, charterContent);

      exec(\`npx praetor run \${charterPath}\`, { cwd: repoRoot, timeout: 300000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
        json(res, 200, {
          ok: true,
          text: (stdout + "\\n" + stderr).trim(),
          model: "NativePraetorEngine",
          provider: "praetor",
          exitCode: error?.code ?? 0
        });
      });
    } catch (error) {
      json(res, 500, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  json(res, 404, { ok: false, error: "Not found" });
});

server.listen(port, host, () => {
  process.stdout.write(`[praetor-dashboard-api] listening on http://${host}:${port}\n`);
});

function isAllowed(command) {
  const normalized = command.toLowerCase();
  return normalized.startsWith("npx praetor ") || normalized.startsWith("npm run praetor -- ");
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        rejectBody(new Error("Body too large"));
      }
    });
    req.on("end", () => resolveBody(data));
    req.on("error", rejectBody);
  });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function chatOpenRouter(prompt, apiKey, model) {
  const system = [
    "You are Praetor dashboard assistant.",
    "Answer the user in concise plain text.",
    "Focus on helping them run Praetor CLI missions.",
    "Do not claim to have executed commands unless explicitly told.",
  ].join(" ");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://praetor.local",
      "X-Title": "Praetor Dashboard",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${text.slice(0, 400)}`);
  }
  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    model: data.model ?? model,
  };
}
