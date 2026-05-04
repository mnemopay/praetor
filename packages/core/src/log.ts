/**
 * Process-wide default PraetorLogger instance.
 *
 * All packages in the monorepo import from here so telemetry is always
 * co-located in the same structured stream, with the same redaction rules,
 * without any package-level wiring.
 *
 * Environment controls:
 *   PRAETOR_LOG_LEVEL  — "debug" | "info" (default) | "warn" | "error"
 *   SENTRY_DSN         — if set, auto-wires a SentrySink
 *   NODE_ENV           — forwarded to Sentry as `environment`
 */

import { PraetorLogger, JsonStdoutSink } from "./logger.js";
import { SentrySink } from "./sinks/sentry.js";

const minLevel = (process.env["PRAETOR_LOG_LEVEL"] ?? "info") as
  | "debug"
  | "info"
  | "warn"
  | "error";

export const log = new PraetorLogger({
  sinks: [new JsonStdoutSink()],
  minLevel,
});

if (process.env["SENTRY_DSN"]) {
  log.addSink(
    new SentrySink({
      dsn: process.env["SENTRY_DSN"],
      environment: process.env["NODE_ENV"],
    }),
  );
}
