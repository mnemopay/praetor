/**
 * MockThreeDAdapter — deterministic fake for tests + the test fall-back when
 * no real backend has been attached. Returns a stable canned URL set so test
 * assertions can pin against it.
 */

import type { ImageTo3DRequest, LicenseFamily, Praetor3DAdapter, TextTo3DRequest, ThreeDBackend, ThreeDResult } from "../index.js";

export class MockThreeDAdapter implements Praetor3DAdapter {
  readonly backend: ThreeDBackend = "mock";
  readonly licenseFamily: LicenseFamily = "apache_or_mit";
  readonly displayName = "Mock 3D adapter (test only)";

  async imageTo3D(req: ImageTo3DRequest): Promise<ThreeDResult> {
    return {
      glbUrl: `mock://glb/${encodeURIComponent(req.imageUrl)}`,
      previewUrls: [`mock://preview/${encodeURIComponent(req.imageUrl)}/0`],
      backend: this.backend,
      licenseFamily: this.licenseFamily,
      durationSec: 0,
    };
  }

  async textTo3D(req: TextTo3DRequest): Promise<ThreeDResult> {
    return {
      glbUrl: `mock://glb/text/${encodeURIComponent(req.prompt)}`,
      previewUrls: [`mock://preview/text/${encodeURIComponent(req.prompt)}/0`],
      backend: this.backend,
      licenseFamily: this.licenseFamily,
      durationSec: 0,
    };
  }
}
