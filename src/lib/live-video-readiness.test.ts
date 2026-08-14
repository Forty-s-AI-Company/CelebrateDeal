import { describe, expect, it } from "vitest";
import { isLiveVideoReady, liveReadyVideoWhere, type LiveVideoReadiness } from "./live-video-readiness";

const base: LiveVideoReadiness = {
  sourceType: "cloudflare_stream",
  status: "processing",
  cloudflareReadyToStream: false,
  cloudflareLiveInputUid: null,
  liveInputStatus: null,
};

describe("live video readiness", () => {
  it("rejects a provisioned or failed Stream upload until the provider confirms readiness", () => {
    expect(isLiveVideoReady(base)).toBe(false);
    expect(isLiveVideoReady({ ...base, status: "ready" })).toBe(false);
    expect(isLiveVideoReady({ ...base, status: "ready", cloudflareReadyToStream: true })).toBe(true);
  });

  it("accepts only ready external URLs and server-created Live Inputs", () => {
    expect(isLiveVideoReady({ ...base, sourceType: "url", status: "ready" })).toBe(true);
    expect(isLiveVideoReady({ ...base, sourceType: "url", status: "archived" })).toBe(false);
    expect(isLiveVideoReady({
      ...base,
      sourceType: "cloudflare_live",
      cloudflareLiveInputUid: "live-input-1",
      liveInputStatus: "created",
    })).toBe(true);
  });

  it("builds the same current-vendor fail-closed query used by forms and actions", () => {
    expect(liveReadyVideoWhere("vendor-1", "video-1")).toMatchObject({
      id: "video-1",
      vendorId: "vendor-1",
      OR: expect.arrayContaining([
        { sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true },
      ]),
    });
  });
});
