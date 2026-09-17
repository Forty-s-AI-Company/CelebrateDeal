import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/landing-page-service", () => ({ loadPublicLandingPage: mocks.load }));
import { GET } from "./route";

function fixture() {
  const flow = createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!;
  flow.webinar = { timezone: "Asia/Taipei", startsAt: "2026-09-17T01:00:00.000Z", endsAt: "2026-09-17T02:00:00.000Z", replayEndsAt: "2026-09-17T03:00:00.000Z" };
  return { content: createFunnelStepPages(flow), webinar: { live: { id: "live-1", slug: "scoped-live" }, form: { id: "form-1" } } };
}
function request(stepPath = "broadcast") {
  return GET(new Request("https://app.example.test/lp/webinar/broadcast/play?now=2099-01-01"), { params: Promise.resolve({ slug: "webinar", stepPath }) });
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.load.mockResolvedValue(fixture()); });
afterEach(() => vi.useRealTimers());

describe("Webinar server playback entry", () => {
  it.each(["2026-09-17T01:00:00.000Z", "2026-09-17T02:00:00.000Z"])("redirects only a live/replay window: %s", async (time) => {
    vi.setSystemTime(new Date(time));
    const response = await request();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/live/scoped-live");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.load).toHaveBeenCalledWith("webinar");
  });
  it.each([["2026-09-17T00:59:59.999Z", 409], ["2026-09-17T03:00:00.000Z", 410]] as const)("ignores client time and denies outside server window: %s", async (time, status) => {
    vi.setSystemTime(new Date(time));
    const response = await request();
    expect(response.status).toBe(status);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("scoped-live");
  });
  it("fails closed when runtime ownership/readiness invalidates the resource", async () => {
    vi.setSystemTime(new Date("2026-09-17T01:30:00Z"));
    mocks.load.mockResolvedValue({ ...fixture(), webinar: undefined });
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
  it("rejects an unavailable page or a non-broadcast step", async () => {
    expect((await request("registration")).status).toBe(404);
    mocks.load.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
  });
});
