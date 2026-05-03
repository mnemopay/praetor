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
