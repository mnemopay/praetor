// Live smoke test for World Labs Marble. Calls generate_3d_world once with
// detail=draft (~$0.18, ~230 credits) and prints the resulting manifest.
import { generate_3d_world, defaultSelector } from "@praetor/world-gen";

const args = {
  prompt: "a quiet forest clearing at dawn, low-poly stylized, soft fog, distant pine trees",
  detail: "draft",
  backend: "worldlabs",
};

console.log("[live-test] requesting world:");
console.log("   prompt :", args.prompt);
console.log("   detail :", args.detail);
console.log("   backend:", args.backend);
console.log("   key len:", (process.env.WORLDLABS_API_KEY ?? "").length);
console.log("   base   :", process.env.WORLDLABS_BASE_URL ?? "(default)");
console.log();

const t0 = Date.now();
try {
  const result = await generate_3d_world(args, {
    selector: defaultSelector(),
    missionId: "live-smoke-" + Date.now(),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[live-test] OK in ${secs}s`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`[live-test] FAILED after ${secs}s:`, err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
}
