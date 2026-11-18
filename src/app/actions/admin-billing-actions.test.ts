import { beforeEach, describe, expect, it, vi } from "vitest";

const testRuntime = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  retryWebhookEvent: vi.fn(),
  webhookEventFindUnique: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: testRuntime.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: testRuntime.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: testRuntime.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: testRuntime.requireFinanceAdmin }));
vi.mock("@/lib/webhook-retry", () => ({ retryWebhookEvent: testRuntime.retryWebhookEvent }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ webhookEvent: { findUnique: testRuntime.webhookEventFindUnique } }),
}));

import { retryWebhookEventAction } from "@/app/actions/admin-billing-actions";

function formData(id = "webhook-1") {
  const value = new FormData();
  value.set("id", id);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  testRuntime.assertServerActionSecurity.mockResolvedValue(undefined);
  testRuntime.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  testRuntime.webhookEventFindUnique.mockResolvedValue({ id: "webhook-1", retryCount: 1, maxRetries: 3 });
  testRuntime.retryWebhookEvent.mockResolvedValue(undefined);
});

describe("retryWebhookEventAction", () => {
  it("stops at the CSRF check before authorizing or touching any webhook event", async () => {
    const csrfError = new Error("csrf rejected");
    testRuntime.assertServerActionSecurity.mockRejectedValue(csrfError);

    await expect(retryWebhookEventAction(formData())).rejects.toBe(csrfError);

    expect(testRuntime.assertServerActionSecurity).toHaveBeenCalledWith(expect.any(FormData));
    expect(testRuntime.requireFinanceAdmin).not.toHaveBeenCalled();
    expect(testRuntime.webhookEventFindUnique).not.toHaveBeenCalled();
    expect(testRuntime.retryWebhookEvent).not.toHaveBeenCalled();
  });

  it("requires a finance admin before reading or retrying the webhook event", async () => {
    const forbidden = new Error("forbidden");
    testRuntime.requireFinanceAdmin.mockRejectedValue(forbidden);

    await expect(retryWebhookEventAction(formData())).rejects.toBe(forbidden);

    expect(testRuntime.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(testRuntime.webhookEventFindUnique).not.toHaveBeenCalled();
    expect(testRuntime.retryWebhookEvent).not.toHaveBeenCalled();
    expect(testRuntime.revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects to error=webhook when the event does not exist", async () => {
    testRuntime.webhookEventFindUnique.mockResolvedValue(null);

    await expect(retryWebhookEventAction(formData("missing"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=webhook",
    );

    expect(testRuntime.webhookEventFindUnique).toHaveBeenCalledWith({ where: { id: "missing" } });
    expect(testRuntime.retryWebhookEvent).not.toHaveBeenCalled();
    expect(testRuntime.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["equals", 3, 3],
    ["exceeds", 5, 3],
  ])("redirects to error=max_retries when the retry count %s the maximum", async (_label, retryCount, maxRetries) => {
    testRuntime.webhookEventFindUnique.mockResolvedValue({ id: "webhook-1", retryCount, maxRetries });

    await expect(retryWebhookEventAction(formData())).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=max_retries",
    );

    expect(testRuntime.retryWebhookEvent).not.toHaveBeenCalled();
    expect(testRuntime.revalidatePath).not.toHaveBeenCalled();
  });

  it("retries with the actor role, revalidates the three billing paths and redirects to the dashboard", async () => {
    await expect(retryWebhookEventAction(formData())).rejects.toThrow("redirect:/admin/billing/dashboard");

    expect(testRuntime.retryWebhookEvent).toHaveBeenCalledWith("webhook-1", "finance_admin");
    expect(testRuntime.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/admin/billing/dashboard",
      "/admin/billing/webhooks",
      "/admin/billing/webhooks/webhook-1",
    ]);
  });

  it("does not revalidate or redirect to success when the retry itself fails", async () => {
    const failure = new Error("retry failed");
    testRuntime.retryWebhookEvent.mockRejectedValue(failure);

    await expect(retryWebhookEventAction(formData())).rejects.toBe(failure);

    expect(testRuntime.revalidatePath).not.toHaveBeenCalled();
  });
});
