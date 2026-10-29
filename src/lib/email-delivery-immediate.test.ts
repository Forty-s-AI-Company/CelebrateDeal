import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  dispatchEmailDelivery: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/email-delivery", () => ({ dispatchEmailDelivery: mocks.dispatchEmailDelivery }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import {
  deliveryIdForStatuses,
  dispatchEmailDeliveriesNow,
  IMMEDIATE_EMAIL_DISPATCH_ACTOR,
  isImmediateEmailDelivery,
  scheduleImmediateEmailDispatch,
} from "@/lib/email-delivery-immediate";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.after.mockReset();
  mocks.dispatchEmailDelivery.mockResolvedValue({ status: "sent" });
});

describe("isImmediateEmailDelivery", () => {
  it("treats only an already-due first attempt as send-now", () => {
    const now = new Date("2026-10-29T08:00:00.000Z");
    expect(isImmediateEmailDelivery(now, now)).toBe(true);
    expect(isImmediateEmailDelivery(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isImmediateEmailDelivery(new Date(now.getTime() + 1), now)).toBe(false);
    expect(isImmediateEmailDelivery(null, now)).toBe(false);
    expect(isImmediateEmailDelivery(undefined, now)).toBe(false);
  });
});

describe("scheduleImmediateEmailDispatch", () => {
  it("registers one post-response hook that dispatches each unique id once", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    mocks.after.mockImplementation((callback: () => Promise<void>) => callbacks.push(callback));

    expect(scheduleImmediateEmailDispatch(["email_a", null, "email_b", "email_a", undefined, ""])).toBe(true);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    // Nothing is sent before the response has finished.
    expect(mocks.dispatchEmailDelivery).not.toHaveBeenCalled();

    await callbacks[0]!();
    expect(mocks.dispatchEmailDelivery.mock.calls).toEqual([
      ["email_a", IMMEDIATE_EMAIL_DISPATCH_ACTOR],
      ["email_b", IMMEDIATE_EMAIL_DISPATCH_ACTOR],
    ]);
  });

  it("does not register a hook when there is nothing to send", () => {
    expect(scheduleImmediateEmailDispatch([])).toBe(false);
    expect(scheduleImmediateEmailDispatch([null, undefined])).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("bounds the ids one call can dispatch and leaves the rest to the job", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    mocks.after.mockImplementation((callback: () => Promise<void>) => callbacks.push(callback));

    scheduleImmediateEmailDispatch(Array.from({ length: 8 }, (_, index) => `email_${index}`));
    await callbacks[0]!();
    expect(mocks.dispatchEmailDelivery).toHaveBeenCalledTimes(5);
  });

  it("falls back to the job outside a request scope instead of throwing", async () => {
    const { after: realAfter } = await vi.importActual<typeof import("next/server")>("next/server");
    mocks.after.mockImplementation(realAfter);

    expect(scheduleImmediateEmailDispatch(["email_a"])).toBe(false);
    expect(mocks.dispatchEmailDelivery).not.toHaveBeenCalled();
  });
});

describe("scheduleImmediateEmailDispatch without a usable after()", () => {
  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
  });

  it.each([
    ["a module mock that omits after", () => ({})],
    ["a module mock whose after is undefined", () => ({ after: undefined })],
    ["an after that is not a function", () => ({ after: "not-a-function" })],
  ])("returns false and dispatches nothing for %s", async (_label, factory) => {
    vi.resetModules();
    vi.doMock("next/server", factory);
    const isolated = await import("@/lib/email-delivery-immediate");

    expect(() => isolated.scheduleImmediateEmailDispatch(["email_a"])).not.toThrow();
    expect(isolated.scheduleImmediateEmailDispatch(["email_a"])).toBe(false);
    expect(mocks.dispatchEmailDelivery).not.toHaveBeenCalled();
  });
});

describe("deliveryIdForStatuses", () => {
  it("returns the id only for an accepted status and tolerates a missing result", () => {
    expect(deliveryIdForStatuses({ status: "queued", deliveryId: "email_a" }, ["queued"])).toBe("email_a");
    expect(deliveryIdForStatuses({ status: "duplicate", deliveryId: "email_a" }, ["queued", "duplicate"])).toBe("email_a");
    expect(deliveryIdForStatuses({ status: "suppressed", deliveryId: "email_a" }, ["queued", "duplicate"])).toBeNull();
    expect(deliveryIdForStatuses({ status: "not_configured" }, ["queued"])).toBeNull();
    expect(deliveryIdForStatuses({ status: "queued", deliveryId: "" }, ["queued"])).toBeNull();
    expect(deliveryIdForStatuses(undefined, ["queued"])).toBeNull();
    expect(deliveryIdForStatuses(null, ["queued"])).toBeNull();
  });
});

describe("dispatchEmailDeliveriesNow", () => {
  it("contains a dispatch failure, reports it without ids, and continues with the next row", async () => {
    mocks.dispatchEmailDelivery
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ status: "claimed_elsewhere" });

    await expect(dispatchEmailDeliveriesNow(["email_a", "email_b"])).resolves.toEqual([
      { deliveryId: "email_a", status: "dispatch_error" },
      { deliveryId: "email_b", status: "claimed_elsewhere" },
    ]);
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "email_delivery_immediate",
      operation: "dispatch",
      status: "failed",
    });
  });

  it("does not let a monitoring outage escape the hook", async () => {
    mocks.dispatchEmailDelivery.mockRejectedValueOnce(new Error("database unavailable"));
    mocks.captureOperationalError.mockImplementationOnce(() => {
      throw new Error("monitoring unavailable");
    });

    await expect(dispatchEmailDeliveriesNow(["email_a"])).resolves.toEqual([
      { deliveryId: "email_a", status: "dispatch_error" },
    ]);
  });
});
