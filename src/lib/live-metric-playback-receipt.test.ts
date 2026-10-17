import { expect, it } from "vitest";
import { metricPlaybackReceipt } from "./live-metric-playback-receipt";
const valid = { metricRequestId: "de305d54-75b4-431b-adb2-eb6b9e546014", metricIssuedAtMs: 1000, metricExpiresAtMs: 90000 };
it("retains the server request identity and bounded lifetime", () => {
  expect(metricPlaybackReceipt({ ...valid, playbackUrl: "https://example.test/a.mp4" })).toEqual(valid);
  expect(metricPlaybackReceipt({ ...valid, metricRequestId: valid.metricRequestId.toUpperCase() })).toEqual(valid);
});
it.each([null, [], {}, { ...valid, metricRequestId: "client-generated" }, { ...valid, metricIssuedAtMs: -1 },
  { ...valid, metricIssuedAtMs: 1.5 }, { ...valid, metricExpiresAtMs: 1000 }, { ...valid, metricExpiresAtMs: Infinity },
  { ...valid, metricExpiresAtMs: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, metricExpiresAtMs: "90000" }])("rejects untrusted tracking metadata %#", value => {
  expect(metricPlaybackReceipt(value)).toBeNull();
});
