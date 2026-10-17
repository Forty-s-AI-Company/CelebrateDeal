import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {createMetricIngressAttestor,METRIC_INGRESS_HEADER} from '@/lib/live-metric-ingress-proof';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  tokenFromRequest: vi.fn(),
  checkRateLimit: vi.fn(async () => null),
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/live-metric-playback-intake", () => ({ resolveTrackedLivePlaybackSource: mocks.resolve }));
vi.mock("@/lib/live-quota-admission", () => ({ liveViewerTokenFromRequest: mocks.tokenFromRequest }));
vi.mock("@/lib/trusted-entry-rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { GET } from "@/app/api/live-playback-source/route";

function request(query = "vendorId=vendor-1&liveId=live-1", headers: Record<string, string> = {}) {
  return new Request(`https://app.example.test/api/live-playback-source?${query}`, {
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE','');
  mocks.tokenFromRequest.mockReturnValue("A".repeat(43));
  mocks.resolve.mockResolvedValue({ playbackUrl: "https://video.example.test/live.m3u8" });
});
afterEach(()=>vi.unstubAllEnvs());
it('validates internal frame binding while retaining the existing playback authorization boundary',async()=>{
 const run={vendorId:'vendor-1',liveId:'live-1',versionId:'version',runId:'10000000-0000-4000-8000-000000000001'},key=new Uint8Array(32).fill(6),frameId='10000000-0000-4000-8000-000000000002';
 vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE',JSON.stringify({...run,key:Buffer.from(key).toString('base64url')}));
 expect((await GET(request())).status).toBe(503);expect(mocks.resolve).not.toHaveBeenCalled();
 const binding=createMetricIngressAttestor(run,key).issue(frameId,{kind:'playback',method:'GET',target:'/api/live-playback-source?vendorId=vendor-1&liveId=live-1'});
 expect((await GET(request(undefined,{[METRIC_INGRESS_HEADER]:binding}))).status).toBe(200);
 expect(mocks.resolve).toHaveBeenCalledWith({},expect.objectContaining({vendorId:'vendor-1',liveId:'live-1'}),expect.objectContaining({...run,frameId,kind:'playback'}));
 mocks.resolve.mockClear();mocks.tokenFromRequest.mockReturnValue(null);
 expect((await GET(request(undefined,{[METRIC_INGRESS_HEADER]:binding}))).status).toBe(403);expect(mocks.resolve).not.toHaveBeenCalled();
});

describe("GET /api/live-playback-source", () => {
  it("awaits durable service completion and forwards only the server receipt", async () => {
    let complete!: (value: object) => void;
    mocks.resolve.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    let returned = false;
    const pending = GET(request()).then(response => { returned = true; return response; });
    await Promise.resolve(); await Promise.resolve(); expect(returned).toBe(false);
    const source = { playbackUrl: "https://video.example.test/live.m3u8", metricRequestId: "de305d54-75b4-431b-adb2-eb6b9e546014", metricIssuedAtMs: 1000, metricExpiresAtMs: 90000 };
    complete(source); const response = await pending;
    expect(response.status).toBe(200); expect(await response.json()).toEqual(source);
  });
  it("withholds the source on persistence failure without exposing diagnostics", async () => {
    mocks.resolve.mockRejectedValueOnce(new Error("synthetic private storage diagnostic"));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Playback temporarily unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns the source only after the admission service accepts the cookie", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ playbackUrl: "https://video.example.test/live.m3u8" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolve).toHaveBeenCalledWith({}, expect.objectContaining({
      vendorId: "vendor-1",
      liveId: "live-1",
      token: "A".repeat(43),
    }));
  });

  it("does not disclose a source without a valid admission cookie", async () => {
    mocks.tokenFromRequest.mockReturnValue(null);
    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Playback unavailable" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("fails closed on invalid query data", async () => {
    const response = await GET(request("vendorId=&liveId=live-1"));
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
