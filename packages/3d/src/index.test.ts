import { describe, it, expect, vi } from "vitest";
import { Praetor3D, MockThreeDAdapter, ReplicateTrellisAdapter, HuggingFaceTrellisAdapter } from "./index.js";

describe("Praetor3D facade", () => {
  it("throws when no adapter is attached", async () => {
    const studio = new Praetor3D();
    await expect(studio.imageTo3D({ imageUrl: "https://example.com/x.png" })).rejects.toThrow(/no adapter attached/);
  });

  it("dispatches imageTo3D through MockThreeDAdapter", async () => {
    const studio = new Praetor3D({ adapter: new MockThreeDAdapter() });
    const r = await studio.imageTo3D({ imageUrl: "https://example.com/photo.png" });
    expect(r.backend).toBe("mock");
    expect(r.glbUrl).toBe("mock://glb/https%3A%2F%2Fexample.com%2Fphoto.png");
    expect(r.licenseFamily).toBe("apache_or_mit");
  });

  it("dispatches textTo3D through MockThreeDAdapter", async () => {
    const studio = new Praetor3D({ adapter: new MockThreeDAdapter() });
    const r = await studio.textTo3D({ prompt: "a tall ceramic vase" });
    expect(r.glbUrl).toContain("text/");
  });

  it("refuses adapter that doesn't implement textTo3D", async () => {
    const studio = new Praetor3D({
      adapter: {
        backend: "huggingface-trellis",
        licenseFamily: "apache_or_mit",
        displayName: "stub",
        async imageTo3D() {
          return { glbUrl: "", previewUrls: [], backend: "huggingface-trellis", licenseFamily: "apache_or_mit", durationSec: 0 };
        },
      },
    });
    await expect(studio.textTo3D({ prompt: "x" })).rejects.toThrow(/does not implement textTo3D/);
  });

  it("license-family allowlist refuses non-permissive backends", async () => {
    const proprietaryAdapter = {
      backend: "replicate-trellis" as const,
      licenseFamily: "proprietary" as const,
      displayName: "imaginary paid backend",
      async imageTo3D() {
        return { glbUrl: "x", previewUrls: [], backend: "replicate-trellis" as const, licenseFamily: "proprietary" as const, durationSec: 0 };
      },
    };
    const studio = new Praetor3D({ adapter: proprietaryAdapter, allowedLicenseFamilies: ["apache_or_mit"] });
    await expect(studio.imageTo3D({ imageUrl: "https://example.com/x.png" })).rejects.toThrow(/license family/);
  });

  it("publishes tool.start / tool.end events when bus + missionId are configured", async () => {
    const events: Array<{ kind: string; ok?: boolean }> = [];
    const bus = {
      publish: (e: { kind: string; ok?: boolean }) => { events.push(e); },
      subscribe: () => () => {},
    };
    const studio = new Praetor3D({ adapter: new MockThreeDAdapter(), bus, missionId: "m-1" });
    await studio.imageTo3D({ imageUrl: "https://example.com/p.png" });
    expect(events.map((e) => e.kind)).toEqual(["tool.start", "tool.end"]);
    expect(events[1].ok).toBe(true);
  });
});

describe("ReplicateTrellisAdapter", () => {
  it("posts to /predictions then polls until succeeded and returns the GLB URL", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fakeFetch: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push({ url: u, method: init?.method });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: "pred-123", status: "starting" }), { status: 201 });
      }
      // Two polls: first processing, then succeeded
      const calln = calls.filter((c) => c.url.endsWith("pred-123") && c.method !== "POST").length;
      const status = calln === 1 ? "processing" : "succeeded";
      const output = status === "succeeded"
        ? { model_file: "https://replicate.delivery/abc/out.glb", color_video: "https://replicate.delivery/abc/preview.mp4" }
        : undefined;
      return new Response(JSON.stringify({ id: "pred-123", status, output }), { status: 200 });
    }) as typeof fetch;

    const adapter = new ReplicateTrellisAdapter({
      token: "r8_test",
      fetchImpl: fakeFetch,
      sleep: vi.fn().mockResolvedValue(undefined) as () => Promise<void>,
      pollIntervalMs: 1,
    });
    const r = await adapter.imageTo3D({ imageUrl: "https://example.com/face.png" });
    expect(r.glbUrl).toBe("https://replicate.delivery/abc/out.glb");
    expect(r.previewUrls).toEqual(["https://replicate.delivery/abc/preview.mp4"]);
    expect(r.backend).toBe("replicate-trellis");
    expect(r.adapterId).toBe("pred-123");
    expect(r.costUsd).toBe(0.035);
    expect(calls[0].method).toBe("POST");
    expect(calls.length).toBeGreaterThanOrEqual(3); // 1 create + 2 polls
  });

  it("throws on failed prediction", async () => {
    const fakeFetch: typeof fetch = (async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: "p2", status: "starting" }), { status: 201 });
      }
      return new Response(JSON.stringify({ id: "p2", status: "failed", error: "image too small" }), { status: 200 });
    }) as typeof fetch;
    const adapter = new ReplicateTrellisAdapter({
      token: "r8_test",
      fetchImpl: fakeFetch,
      sleep: () => Promise.resolve(),
      pollIntervalMs: 1,
    });
    await expect(adapter.imageTo3D({ imageUrl: "x" })).rejects.toThrow(/failed/);
  });

  it("requires a token", () => {
    expect(() => new ReplicateTrellisAdapter({ token: "" })).toThrow(/token is required/);
  });
});

describe("HuggingFaceTrellisAdapter", () => {
  it("requires endpointUrl + token", () => {
    expect(() => new HuggingFaceTrellisAdapter({ endpointUrl: "", token: "x" })).toThrow(/endpointUrl is required/);
    expect(() => new HuggingFaceTrellisAdapter({ endpointUrl: "https://x", token: "" })).toThrow(/token is required/);
  });

  it("posts to the endpoint and returns the parsed result", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ glbUrl: "https://hf.endpoint/out.glb", previews: [] }), { status: 200 })) as typeof fetch;
    const adapter = new HuggingFaceTrellisAdapter({
      endpointUrl: "https://x.endpoints.huggingface.cloud",
      token: "hf_test",
      fetchImpl: fakeFetch,
    });
    const r = await adapter.imageTo3D({ imageUrl: "https://example.com/y.png" });
    expect(r.glbUrl).toBe("https://hf.endpoint/out.glb");
    expect(r.backend).toBe("huggingface-trellis");
    expect(r.licenseFamily).toBe("apache_or_mit");
  });
});
