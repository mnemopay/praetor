/**
 * SentrySink — opt-in Sentry adapter for PraetorLogger.
 *
 * @sentry/node is an optional peer dep. This module lazy-imports it on the
 * first emit() call using the same non-literal specifier trick as KokoroAdapter,
 * so TypeScript's static resolver does not treat it as a hard dep.
 *
 * When @sentry/node is not installed the sink degrades to a one-time stderr
 * warning and becomes a no-op. It never throws.
 *
 * Usage:
 *   import { log } from "@praetor/core";
 *   import { SentrySink } from "@praetor/core/sinks/sentry";
 *   log.addSink(new SentrySink({ dsn: process.env.SENTRY_DSN! }));
 *
 * Or let the default `log` instance wire it automatically via SENTRY_DSN env.
 */

import type { LogEvent, LoggerSink } from "../logger.js";

export interface SentrySinkOptions {
  dsn: string;
  environment?: string;
  release?: string;
  /** Tag every Sentry event with these by default. */
  defaultTags?: Record<string, string>;
}

// Minimal type stubs so the lazy import doesn't need @types/sentry.
interface SentryModule {
  init(opts: { dsn: string; environment?: string; release?: string }): void;
  addBreadcrumb(crumb: {
    category?: string;
    message: string;
    level?: string;
    data?: Record<string, unknown>;
  }): void;
  captureMessage(
    message: string,
    opts?: {
      level?: string;
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    },
  ): string;
  withScope(cb: (scope: SentryScope) => void): void;
}

interface SentryScope {
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
}

let _warnedOnce = false;

export class SentrySink implements LoggerSink {
  private readonly opts: SentrySinkOptions;
  private sentryMod: SentryModule | null = null;
  private loadPromise: Promise<void> | null = null;
  /** Injected in tests to bypass real dynamic import. */
  __inject?: SentryModule;

  constructor(opts: SentrySinkOptions) {
    this.opts = opts;
  }

  /** Exposed for testing — allows injecting a mock Sentry module. */
  _setInjected(mod: SentryModule): void {
    this.__inject = mod;
    this.sentryMod = mod;
  }

  emit(event: LogEvent): void {
    // Fire-and-forget load; first emit triggers initialization.
    void this._ensureAndEmit(event);
  }

  private async _ensureAndEmit(event: LogEvent): Promise<void> {
    const sentry = await this._load();
    if (!sentry) return; // peer dep missing — already warned

    try {
      this._dispatchToSentry(sentry, event);
    } catch {
      // Never throw from a sink.
    }
  }

  private async _load(): Promise<SentryModule | null> {
    if (this.__inject) return this.__inject;
    if (this.sentryMod) return this.sentryMod;
    if (this.loadPromise) {
      await this.loadPromise;
      return this.sentryMod;
    }

    this.loadPromise = (async () => {
      try {
        // Non-literal specifier so TS skips static resolution of the optional dep.
        const specifier = "@sentry/node";
        const mod = (await import(/* @vite-ignore */ specifier)) as unknown as SentryModule;
        mod.init({
          dsn: this.opts.dsn,
          environment: this.opts.environment,
          release: this.opts.release,
        });
        this.sentryMod = mod;
      } catch {
        if (!_warnedOnce) {
          _warnedOnce = true;
          process.stderr.write(
            "[praetor.sentry] @sentry/node not installed; SentrySink is a no-op\n",
          );
        }
        this.sentryMod = null;
      }
    })();

    await this.loadPromise;
    return this.sentryMod;
  }

  private _dispatchToSentry(sentry: SentryModule, event: LogEvent): void {
    const { level, message, fields, correlationId } = event;
    const tags: Record<string, string> = { ...this.opts.defaultTags };
    if (correlationId) tags["praetor.correlation_id"] = correlationId;

    if (level === "error") {
      sentry.withScope((scope) => {
        for (const [k, v] of Object.entries(tags)) {
          scope.setTag(k, v);
        }
        if (fields) {
          for (const [k, v] of Object.entries(fields)) {
            scope.setExtra(k, v);
          }
        }
        sentry.captureMessage(message, { level: "error" });
      });
    } else {
      // info / warn / debug → breadcrumbs
      sentry.addBreadcrumb({
        category: "praetor",
        message,
        level: level === "warn" ? "warning" : level,
        data: fields,
      });
    }
  }
}
