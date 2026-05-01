/**
 * @praetor/world-gen — native text/image -> 3D model and text/image/video ->
 * 3D world generation. Backend-agnostic so the same Praetor tool surface
 * works against TRELLIS-2, Hunyuan3D, Tripo, fal sam-3d, World Labs Marble,
 * Tencent HY-World 2.0, or a self-hosted endpoint.
 *
 *     import {
 *       defaultSelector, generate_3d_model, generate_3d_world,
 *       publish_3d_scene, edit_3d_scene,
 *     } from "@praetor/world-gen";
 *
 *     const result = await generate_3d_model(
 *       { prompt: "low-poly red helmet", detail: "draft" },
 *       { selector: defaultSelector() }
 *     );
 *     publish_3d_scene({ id: "helmet", glbUrl: result.glbUrl, title: "Helmet" });
 */

export * from "./types.js";
export { defaultSelector, resetDefaultSelector, DefaultWorldGenSelector } from "./backends/selector.js";
export type { WorldGenSelector } from "./backends/selector.js";
export { Trellis2Backend } from "./backends/trellis2.js";
export { Hunyuan3dBackend } from "./backends/hunyuan3d.js";
export { TripoBackend } from "./backends/tripo.js";
export { FalSam3dBackend } from "./backends/fal.js";
export { WorldLabsBackend } from "./backends/worldlabs.js";
export { HyWorldBackend } from "./backends/hyworld.js";
export { MockModelBackend, MockWorldBackend } from "./backends/mock.js";

export { generate_3d_model } from "./tools/generate_3d_model.js";
export type { GenerateModelArgs, GenerateModelDeps } from "./tools/generate_3d_model.js";
export { generate_3d_world } from "./tools/generate_3d_world.js";
export type { GenerateWorldArgs, GenerateWorldDeps } from "./tools/generate_3d_world.js";
export { edit_3d_scene } from "./tools/edit_3d_scene.js";
export type { EditSceneArgs, EditSceneResult } from "./tools/edit_3d_scene.js";
export { publish_3d_scene } from "./tools/publish_3d_scene.js";
export type { PublishSceneArgs, PublishSceneResult } from "./tools/publish_3d_scene.js";

export { renderGlbViewerHtml, renderSplatViewerHtml } from "./viewer/index.js";
export type { ModelViewerOptions, SplatViewerOptions } from "./viewer/index.js";
