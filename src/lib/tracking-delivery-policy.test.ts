import { describe, expect, it } from "vitest";
import { decideTrackingDelivery } from "@/lib/tracking-delivery-policy";

const now = new Date("2026-10-07T00:00:00Z");
describe("bounded tracking provider acceptance and retry policy", () => {
  it("requires a single accepted event, including on the final attempt", () => {
    expect(decideTrackingDelivery({ attempt: 8, now, status: 200, acceptedEvents: 1 })).toEqual({ outcome: "accepted" });
    for (const acceptedEvents of [null, 0, 2, -1, 1.5]) {
      expect(decideTrackingDelivery({ attempt: 1, now, status: 200, acceptedEvents })).toEqual({ outcome: "rejected" });
    }
  });
  it.each([null, 408, 429, 500, 503])("retries transient result %s with a bounded delay", status => {
    expect(decideTrackingDelivery({ attempt: 1, now, status, acceptedEvents: null })).toEqual({ outcome: "retry", retryAt: new Date(now.getTime() + 30_000) });
    expect(decideTrackingDelivery({ attempt: 7, now, status, acceptedEvents: null })).toEqual({ outcome: "retry", retryAt: new Date(now.getTime() + 1_920_000) });
    expect(decideTrackingDelivery({ attempt: 8, now, status, acceptedEvents: null })).toEqual({ outcome: "rejected" });
  });
  it.each([301, 400, 401, 403, 404, 422])("does not retry permanent response %s", status => {
    expect(decideTrackingDelivery({ attempt: 1, now, status, acceptedEvents: 1 })).toEqual({ outcome: "rejected" });
  });
  it.each([0, -1, 9, 1.5, NaN])("rejects an invalid persisted attempt %s", attempt => {
    expect(() => decideTrackingDelivery({ attempt, now, status: null, acceptedEvents: null })).toThrow(TypeError);
  });
  it("rejects invalid clock and response statuses", () => {
    expect(() => decideTrackingDelivery({ attempt: 1, now: new Date(NaN), status: null, acceptedEvents: null })).toThrow(TypeError);
    for (const status of [99, 600, NaN, 200.5]) expect(() => decideTrackingDelivery({ attempt: 1, now, status, acceptedEvents: null })).toThrow(TypeError);
  });
});
