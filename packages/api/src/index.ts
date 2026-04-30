import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();

app.listen(env.port, env.host, () => {
  process.stdout.write(`[praetor-api] listening on http://${env.host}:${env.port}\n`);
});
