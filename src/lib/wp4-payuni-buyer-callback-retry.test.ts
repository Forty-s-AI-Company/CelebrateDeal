import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryWp4PayUniBuyerCallback, WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA } from "./wp4-payuni-buyer-callback-retry";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
const mocks = vi.hoisted(() => ({ tx: vi.fn(), events: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/webhook-retry", () => ({ retryWebhookEvent: mocks.retry }));
const db = { paymentTransaction: { findMany: mocks.tx }, webhookEvent: { findMany: mocks.events } };
const retryDb = db as unknown as Parameters<typeof retryWp4PayUniBuyerCallback>[0];
function row(status = "pending", overrides: Record<string, unknown> = {}) { return { id: "tx-1", vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", orderNumber: "CD-20260905-ABC123", grossAmountCents: 100, status, metadata: { wp4SourceCommit: WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA, billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4PaymentSubmissionReserved: true }, ...overrides }; }
beforeEach(() => { vi.clearAllMocks(); mocks.tx.mockResolvedValue([row()]); mocks.events.mockResolvedValue([{ id: "event-1", status: "failed", retryCount: 0, maxRetries: 3 }]); mocks.retry.mockResolvedValue({ status: "processed" }); });
describe("fixed current buyer callback retry", () => {
  it("replays one matching failed event through the existing CAS helper", async () => { await expect(retryWp4PayUniBuyerCallback(retryDb)).resolves.toEqual({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" }); expect(mocks.retry).toHaveBeenCalledExactlyOnceWith("event-1", "wp4:current-buyer-callback"); });
  it("returns already processed without retrying paid transaction", async () => { mocks.tx.mockResolvedValue([row("paid")]); await expect(retryWp4PayUniBuyerCallback(retryDb)).resolves.toEqual({ status: "ALREADY_PROCESSED", retryAttempts: 0, failureCode: "NONE" }); expect(mocks.retry).not.toHaveBeenCalled(); });
  it.each([{ vendorId: "other" }, { providerName: "demo" }, { grossAmountCents: 101 }, { metadata: { wp4SourceCommit: "b".repeat(40), billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4PaymentSubmissionReserved: true } }])("fails closed outside fixed transaction scope", async (override) => { mocks.tx.mockResolvedValue([row("pending", override)]); await expect(retryWp4PayUniBuyerCallback(retryDb)).resolves.toMatchObject({ status: "FIXTURE_UNAVAILABLE", retryAttempts: 0 }); expect(mocks.events).not.toHaveBeenCalled(); });
  it("rejects ambiguous or exhausted events without replay", async () => { mocks.events.mockResolvedValueOnce([{ id: "a", retryCount: 0, maxRetries: 3 }, { id: "b", retryCount: 0, maxRetries: 3 }]); await expect(retryWp4PayUniBuyerCallback(retryDb)).resolves.toMatchObject({ status: "CANDIDATE_AMBIGUOUS" }); mocks.events.mockResolvedValueOnce([{ id: "a", retryCount: 3, maxRetries: 3 }]); await expect(retryWp4PayUniBuyerCallback(retryDb)).resolves.toMatchObject({ status: "EVENT_UNAVAILABLE" }); expect(mocks.retry).not.toHaveBeenCalled(); });
});

