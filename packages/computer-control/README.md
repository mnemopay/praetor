# @praetor/computer-control

Praetor-native computer-use session. Captures the screen via
`PraetorScreen`, audits every action, streams `tool.*` events on the
charter's ActivityBus. Click / type / scroll / hotkey are exposed
through a pluggable input adapter so the runtime stays cross-platform.

## Install

```bash
npm install @praetor/computer-control
```

## Usage

```ts
import { ComputerControlSession } from "@praetor/computer-control";

const session = new ComputerControlSession({ bus, missionId });
const snap = await session.snapshot();
await session.click({ x: 240, y: 380 });
await session.type("hello");
await session.hotkey(["ctrl", "s"]);
```

The default input adapter uses `nut-tree`'s vendored binary on Windows
and `osascript` / `xdotool` on macOS / Linux respectively. Adapters
declare their `licenseFamily` so charters can refuse non-permissive
backends.

## License

Apache 2.0.
