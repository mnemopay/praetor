import "./style.css";

type Stat = {
  label: string;
  value: string;
  hint: string;
};

const stats: Stat[] = [
  { label: "Active Missions", value: "12", hint: "+3 today" },
  { label: "Budget Reserved", value: "$4,920", hint: "Across open charters" },
  { label: "Audit Entries", value: "18,442", hint: "Merkle-chained" },
  { label: "Failed Runs", value: "1", hint: "Last 24h" },
];

type ChatReply = {
  text: string;
  commands: string[];
  meta?: string;
};
const API_BASE = "http://127.0.0.1:8788";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("dashboard: #app container not found");
}

const statCards = stats
  .map(
    (s) => `
      <article class="card">
        <p class="card-label">${s.label}</p>
        <p class="card-value">${s.value}</p>
        <p class="card-hint">${s.hint}</p>
      </article>
    `,
  )
  .join("");

app.innerHTML = `
  <main class="layout">
    <header class="topbar">
      <div>
        <h1>Praetor Dashboard</h1>
        <p class="subtitle">Mission runtime health and command chat</p>
      </div>
      <button class="refresh" type="button">Refresh</button>
    </header>
    <section class="cards">${statCards}</section>
    <section class="panel">
      <h2>Talk to Praetor</h2>
      <p class="panel-subtitle">Type naturally. Replies come from OpenRouter (when key is set) plus runnable CLI commands.</p>
      <div id="chatLog" class="chat-log"></div>
      <form id="chatForm" class="chat-form">
        <input id="chatInput" class="chat-input" type="text" placeholder="Example: ingest https://example.com and save mission output" />
        <button class="refresh" type="submit">Send</button>
      </form>
    </section>
    <section class="panel">
      <h2>Supported CLI Commands</h2>
      <ul class="cmd-list">
        <li><code>npx praetor run &lt;charter.yaml&gt; [--article12 &lt;dir&gt;] [--save &lt;mission.json&gt;] [--operator &lt;id&gt;] [--verbose]</code></li>
        <li><code>npx praetor article12 --in &lt;mission.json&gt; --out &lt;bundle-dir&gt; [--operator &lt;id&gt;]</code></li>
        <li><code>npx praetor ingest &lt;url&gt; [--mission &lt;id&gt;] [--backend fetch|crawl4ai|playwright-mcp|firecrawl] [--chunk &lt;chars&gt;]</code></li>
        <li><code>npx praetor design serve &lt;dir&gt; [--port &lt;n&gt;] [--host &lt;h&gt;]</code></li>
      </ul>
    </section>
  </main>
`;

const chatForm = document.querySelector<HTMLFormElement>("#chatForm");
const chatInput = document.querySelector<HTMLInputElement>("#chatInput");
const chatLog = document.querySelector<HTMLDivElement>("#chatLog");

if (!chatForm || !chatInput || !chatLog) {
  throw new Error("dashboard: chat UI failed to initialize");
}

appendMessage("assistant", {
  text: "Ask in natural language. I will respond conversationally and suggest exact Praetor commands you can run or execute here.",
  commands: [
    "cd C:\\Users\\breia\\praetor",
    "npm run praetor -- --help",
  ],
  meta: "LLM route: OpenRouter (if OPENROUTER_API_KEY is set)",
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  appendMessage("user", { text: prompt, commands: [] });
  chatInput.disabled = true;
  const sendButton = chatForm.querySelector<HTMLButtonElement>("button[type='submit']");
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "Thinking...";
  }
  const llm = await askPraetor(prompt);
  const commands = suggestCommands(prompt);
  appendMessage("assistant", {
    text: llm.text,
    commands,
    meta: llm.meta,
  });
  chatInput.value = "";
  chatInput.disabled = false;
  if (sendButton) {
    sendButton.disabled = false;
    sendButton.textContent = "Send";
  }
  chatInput.focus();
});

function suggestCommands(prompt: string): string[] {
  const p = prompt.toLowerCase();
  if (p.includes("hello") || (p.includes("run") && p.includes("charter"))) {
    return [
      "cd C:\\Users\\breia\\praetor",
      "npm run build",
      "npx praetor run charters/hello.yaml --verbose",
    ];
  }
  if (p.includes("article12") || p.includes("audit bundle") || p.includes("bundle")) {
    return [
      "cd C:\\Users\\breia\\praetor",
      "npx praetor article12 --in missions/hello-live.json --out missions/hello-live-bundle --operator jerry",
    ];
  }
  if (p.includes("ingest") || p.includes("crawl") || p.includes("scrape") || p.includes("url")) {
    return [
      "cd C:\\Users\\breia\\praetor",
      "npx praetor ingest https://example.com --backend fetch --mission demo",
    ];
  }
  if (p.includes("serve") || p.includes("design")) {
    return [
      "cd C:\\Users\\breia\\praetor",
      "npx praetor design serve examples-out --host 127.0.0.1 --port 4310",
    ];
  }
  if (p.includes("help") || p.includes("what can i")) {
    return [
      "npx praetor --help",
      "npx praetor run charters/hello.yaml",
      "npx praetor ingest https://example.com",
    ];
  }
  return [
    "cd C:\\Users\\breia\\praetor",
    "npx praetor --help",
  ];
}

function appendMessage(role: "user" | "assistant", reply: ChatReply): void {
  const wrap = document.createElement("article");
  wrap.className = `msg msg-${role}`;
  const text = document.createElement("p");
  text.className = "msg-text";
  text.textContent = reply.text;
  wrap.appendChild(text);
  if (reply.meta) {
    const meta = document.createElement("p");
    meta.className = "msg-meta";
    meta.textContent = reply.meta;
    wrap.appendChild(meta);
  }

  for (const cmd of reply.commands) {
    const row = document.createElement("div");
    row.className = "cmd-row";
    const code = document.createElement("code");
    code.textContent = cmd;
    const controls = document.createElement("div");
    controls.className = "cmd-controls";
    const run = document.createElement("button");
    run.type = "button";
    run.className = "run-btn";
    run.textContent = "Run";
    run.addEventListener("click", async () => {
      run.disabled = true;
      run.textContent = "Running...";
      const output = await runCommand(cmd);
      const out = document.createElement("pre");
      out.className = "cmd-output";
      out.textContent = output;
      wrap.appendChild(out);
      run.disabled = false;
      run.textContent = "Run";
      chatLog.scrollTop = chatLog.scrollHeight;
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-btn";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(cmd);
      copy.textContent = "Copied";
      setTimeout(() => {
        copy.textContent = "Copy";
      }, 900);
    });
    controls.append(run, copy);
    row.append(code, controls);
    wrap.appendChild(row);
  }

  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function askPraetor(prompt: string): Promise<{ text: string; meta: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const payload = (await res.json()) as {
      ok: boolean;
      text?: string;
      model?: string;
      provider?: string;
      error?: string;
    };
    if (!payload.ok) {
      return {
        text: `LLM chat unavailable: ${payload.error ?? "unknown error"}. I can still suggest commands below.`,
        meta: "Fallback mode (no LLM response)",
      };
    }
    return {
      text: payload.text?.trim() || "No response text returned.",
      meta: `Routed via ${payload.provider ?? "provider"} model: ${payload.model ?? "unknown"}`,
    };
  } catch (error) {
    return {
      text: `Could not reach local API at ${API_BASE}. Start it with: npm run --workspace @praetor/dashboard api`,
      meta: String(error),
    };
  }
}

async function runCommand(command: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const payload = (await res.json()) as {
      ok: boolean;
      error?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };
    if (!payload.ok) {
      return `Error: ${payload.error ?? "execution failed"}`;
    }
    const out = [payload.stdout?.trim(), payload.stderr?.trim()].filter(Boolean).join("\n\n");
    return out || `Command completed (exit ${payload.exitCode ?? 0})`;
  } catch (error) {
    return `Could not reach local API at ${API_BASE}. Start it with: npm run --workspace @praetor/dashboard api\n\n${String(error)}`;
  }
}
