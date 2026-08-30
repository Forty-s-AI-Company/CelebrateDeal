import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  cookieSet: vi.fn(),
  resolveGrant: vi.fn(),
  createCase: vi.fn(),
  addReply: vi.fn(),
  transaction: vi.fn(),
  checkRateLimit: vi.fn(),
  getRateLimitProviderStatus: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.transaction }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  getRateLimitProviderStatus: mocks.getRateLimitProviderStatus,
}));
vi.mock("@/lib/buyer-support-access", () => ({
  resolveBuyerSupportGrant: mocks.resolveGrant,
}));
vi.mock("@/lib/support-case-domain", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/support-case-domain")>(),
  createBuyerSupportCase: mocks.createCase,
  addBuyerSupportReply: mocks.addReply,
}));

import {
  addBuyerSupportReplyAction,
  createBuyerSupportCaseAction,
} from "@/app/actions/buyer-support-actions";

const UUID = "11111111-1111-4111-8111-111111111111";

function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3000" }));
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: mocks.cookieSet });
  mocks.getRateLimitProviderStatus.mockReturnValue({ durable: false, configured: true });
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.resolveGrant.mockResolvedValue({ id: "grant-1", rotationCount: 4 });
  mocks.createCase.mockResolvedValue({
    supportCase: { id: "case-1" },
    grant: { id: "grant-1", rotationCount: 4 },
  });
  mocks.addReply.mockResolvedValue({
    supportCase: { id: "case-1", revision: 3 },
    grant: { id: "grant-1", rotationCount: 4 },
  });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buyer support public actions", () => {
  it("creates from the resolved grant without accepting vendor/order fields", async () => {
    const data = form({
      grantId: "grant-1", intakeKey: UUID, category: "refund", summary: "退款尚未入帳",
      vendorId: "forged-vendor", orderId: "forged-order",
    });

    await expect(createBuyerSupportCaseAction(data))
      .rejects.toThrow("redirect:/support/requests/case-1?updated=created");
    expect(mocks.createCase).toHaveBeenCalledWith(expect.anything(), {
      grantId: "grant-1", intakeKey: UUID, category: "refund", summary: "退款尚未入帳",
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.redirect.mock.calls.at(-1)?.[0]).not.toContain("b".repeat(43));
  });

  it("binds replies to the cookie-resolved grant without making access depend on a response cookie", async () => {
    const data = form({
      grantId: "grant-1", supportCaseId: "case-1", revision: "2",
      dedupKey: UUID, message: "補充付款時間",
    });

    await expect(addBuyerSupportReplyAction(data))
      .rejects.toThrow("redirect:/support/requests/case-1?updated=reply");
    expect(mocks.resolveGrant).toHaveBeenCalledWith(expect.anything(), expect.anything(), "grant-1");
    expect(mocks.addReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      grantId: "grant-1", supportCaseId: "case-1", expectedRevision: 2,
    }));
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("fails closed before a database write when no matching browser capability exists", async () => {
    mocks.resolveGrant.mockResolvedValue(null);
    const data = form({
      grantId: "grant-1", supportCaseId: "case-1", revision: "2",
      dedupKey: UUID, message: "測試",
    });

    await expect(addBuyerSupportReplyAction(data))
      .rejects.toThrow("redirect:/support/requests?error=unavailable");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed in production when only process-local rate limiting is available", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getRateLimitProviderStatus.mockReturnValue({ durable: false, configured: true });
    const data = form({
      grantId: "grant-1", intakeKey: UUID, category: "general", summary: "需要協助",
    });

    await expect(createBuyerSupportCaseAction(data))
      .rejects.toThrow("redirect:/support/requests?error=unavailable");
    expect(mocks.resolveGrant).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts a durable production provider without rotating the validated capability", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getRateLimitProviderStatus.mockReturnValue({ durable: true, configured: true });
    const data = form({
      grantId: "grant-1", intakeKey: UUID, category: "general", summary: "需要協助",
    });

    await expect(createBuyerSupportCaseAction(data))
      .rejects.toThrow("redirect:/support/requests/case-1?updated=created");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
