/**
 * Praetor structured logger.
 *
 * Zero external dependencies. Default sink writes JSON-lines to stdout
 * (debug/info) or stderr (warn/error) for grep-ability.
 *
 * The public surface matches the spec exactly so any package can do:
 *
 *   import { log } from "@kpanks/core";
 *   log.info("mission started", { missionId, budget: charter.budget.maxUsd });
 *
 * The default process-wide `log` instance auto-wires a SentrySink when
 * SENTRY_DSN is set in the environment.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LogEvent {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Free-form structured fields. Auto-redacted before reaching sinks. */
  fields?: Record<string, unknown>;
  /** Optional correlation id — mission id, request id, etc. */
  correlationId?: string;
}

export interface LoggerSink {
  emit(event: LogEvent): void;
}

// ─── Level ordering ──────────────────────────────────────────────────────────

const LEVELS: LogEvent["level"][] = ["debug", "info", "warn", "error"];

function levelOrdinal(l: LogEvent["level"]): number {
  return LEVELS.indexOf(l);
}

// ─── Field redaction ─────────────────────────────────────────────────────────
// Intentionally self-contained (~10 lines) to avoid a circular dep with
// @kpanks/tools which has its own copy of this logic.

/**
 * Default field redactor. Strips values whose key matches the sensitive-field
 * pattern, truncates long string values. Same semantics as @kpanks/tools.
 */
export function defaultRedact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/(api[_-]?key|token|secret|password|auth)/i.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Built-in sink ───────────────────────────────────────────────────────────

/**
 * Writes one JSON line per event to process.stdout (debug/info) or
 * process.stderr (warn/error). `level` and `ts` come first for grep-ability.
 */
export class JsonStdoutSink implements LoggerSink {
  emit(event: LogEvent): void {
    const { level, ts, message, fields, correlationId } = event;
    const line: Record<string, unknown> = { level, ts, message };
    if (correlationId !== undefined) line["correlationId"] = correlationId;
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        line[k] = v;
      }
    }
    const serialized = JSON.stringify(line) + "\n";
    if (level === "warn" || level === "error") {
      process.stderr.write(serialized);
    } else {
      process.stdout.write(serialized);
    }
  }
}

// ─── Logger ──────────────────────────────────────────────────────────────────

export interface PraetorLoggerOptions {
  sinks?: LoggerSink[];
  minLevel?: LogEvent["level"];
  redact?: (fields: Record<string, unknown>) => Record<string, unknown>;
  /** Extra fields pre-bound to every event (used by child loggers). */
  _boundFields?: Record<string, unknown>;
  /** Correlation id pre-bound to every event (used by child loggers). */
  _boundCorrelationId?: string;
}

export class PraetorLogger {
  private sinks: LoggerSink[];
  private readonly minLevel: LogEvent["level"];
  private readonly redact: (fields: Record<string, unknown>) => Record<string, unknown>;
  private readonly boundFields: Record<string, unknown>;
  private readonly boundCorrelationId: string | undefined;

  constructor(opts: PraetorLoggerOptions = {}) {
    this.sinks = opts.sinks ? [...opts.sinks] : [new JsonStdoutSink()];
    this.minLevel = opts.minLevel ?? "info";
    this.redact = opts.redact ?? defaultRedact;
    this.boundFields = opts._boundFields ?? {};
    this.boundCorrelationId = opts._boundCorrelationId;
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this._emit("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this._emit("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this._emit("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this._emit("error", message, fields);
  }

  /**
   * Returns a child logger with extra fields (and an optional correlationId)
   * pre-bound onto every emitted event. Child shares the same sinks and
   * minLevel as the parent — adding a sink to the parent after child creation
   * will NOT retroactively affect the child.
   */
  child(extraFields: Record<string, unknown>): PraetorLogger {
    const merged = { ...this.boundFields, ...extraFields };
    const correlationId = (extraFields["correlationId"] as string | undefined) ?? this.boundCorrelationId;
    return new PraetorLogger({
      sinks: this.sinks,
      minLevel: this.minLevel,
      redact: this.redact,
      _boundFields: merged,
      _boundCorrelationId: correlationId,
    });
  }

  /** Add a sink at runtime (e.g. wire in SentrySink after DSN is known). */
  addSink(sink: LoggerSink): void {
    this.sinks.push(sink);
  }

  /** Remove a previously added sink. No-op if not present. */
  removeSink(sink: LoggerSink): void {
    this.sinks = this.sinks.filter((s) => s !== sink);
  }

  private _emit(level: LogEvent["level"], message: string, extraFields?: Record<string, unknown>): void {
    if (levelOrdinal(level) < levelOrdinal(this.minLevel)) return;

    const rawFields: Record<string, unknown> = { ...this.boundFields, ...(extraFields ?? {}) };
    const fields = Object.keys(rawFields).length > 0 ? this.redact(rawFields) : undefined;

    const correlationId = (rawFields["correlationId"] as string | undefined) ?? this.boundCorrelationId;

    const event: LogEvent = {
      level,
      message,
      ts: new Date().toISOString(),
      ...(fields ? { fields } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    };

    for (const sink of this.sinks) {
      try {
        sink.emit(event);
      } catch {
        // A throwing sink must never poison other sinks or the caller.
      }
    }
  }
}
