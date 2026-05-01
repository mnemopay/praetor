/**
 * edit_3d_scene — emit a SuperSplat editor URL for a scene asset. SuperSplat
 * is an open-source, browser-based 3D Gaussian Splat editor (PlayCanvas, MIT
 * license). Praetor doesn't try to reimplement the editor — it composes a
 * preconfigured deep link into SuperSplat with the asset's PLY/SPZ already
 * loaded, and (optionally) a return-callback for save events.
 */

export interface EditSceneArgs {
  /** PLY or SPZ URL the editor should load. */
  assetUrl: string;
  /** Optional title shown in the editor tab. */
  title?: string;
  /** Optional callback URL the editor will POST the edited scene to on save. */
  callbackUrl?: string;
  /** Override SuperSplat host (default https://playcanvas.com/supersplat/editor). */
  editorBaseUrl?: string;
}

export interface EditSceneResult {
  editorUrl: string;
  assetUrl: string;
  callbackUrl?: string;
}

export function edit_3d_scene(args: EditSceneArgs): EditSceneResult {
  if (!args.assetUrl) throw new Error("edit_3d_scene: assetUrl is required");
  const base = args.editorBaseUrl ?? "https://playcanvas.com/supersplat/editor";
  const params = new URLSearchParams();
  params.set("load", args.assetUrl);
  if (args.title) params.set("title", args.title);
  if (args.callbackUrl) params.set("callback", args.callbackUrl);
  return {
    editorUrl: `${base}?${params.toString()}`,
    assetUrl: args.assetUrl,
    callbackUrl: args.callbackUrl,
  };
}
