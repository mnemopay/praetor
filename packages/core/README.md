# @kpanks/core

The runtime substrate every Praetor package builds on. Charter schema,
mission lifecycle, in-memory `ActivityBus`, structured logger, and the
Merkle audit chain (SHA-256, EU AI Act Article 12 ready).

## Install

```bash
npm install @kpanks/core
```

## Public surface

```ts
import {
  ActivityBus,
  InMemoryActivityBus,
  Logger,
  Article12AuditChain,
} from "@kpanks/core";
```

- **Charter schema** — declarative mission spec a charter author writes.
- **`ActivityBus` / `InMemoryActivityBus`** — pub/sub for `tool.start`,
  `tool.end`, `chat.user`, `chat.assistant`, `artifact.*`, `milestone`
  events. Subscribers throwing don't poison the bus.
- **Article 12 audit chain** — append-only Merkle log with bundle export
  (manifest + chain.txt + events.csv + bundle.sha256). Built for the
  Aug 2 2026 EU AI Act enforcement deadline.
- **Logger + sinks** — structured logger that fans out to stdio + JSONL
  + OpenTelemetry sinks.

## License

Apache 2.0.
