import { publish_3d_scene } from "@praetor/world-gen";

const result = publish_3d_scene({
  id: "forest-clearing-01",
  title: "Forest Clearing at Dawn",
  glbUrl: "https://cdn.marble.worldlabs.ai/d71363d3-7754-4e63-8a31-9733ceef92a4/234b9199.glb",
  splatUrl: "https://cdn.marble.worldlabs.ai/d71363d3-7754-4e63-8a31-9733ceef92a4/f153f6dd-ba8f-4190-a101-0abfeb4ae1f8_ceramic_500k.spz",
  background: "#0d0f17",
});
console.log("published:");
console.log(JSON.stringify(result, null, 2));