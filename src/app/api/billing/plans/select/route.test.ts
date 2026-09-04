import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPlatformPlanCheckout: vi.fn(),
  platformPlanCheckoutPath: vi.fn(),
}));

vi.mock("@/lib/platform-plan-checkout", () => ({
  createPlatformPlanCheckout: mocks.createPlatformPlanCheckout,
  platformPlanCheckoutPath: mocks.platformPlanCheckoutPath,
}));

import { POST } from "./route";

function request(fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set("_csrf", "synthetic-csrf");
  body.set("planId", "plan-synthetic");
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.example.test/api/billing/plans/select", {
    method: "POST",
    headers: { origin: "https://app.example.test" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPlatformPlanCheckout.mockResolvedValue({
    kind: "checkout",
    transactionId: "synthetic-transaction",
    referral: false,
  });
  mocks.platformPlanCheckoutPath.mockReturnValue(
    "/billing/plans?status=checkout&transactionId=synthetic-transaction",
  );
});

describe("POST /api/billing/plans/select", () => {
  it("returns the shared checkout result as a native 303", async () => {
    const incomingRequest = request();
    const response = await POST(incomingRequest);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/billing/plans?status=checkout&transactionId=synthetic-transaction",
    );
    expect(mocks.createPlatformPlanCheckout).toHaveBeenCalledWith(expect.any(FormData), incomingRequest);
    expect(mocks.platformPlanCheckoutPath).toHaveBeenCalledWith({
      kind: "checkout",
      transactionId: "synthetic-transaction",
      referral: false,
    });
  });

  it("hides unexpected mutation details", async () => {
    mocks.createPlatformPlanCheckout.mockRejectedValueOnce(new Error("synthetic persistence detail"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "checkout" });
  });

  it("fails closed when the shared path builder rejects", async () => {
    mocks.platformPlanCheckoutPath.mockImplementationOnce(() => {
      throw new Error("unsafe redirect must be rejected by the transport");
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "checkout" });
  });

  it("rejects an oversized body before invoking the shared core", async () => {
    const response = await POST(request({ planId: "x".repeat(70 * 1024) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "checkout" });
    expect(mocks.createPlatformPlanCheckout).not.toHaveBeenCalled();
  });
});
