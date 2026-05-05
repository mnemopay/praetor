/**
 * Library entry point for @kpanks/api.
 *
 * Exposes the app factory and env config so embedders (e.g. the CLI's
 * `praetor serve` command) can import and listen without triggering the
 * auto-start that `index.ts` performs. This file must NOT call listen() or
 * perform any side-effects.
 */
export { createApp } from "./app.js";
export { env, DEV_MODE } from "./env.js";
export type { PraetorApp } from "./http.js";
