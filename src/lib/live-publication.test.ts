import { describe, expect, it } from "vitest";
import {
  getLivePublicationIssue,
  hasForeignLiveRelations,
  isLivePubliclyAccessible,
} from "@/lib/live-publication";

describe("public live publication policy", () => {
  it.each([
    ["scheduled", false, true],
    ["live", false, true],
    ["ended", true, true],
    ["ended", false, false],
    ["draft", true, false],
    ["archived", true, false],
  ])("status=%s replay=%s accessible=%s", (status, replayEnabled, expected) => {
    expect(isLivePubliclyAccessible(status, replayEnabled)).toBe(expected);
  });
});

describe("live publication media requirements", () => {
  it("allows incomplete media while the room remains a draft", () => {
    expect(getLivePublicationIssue({ status: "draft", streamMode: "vod", videoId: null, videoStatus: null, cloudflareLiveInputUid: null })).toBeNull();
  });

  it("requires a ready VOD before a room becomes public", () => {
    expect(getLivePublicationIssue({ status: "scheduled", streamMode: "vod", videoId: null, videoStatus: null, cloudflareLiveInputUid: null })).toBe("vod_video_required");
    expect(getLivePublicationIssue({ status: "scheduled", streamMode: "vod", videoId: "video-1", videoStatus: "processing", cloudflareLiveInputUid: null })).toBe("vod_video_not_ready");
    expect(getLivePublicationIssue({ status: "live", streamMode: "vod", videoId: "video-1", videoStatus: "ready", cloudflareLiveInputUid: null })).toBeNull();
  });

  it("requires a Cloudflare Live Input UID for live mode", () => {
    expect(getLivePublicationIssue({ status: "scheduled", streamMode: "live", videoId: null, videoStatus: null, cloudflareLiveInputUid: null })).toBe("live_input_required");
    expect(getLivePublicationIssue({ status: "live", streamMode: "live", videoId: null, videoStatus: null, cloudflareLiveInputUid: "input-1" })).toBe("live_input_mapping_required");
    expect(getLivePublicationIssue({ status: "live", streamMode: "live", videoId: "video-1", videoStatus: "processing", cloudflareLiveInputUid: "input-1" })).toBeNull();
  });
});

describe("public live tenant defense", () => {
  const base = {
    vendorId: "vendor-a",
    video: null,
    form: null,
    interactionScript: null,
    products: [{ productId: "product-a", product: { vendorId: "vendor-a" } }],
  };

  it("accepts same-vendor public relations", () => {
    expect(hasForeignLiveRelations(base)).toBe(false);
  });

  it("rejects historical foreign product and role relations", () => {
    expect(hasForeignLiveRelations({ ...base, products: [{ productId: "product-b", product: { vendorId: "vendor-b" } }] })).toBe(true);
    expect(hasForeignLiveRelations({
      ...base,
      interactionScript: {
        vendorId: "vendor-a",
        events: [{ productId: "product-a", role: { vendorId: "vendor-b" } }],
      },
    })).toBe(true);
  });
});
