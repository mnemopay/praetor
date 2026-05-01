import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderGlbViewerHtml, renderSplatViewerHtml } from "../viewer/index.js";

export interface PublishSceneArgs {
  /** Stable id for the scene — becomes the URL slug. */
  id: string;
  /** GLB asset URL. Provide either glbUrl or splatUrl (or both). */
  glbUrl?: string;
  /** SPZ/PLY splat asset URL. */
  splatUrl?: string;
  /** Scene title (shown in viewer chrome). */
  title?: string;
  /** Optional CSS background. */
  background?: string;
  /** Where to write the HTML. Default: `<cwd>/praetor-out/scenes`. */
  outDir?: string;
}

export interface PublishSceneResult {
  id: string;
  files: string[];
  /** A relative URL the dashboard / API can serve. */
  viewerPath: string;
}

/**
 * Write a self-contained viewer HTML for a generated asset. The output is
 * static — `praetor design serve` (or any HTTP server) can host it directly.
 */
export function publish_3d_scene(args: PublishSceneArgs): PublishSceneResult {
  if (!args.glbUrl && !args.splatUrl) {
    throw new Error("publish_3d_scene: provide glbUrl or splatUrl");
  }
  const id = sanitize(args.id);
  if (!id) throw new Error("publish_3d_scene: id must be non-empty after sanitization");

  const outRoot = resolve(args.outDir ?? join(process.cwd(), "praetor-out", "scenes"));
  const dir = join(outRoot, id);
  mkdirSync(dir, { recursive: true });

  const written: string[] = [];

  if (args.splatUrl) {
    const html = renderSplatViewerHtml({ splatUrl: args.splatUrl, title: args.title, background: args.background });
    const p = join(dir, "world.html");
    writeFileSync(p, html);
    written.push(p);
  }
  if (args.glbUrl) {
    const html = renderGlbViewerHtml({ glbUrl: args.glbUrl, title: args.title, background: args.background });
    const p = join(dir, "model.html");
    writeFileSync(p, html);
    written.push(p);
  }
  // Pick the splat viewer as the canonical index when both are present.
  const indexBody = args.splatUrl
    ? renderSplatViewerHtml({ splatUrl: args.splatUrl, title: args.title, background: args.background })
    : renderGlbViewerHtml({ glbUrl: args.glbUrl!, title: args.title, background: args.background });
  const indexPath = join(dir, "index.html");
  writeFileSync(indexPath, indexBody);
  written.push(indexPath);

  // Plus a manifest the API/dashboard can use to render the gallery.
  const manifest = {
    id,
    title: args.title ?? id,
    glbUrl: args.glbUrl ?? null,
    splatUrl: args.splatUrl ?? null,
    publishedAt: new Date().toISOString(),
    emittedBy: "praetor/world-gen",
  };
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  written.push(manifestPath);

  return {
    id,
    files: written,
    viewerPath: `/scenes/${id}/index.html`,
  };
}

function sanitize(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
