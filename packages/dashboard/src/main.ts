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
        <p class="subtitle">Mission runtime health and spend at a glance</p>
      </div>
      <button class="refresh" type="button">Refresh</button>
    </header>
    <section class="cards">${statCards}</section>
  </main>
`;
