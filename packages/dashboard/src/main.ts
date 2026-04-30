import "./style.css";
import { marked } from "marked";
import DOMPurify from "dompurify";

const API_BASE = "http://127.0.0.1:8788";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("dashboard: #app container not found");
}

app.innerHTML = `
  <main class="layout">
    <header class="topbar">
      <div>
        <h1>Praetor Command</h1>
        <p class="subtitle">Autonomous Mission Control</p>
      </div>
    </header>
    
    <section class="cards">
      <div class="card">
        <p class="card-label">Active Daemons</p>
        <p class="card-value" id="stat-active">0</p>
        <p class="card-hint">Running in background</p>
      </div>
      <div class="card">
        <p class="card-label">SysAdmin Status</p>
        <p class="card-value">ONLINE</p>
        <p class="card-hint">God-mode active</p>
      </div>
      <div class="card">
        <p class="card-label">Fiscal Gate</p>
        <p class="card-value">ACTIVE</p>
        <p class="card-hint">MnemoPay Guarded</p>
      </div>
    </section>

    <section class="glass-panel chat-container">
      <div id="chatLog" class="chat-log"></div>
      <form id="chatForm" class="chat-form">
        <input id="chatInput" class="chat-input" type="text" placeholder="Assign a mission (e.g. 'Build a 3D Spline scene', 'Run a SEO audit on ...')" autocomplete="off" />
        <button class="btn-primary" type="submit">Deploy Mission</button>
      </form>
    </section>
  </main>
`;

const chatForm = document.querySelector<HTMLFormElement>("#chatForm");
const chatInput = document.querySelector<HTMLInputElement>("#chatInput");
const chatLog = document.querySelector<HTMLDivElement>("#chatLog");
let activeMissionsCount = 0;

if (!chatForm || !chatInput || !chatLog) {
  throw new Error("dashboard: UI failed to initialize");
}

appendMessage("assistant", "Greetings. I am Praetor, your autonomous digital employee. Provide me with a mission objective, and I will execute it in the background.", false);

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  appendMessage("user", prompt, false);
  chatInput.value = "";
  chatInput.disabled = true;

  const sendButton = chatForm.querySelector<HTMLButtonElement>("button[type='submit']");
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "Deploying...";
  }

  try {
    const res = await fetch(`${API_BASE}/api/praetor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    
    const payload = await res.json();
    
    if (payload.ok && payload.missionId) {
      activeMissionsCount++;
      updateStats();
      appendMessage("assistant", `**Mission Deployed:** \`${payload.missionId}\`\nTracking Merkle Audit Log...`, true, payload.missionId);
    } else {
      appendMessage("assistant", `Mission failed to start: ${payload.error}`, false);
    }
  } catch (error) {
    appendMessage("assistant", `Network Error: ${String(error)}. Is the API running?`, false);
  } finally {
    chatInput.disabled = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = "Deploy Mission";
    }
    chatInput.focus();
  }
});

function updateStats() {
  const el = document.getElementById("stat-active");
  if (el) el.textContent = activeMissionsCount.toString();
}

function appendMessage(role: "user" | "assistant", text: string, isMarkdown: boolean, missionId?: string): void {
  const wrap = document.createElement("div");
  wrap.className = `msg msg-${role}`;
  
  if (isMarkdown) {
    const content = document.createElement("div");
    content.className = "markdown-body";
    // Basic config for marked if needed, DOMPurify protects from XSS
    const rawHtml = marked.parse(text) as string;
    content.innerHTML = DOMPurify.sanitize(rawHtml, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder'] });
    wrap.appendChild(content);
  } else {
    const p = document.createElement("p");
    p.textContent = text;
    p.style.margin = "0";
    wrap.appendChild(p);
  }

  if (missionId) {
    const statusBox = document.createElement("div");
    statusBox.className = "mission-status";
    statusBox.textContent = "Waiting for audit log initialization...";
    wrap.appendChild(statusBox);
    
    // Start polling for this mission
    pollStatus(missionId, statusBox);
  }

  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function pollStatus(missionId: string, statusBox: HTMLElement) {
  let isRunning = true;
  
  while (isRunning) {
    try {
      const res = await fetch(`${API_BASE}/api/status?id=${missionId}`);
      const payload = await res.json();
      
      if (payload.ok) {
        if (payload.log && payload.log.length > 0) {
           // Parse the log
           const lines = payload.log.split('\n').filter(Boolean);
           let displayLog = "";
           let finalOutput = null;
           
           for (const line of lines) {
             try {
               const parsed = JSON.parse(line);
               if (parsed.type) {
                 displayLog += `[${parsed.ts}] ${parsed.type}: ${parsed.data.name || ''}\n`;
               } else if (parsed.status === "ok" || parsed.status === "error") {
                 finalOutput = parsed;
               }
             } catch {
               displayLog += line + "\n";
             }
           }
           statusBox.textContent = displayLog;
           chatLog.scrollTop = chatLog.scrollHeight;
           
           if (!payload.running && finalOutput) {
             isRunning = false;
             activeMissionsCount--;
             updateStats();
             
             if (finalOutput.status === "error") {
                appendMessage("assistant", `**Mission Error:**\n\`\`\`json\n${JSON.stringify(finalOutput, null, 2)}\n\`\`\``, true);
             } else if (finalOutput.outputs && finalOutput.outputs.length > 0) {
                // Render the agent's final text output as beautiful markdown!
                const textOutput = typeof finalOutput.outputs[0] === 'string' ? finalOutput.outputs[0] : JSON.stringify(finalOutput.outputs);
                appendMessage("assistant", textOutput, true);
             }
           }
        }
        
        if (!payload.running) {
          isRunning = false;
        }
      }
    } catch (err) {
      console.error(err);
    }
    
    if (isRunning) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
