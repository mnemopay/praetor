import { defineConfig } from "vite";

// Pinned to 5180 so we don't clash with codex / Next.js / other vite projects
// that default to 5173-5179. See mnemopay memory: division-of-labor port map.
export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
  },
});
