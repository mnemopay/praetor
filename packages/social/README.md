# @praetor/social

Social-media tooling for Praetor charters. Cross-platform post drafting,
scheduling primitives, and platform-specific size/length validation
(Twitter/X, LinkedIn, Threads, Instagram, TikTok, Bluesky).

## Install

```bash
npm install @praetor/social
```

## Usage

```ts
import { drafts, validate } from "@praetor/social";

const draft = drafts.compose({
  text: "Linger.chat is live in DFW.",
  platforms: ["twitter", "linkedin"],
});
validate(draft); // throws if any platform's caps are violated
```

For end-to-end posting (rate limits, OAuth, retries), use the
`bizsuite-publisher` agent in the BizSuite repo — this package owns the
draft + validation surface only.

## License

Apache 2.0.
