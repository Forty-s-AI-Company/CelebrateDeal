import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  findUnique: vi.fn(),
  retryWebhookEvent: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ webhookEvent: { findUnique: mocks.findUnique } }) }));
vi.mock("@/lib/webhook-retry", () => ({ retryWebhookEvent: mocks.retryWebhookEvent }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { retryWebhookEventAction } from "@/app/actions/webhook-actions";

function formData() {
  const data = new FormData();
  data.set("id", "webhook-current");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "member-finance", role: "finance" } });
  mocks.findUnique.mockResolvedValue({ id: "webhook-current", retryCount: 1, maxRetries: 3 });
  mocks.retryWebhookEvent.mockResolvedValue({ status: "processed" });
});

describe("retryWebhookEventAction", () => {
  it("authorizes, retries the server-owned event, then refreshes all billing views", async () => {
    await expect(retryWebhookEventAction(formData())).rejects.toThrow("redirect:/admin/billing/dashboard");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(mocks.retryWebhookEvent).toHaveBeenCalledWith("webhook-current", "finance");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/admin/billing/dashboard");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/admin/billing/webhooks");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(3, "/admin/billing/webhooks/webhook-current");
  });

  it("does not retry a missing event", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(retryWebhookEventAction(formData())).rejects.toThrow("redirect:/admin/billing/dashboard?error=webhook");
    expect(mocks.retryWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not retry an exhausted event", async () => {
    mocks.findUnique.mockResolvedValue({ id: "webhook-current", retryCount: 3, maxRetries: 3 });

    await expect(retryWebhookEventAction(formData())).rejects.toThrow("redirect:/admin/billing/dashboard?error=max_retries");
    expect(mocks.retryWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
