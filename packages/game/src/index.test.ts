import { describe, it, expect } from "vitest";
import { emitGameHtml, helloGameSpec, type GameSpec } from "./index.js";

describe("emitGameHtml", () => {
  it("emits a single self-contained HTML document", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html.startsWith("<!doctype html>")).toBe(true);
    expect(result.html).toContain("<canvas id=\"game\"");
    expect(result.html).toContain("<title>Praetor — Hello Game</title>");
  });

  it("inlines spec as JSON so the game has no external config", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).toContain('"id": "hello-game"');
    expect(result.html).toContain('"title": "Praetor — Hello Game"');
  });

  it("inlines the charter-supplied tick function", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).toContain("function tick(state, input, dt)");
    expect(result.html).toContain('input.held("up")');
  });

  it("inlines the optional init function", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).toContain("function init(state)");
  });

  it("declares external assets", () => {
    const spec: GameSpec = {
      ...helloGameSpec(),
      sprites: [{ id: "player", src: "https://example.com/player.png" }],
      entities: [{ id: "p", sprite: "player", x: 0, y: 0, width: 32, height: 32 }],
    };
    const result = emitGameHtml(spec);
    expect(result.externalAssets).toEqual(["https://example.com/player.png"]);
  });

  it("rejects invalid specs", () => {
    expect(() => emitGameHtml({ ...helloGameSpec(), id: "" })).toThrow(/id required/);
    expect(() => emitGameHtml({ ...helloGameSpec(), tickSource: "" })).toThrow(/tickSource required/);
    expect(() => emitGameHtml({ ...helloGameSpec(), width: 0 })).toThrow(/width and height/);
  });

  it("rejects entities referencing missing sprites", () => {
    const spec: GameSpec = {
      ...helloGameSpec(),
      sprites: [],
      entities: [{ id: "x", sprite: "nope", x: 0, y: 0, width: 10, height: 10 }],
    };
    expect(() => emitGameHtml(spec)).toThrow(/missing sprite 'nope'/);
  });

  it("uses canvas crisp-edges rendering for pixel-art games", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).toContain("image-rendering: pixelated");
    expect(result.html).toContain("image-rendering: crisp-edges");
  });

  it("supports keyboard + mouse input bindings", () => {
    const spec: GameSpec = {
      ...helloGameSpec(),
      inputs: [
        { action: "up", keys: ["KeyW"] },
        { action: "shoot", mouseButton: 0 },
      ],
    };
    const result = emitGameHtml(spec);
    expect(result.html).toContain('"action": "up"');
    expect(result.html).toContain('"action": "shoot"');
    expect(result.html).toContain('"mouseButton": 0');
  });

  it("byte size is under 8KB for the hello-game (engine + spec inlined)", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.byteSize).toBeLessThan(8 * 1024);
  });
});

/* =========================================================
   Phase 2 — Three.js 3D scene
   ========================================================= */

describe("emitGameHtml — scene3d (Three.js adapter)", () => {
  function make3dSpec(overrides: Partial<GameSpec> = {}): GameSpec {
    return {
      ...helloGameSpec(),
      scene3d: {
        camera: { fov: 75, near: 0.1, far: 1000 },
        background: "#1a1a2e",
        lights: { ambient: 0.5, directional: [{ color: "#ffffff", intensity: 0.8, direction: [1, 2, 1] }] },
      },
      ...overrides,
    };
  }

  it("emits an importmap pointing to cdn.jsdelivr.net/three", () => {
    const result = emitGameHtml(make3dSpec());
    expect(result.html).toContain('<script type="importmap">');
    expect(result.html).toContain("cdn.jsdelivr.net/npm/three@");
    expect(result.html).toContain('"three"');
  });

  it("imports Three.js in the module script", () => {
    const result = emitGameHtml(make3dSpec());
    expect(result.html).toContain('import * as THREE from "three"');
  });

  it("does NOT use the canvas 2d context in the 3D engine runtime", () => {
    // Strip initSource so the inlined SPEC JSON doesn't include a reference
    // to getContext("2d") from the hello-game convenience init function.
    const spec = make3dSpec({ initSource: undefined });
    const result = emitGameHtml(spec);
    // The 3D engine module must not acquire a 2D canvas context.
    expect(result.html).not.toContain('getContext("2d")');
  });

  it("creates a WebGLRenderer (not canvas 2d context)", () => {
    const result = emitGameHtml(make3dSpec());
    expect(result.html).toContain("WebGLRenderer");
  });

  it("sets up PerspectiveCamera with the spec fov/near/far", () => {
    const result = emitGameHtml(make3dSpec());
    expect(result.html).toContain("PerspectiveCamera");
    expect(result.html).toContain("75");   // fov
    expect(result.html).toContain("0.1");  // near
    expect(result.html).toContain("1000"); // far
  });

  it("creates box mesh for entity with mesh.kind=box", () => {
    const spec = make3dSpec({
      entities: [
        {
          id: "cube",
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          mesh: { kind: "box", color: "#ff0000", size: [2, 2, 2] },
        },
      ],
    });
    const result = emitGameHtml(spec);
    expect(result.html).toContain("BoxGeometry");
    expect(result.html).toContain("MeshStandardMaterial");
  });

  it("creates sphere mesh for entity with mesh.kind=sphere", () => {
    const spec = make3dSpec({
      entities: [{ id: "ball", x: 0, y: 0, width: 1, height: 1, mesh: { kind: "sphere", color: "#00ff00" } }],
    });
    const result = emitGameHtml(spec);
    expect(result.html).toContain("SphereGeometry");
  });

  it("creates plane mesh for entity with mesh.kind=plane", () => {
    const spec = make3dSpec({
      entities: [{ id: "floor", x: 0, y: 0, width: 20, height: 20, mesh: { kind: "plane", color: "#333333" } }],
    });
    const result = emitGameHtml(spec);
    expect(result.html).toContain("PlaneGeometry");
  });

  it("loads GLTFLoader for model-glb entities and tracks the src as external asset", () => {
    const spec = make3dSpec({
      entities: [
        { id: "car", x: 0, y: 0, width: 3, height: 2, mesh: { kind: "model-glb", src: "https://example.com/car.glb" } },
      ],
    });
    const result = emitGameHtml(spec);
    expect(result.html).toContain("GLTFLoader");
    expect(result.externalAssets).toContain("https://example.com/car.glb");
  });

  it("keeps the HUD overlay div in 3D mode", () => {
    const spec = make3dSpec({ hudHtml: "<span>score: 0</span>" });
    const result = emitGameHtml(spec);
    expect(result.html).toContain("score: 0");
    expect(result.html).toContain('id="hud"');
  });

  it("validates scene3d.camera.fov > 0", () => {
    expect(() =>
      emitGameHtml(make3dSpec({ scene3d: { camera: { fov: 0, near: 0.1, far: 100 } } }))
    ).toThrow(/fov must be > 0/);
  });

  it("validates scene3d.camera.far > near", () => {
    expect(() =>
      emitGameHtml(make3dSpec({ scene3d: { camera: { fov: 75, near: 10, far: 5 } } }))
    ).toThrow(/far must be > near/);
  });

  it("validates scene3d.lights.ambient is 0-1", () => {
    expect(() =>
      emitGameHtml(make3dSpec({ scene3d: { camera: { fov: 75, near: 0.1, far: 1000 }, lights: { ambient: 2 } } }))
    ).toThrow(/ambient must be 0-1/);
  });

  it("a Phase-1 spec without scene3d still uses 2d canvas path", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).toContain('getContext("2d")');
    expect(result.html).not.toContain("WebGLRenderer");
  });
});

/* =========================================================
   Phase 2 — AABB physics layer
   ========================================================= */

describe("emitGameHtml — physics (AABB adapter)", () => {
  function makePhysicsSpec(mode: "none" | "topdown" | "platformer", overrides: Partial<GameSpec> = {}): GameSpec {
    return {
      ...helloGameSpec(),
      physics: { mode },
      ...overrides,
    };
  }

  it("inlines resolvePhysics when spec.physics is set", () => {
    const result = emitGameHtml(makePhysicsSpec("topdown"));
    expect(result.html).toContain("resolvePhysics");
  });

  it("does NOT inline resolvePhysics when spec.physics is absent", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).not.toContain("resolvePhysics");
  });

  it("applies gravity in platformer mode", () => {
    const result = emitGameHtml(makePhysicsSpec("platformer"));
    // The physics runtime sets vy from gravity in platformer mode.
    expect(result.html).toContain("platformer");
    expect(result.html).toContain("_grounded");
  });

  it("AABB push-out: dynamic entity hit floor — grounded flag set", () => {
    // We can verify the emitted runtime contains the grounded-flag logic.
    const result = emitGameHtml(makePhysicsSpec("platformer", {
      entities: [
        { id: "player", x: 0, y: 0, width: 16, height: 16, solid: true, tags: ["player"], data: {} },
        { id: "floor", x: 0, y: 16, width: 200, height: 16, solid: true, static: true, tags: ["ground"] },
      ],
    }));
    expect(result.html).toContain("_grounded = true");
  });

  it("emits the state.collide() helper", () => {
    const result = emitGameHtml(makePhysicsSpec("none"));
    expect(result.html).toContain("collide(entity, tag)");
    expect(result.html).toContain("_collidingPairs");
  });

  it("validates physics.mode", () => {
    expect(() =>
      emitGameHtml({ ...helloGameSpec(), physics: { mode: "badmode" as "none" } })
    ).toThrow(/physics.mode must be one of/);
  });

  it("topdown mode does NOT apply gravity", () => {
    const result = emitGameHtml(makePhysicsSpec("topdown"));
    // In topdown mode the gravity block is guarded by "platformer" check.
    expect(result.html).toContain("topdown");
    // The grounded logic should NOT appear in topdown.
    expect(result.html).not.toContain("_grounded = true");
  });
});

/* =========================================================
   Phase 2 — Camera / viewport
   ========================================================= */

describe("emitGameHtml — camera adapter", () => {
  function makeCameraSpec(overrides: Partial<GameSpec> = {}): GameSpec {
    return {
      ...helloGameSpec(),
      camera: {
        follow: "player",
        deadzone: { x: 80, y: 60 },
        bounds: { x: 0, y: 0, width: 1600, height: 1200 },
        smoothing: 0.15,
      },
      ...overrides,
    };
  }

  it("inlines tickCamera + applyCamera + resetCamera when spec.camera is set", () => {
    const result = emitGameHtml(makeCameraSpec());
    expect(result.html).toContain("tickCamera");
    expect(result.html).toContain("applyCamera");
    expect(result.html).toContain("resetCamera");
  });

  it("does NOT inline camera code when spec.camera is absent", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).not.toContain("tickCamera");
  });

  it("follows the named entity id in the emitted code", () => {
    const result = emitGameHtml(makeCameraSpec());
    expect(result.html).toContain('"player"'); // entity id injected into follow lookup
  });

  it("inlines bounds clamping when spec.camera.bounds is set", () => {
    const result = emitGameHtml(makeCameraSpec());
    expect(result.html).toContain("bnd.x");
    expect(result.html).toContain("bnd.width");
  });

  it("exposes state.camera.x / y to tick logic", () => {
    const result = emitGameHtml(makeCameraSpec());
    expect(result.html).toContain("state.camera");
  });

  it("applies ctx.save() / ctx.translate() / ctx.restore() in 2D mode", () => {
    const result = emitGameHtml(makeCameraSpec());
    expect(result.html).toContain("ctx.save()");
    expect(result.html).toContain("ctx.translate(");
    expect(result.html).toContain("ctx.restore()");
  });

  it("validates camera.smoothing is in [0, 1)", () => {
    expect(() =>
      emitGameHtml(makeCameraSpec({ camera: { follow: "player", smoothing: 1.5 } }))
    ).toThrow(/smoothing must be in/);
    expect(() =>
      emitGameHtml(makeCameraSpec({ camera: { follow: "player", smoothing: -0.1 } }))
    ).toThrow(/smoothing must be in/);
  });

  it("camera works in 3D mode — emits tick3dCamera", () => {
    const spec: GameSpec = {
      ...helloGameSpec(),
      scene3d: { camera: { fov: 75, near: 0.1, far: 1000 } },
      camera: { follow: "player", smoothing: 0.1 },
    };
    const result = emitGameHtml(spec);
    expect(result.html).toContain("tick3dCamera");
    expect(result.html).toContain("camera3d.position");
  });

  it("no-camera 2D spec has no ctx.save() in render path", () => {
    const result = emitGameHtml(helloGameSpec());
    expect(result.html).not.toContain("ctx.save()");
  });
});
