# @praetor/vision

Praetor-native vision tools. Cross-platform screen capture (`PraetorScreen`)
+ vision analysis primitives. No third-party screenshot lib in the default
codepath — uses OS-native binaries (`screencapture` on macOS,
`Get-Clipboard` / PowerShell on Windows, `gnome-screenshot` / `scrot` on
Linux).

## Install

```bash
npm install @praetor/vision
```

## Usage

```ts
import { PraetorScreen } from "@praetor/vision";

const screen = new PraetorScreen();
const png = await screen.capture({ region: "fullscreen" });
// png is a Buffer of PNG bytes
```

Used by `@praetor/computer-control` for desktop automation and by
`@praetor/browser` as the vision fallback for canvas / anti-bot pages.

## License

Apache 2.0.
