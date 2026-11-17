import { describe, expect, it } from "vitest";
import { classifyPortalPushDiagnostic, formatPortalPushDiagnostic } from "./portal-push-diagnostic";

describe("portal push diagnostic", () => {
  it("round-trips fixed states and bounded counters", () => {
    const value = formatPortalPushDiagnostic({
      stage: "delivered",
      registration: { attempted: true, accepted: true, error: "none" },
      workerState: "activated/running",
      pushEvents: 1,
      show: "ok",
      notifications: 0,
      waitedMs: 29_512.4,
    });
    expect(value).toBe("PORTAL_PUSH:delivered:R11-none:Wactivated/running:P1:Sok:N0:T29512");
    expect(classifyPortalPushDiagnostic(value)).toBe("portal_push stage=delivered registration=11-none worker=activated/running push_events=1 show=ok notifications=0 waited_ms=29512");
  });

  it("collapses unknown or unavailable values instead of forwarding them", () => {
    const value = formatPortalPushDiagnostic({
      stage: "setup",
      registration: { attempted: "yes", accepted: true, error: "https://secret.example/token" },
      workerState: "https://secret.example/sw.js",
      pushEvents: null,
      show: null,
      notifications: 42,
      waitedMs: Number.NaN,
    });
    expect(value).toBe("PORTAL_PUSH:setup:Rx:Wnone:Px:Sx:N9:Tx");
    expect(classifyPortalPushDiagnostic(value)).not.toBeNull();
    expect(formatPortalPushDiagnostic({ stage: "ready", registration: { attempted: true, accepted: false, error: "NotARealError" }, workerState: "activated/flying", pushEvents: 0, show: "secret", notifications: 0, waitedMs: 5 }))
      .toBe("PORTAL_PUSH:ready:R10-other:Wnone:P0:Sother:N0:T5");
  });

  it("rejects anything outside the grammar", () => {
    expect(classifyPortalPushDiagnostic("PORTAL_PUSH:delivered:R11-none:Wactivated/running:P1:Sok:N0:T1 token=secret")).toBeNull();
    expect(classifyPortalPushDiagnostic("PORTAL_PUSH:delivered:R11-none:Whttps://x/running:P1:Sok:N0:T1")).toBeNull();
    expect(classifyPortalPushDiagnostic(undefined)).toBeNull();
  });
});
