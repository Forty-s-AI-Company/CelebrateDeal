import { describe, expect, it } from "vitest";
import { parseCloudflareStreamUrl } from "@/lib/cloudflare-stream-signing";
import {
  isCloudflareStreamHostedUrl,
  isSelfReportedStreamUrlVideo,
  isWaitingVideoOption,
  isWaitingVideoPlayable,
  isWithinWaitingVideoWindow,
  toLiveVideoOption,
  WAITING_VIDEO_MANUAL_START_GRACE_SECONDS,
  WAITING_VIDEO_TOKEN_GRACE_SECONDS,
  waitingVideoGraceSeconds,
} from "@/lib/live-waiting-video";

const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const streamUrls = [
  `https://videodelivery.net/${uid}/manifest/video.m3u8`,
  `https://customer-abc123.cloudflarestream.com/${uid}/manifest/video.mpd`,
  // Not accepted by parseCloudflareStreamUrl, but each still plays Stream content of any length.
  `https://videodelivery.net/${uid}/manifest/video.m3u8?clientBandwidthHint=10`,
  `https://iframe.videodelivery.net/${uid}`,
  `https://customer-abc123.cloudflarestream.com/${uid}/iframe`,
  `https://watch.cloudflarestream.com/${uid}`,
  `HTTPS://VIDEODELIVERY.NET./${uid}/manifest/video.m3u8`,
  `  https://videodelivery.net/${uid}/downloads/default.mp4  `,
  `http://videodelivery.net/${uid}/manifest/video.m3u8`,
];

describe("isCloudflareStreamHostedUrl (review m-A)", () => {
  it("recognizes every URL the Stream signer parses, and wider Stream addresses", () => {
    for (const url of streamUrls) expect(isCloudflareStreamHostedUrl(url), url).toBe(true);
    for (const url of streamUrls.slice(0, 2)) expect(parseCloudflareStreamUrl(url, "playback"), url).not.toBeNull();
  });

  it("leaves other hosts, look-alikes and unparsable values alone", () => {
    for (const url of [
      "https://video.example.test/loop.mp4",
      "https://videodelivery.net.example.test/loop.m3u8",
      "https://notvideodelivery.net/loop.m3u8",
      "https://cloudflarestream.com.evil.test/loop.m3u8",
      "https://example.test/?next=https://videodelivery.net/x",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(isCloudflareStreamHostedUrl(url), String(url)).toBe(false);
    }
  });

  it("refuses only a merchant-entered URL; provider rows take their length from Cloudflare", () => {
    expect(isSelfReportedStreamUrlVideo({ sourceType: "url", videoUrl: streamUrls[0] })).toBe(true);
    expect(isSelfReportedStreamUrlVideo({ sourceType: "cloudflare_stream", videoUrl: streamUrls[0] })).toBe(false);
    expect(isSelfReportedStreamUrlVideo({ sourceType: "url", videoUrl: "https://video.example.test/loop.mp4" })).toBe(false);
  });

  it("drops the URL from a studio option and keeps only the flag", () => {
    const option = toLiveVideoOption({ id: "v-1", title: "等候", sourceType: "url", durationSec: 60, videoUrl: streamUrls[0]! });
    expect(option).toEqual({ id: "v-1", title: "等候", sourceType: "url", durationSec: 60, selfReportedStreamUrl: true });
    expect(isWaitingVideoOption(option)).toBe(false);

    const plain = toLiveVideoOption({ id: "v-2", title: "等候", sourceType: "url", durationSec: 60, videoUrl: "https://video.example.test/loop.mp4" });
    expect(plain).not.toHaveProperty("videoUrl");
    expect(isWaitingVideoOption(plain)).toBe(true);
    const provider = toLiveVideoOption({ id: "v-3", title: "等候", sourceType: "cloudflare_stream", durationSec: 60, videoUrl: streamUrls[0]! });
    expect(isWaitingVideoOption(provider)).toBe(true);
  });

  it("refuses a self-reported Stream URL at playback even for an existing binding", () => {
    const live = { vendorId: "vendor-1", videoId: "main-1", waitingVideoId: "loop-1" };
    const video = {
      vendorId: "vendor-1",
      sourceType: "url",
      status: "ready",
      durationSec: 60,
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    };
    expect(isWaitingVideoPlayable({ ...video, videoUrl: "https://video.example.test/loop.mp4" }, live)).toBe(true);
    for (const videoUrl of streamUrls) {
      expect(isWaitingVideoPlayable({ ...video, videoUrl }, live), videoUrl).toBe(false);
    }
  });
});

describe("waiting video window (review m-B)", () => {
  const start = Date.parse("2026-11-27T10:00:00.000Z");

  it("gives only a manually started live show 30 minutes after its start", () => {
    expect(waitingVideoGraceSeconds({ streamMode: "live", followsSharedStart: true })).toBe(WAITING_VIDEO_MANUAL_START_GRACE_SECONDS);
    expect(WAITING_VIDEO_MANUAL_START_GRACE_SECONDS).toBe(30 * 60);
    expect(waitingVideoGraceSeconds({ streamMode: "vod", followsSharedStart: true })).toBe(WAITING_VIDEO_TOKEN_GRACE_SECONDS);
    expect(waitingVideoGraceSeconds({ streamMode: "vod", followsSharedStart: false })).toBe(60);
    // A viewer on their own fixed or evergreen session switches to the main video at that start.
    expect(waitingVideoGraceSeconds({ streamMode: "live", followsSharedStart: false })).toBe(60);
  });

  it("opens 60 minutes before the start and closes at the start plus the grace (exclusive)", () => {
    expect(isWithinWaitingVideoWindow(start, start - 60 * 60_000 - 1)).toBe(false);
    expect(isWithinWaitingVideoWindow(start, start - 60 * 60_000)).toBe(true);
    expect(isWithinWaitingVideoWindow(start, start + 59_999)).toBe(true);
    expect(isWithinWaitingVideoWindow(start, start + 60_000)).toBe(false);
    const manual = WAITING_VIDEO_MANUAL_START_GRACE_SECONDS;
    expect(isWithinWaitingVideoWindow(start, start + 29 * 60_000, manual)).toBe(true);
    expect(isWithinWaitingVideoWindow(start, start + 30 * 60_000, manual)).toBe(false);
    expect(isWithinWaitingVideoWindow(Number.NaN, start, manual)).toBe(false);
    expect(isWithinWaitingVideoWindow(start, start, Number.NaN)).toBe(false);
  });
});
