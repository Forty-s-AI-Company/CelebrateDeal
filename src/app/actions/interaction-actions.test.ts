import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  authContext: vi.fn(),
  findLive: vi.fn(),
  createRun: vi.fn(),
  findRun: vi.fn(),
  updateRun: vi.fn(),
  updateResponse: vi.fn(),
  findResponses: vi.fn(),
  findPayments: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  findQuestion: vi.fn(),
  updateQuestions: vi.fn(),
  updateQuestion: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: mocks.authContext,
}));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.audit }));
vi.mock("@/lib/sensitive-data", () => ({
  deriveSensitiveDataKey: vi.fn(() => Buffer.alloc(32, 7)),
  encryptSensitiveValue: vi.fn(() => "v1.test.envelope"),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  live: { findFirst: mocks.findLive },
  liveInteractionRun: { create: mocks.createRun, findFirst: mocks.findRun, findMany: vi.fn(), updateMany: mocks.updateRun },
  liveInteractionResponse: { findFirst: mocks.findResponses, findMany: mocks.findResponses, updateMany: mocks.updateResponse },
  paymentTransaction: { findMany: mocks.findPayments },
  liveQuestion: { findFirst: mocks.findQuestion, updateMany: mocks.updateQuestions, update: mocks.updateQuestion },
  $transaction: mocks.transaction,
}) }));

import { hashLuckyDrawClaimCode } from "@/lib/live-interaction";
import { drawLiveInteractionWinnerAction, endLiveInteractionAction, moderateLiveQuestionAction, startLiveInteractionAction, verifyLuckyDrawWinnerClaimAction } from "./interaction-actions";

function startForm(eventType: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    liveId: "live-1", eventType, title: "直播互動", durationSec: "60",
    slogan: "週年快樂", question: "你選哪個？", options: "A\nB",
    maxClaims: "100", discountType: "percentage", discountValue: "10",
  })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authContext.mockResolvedValue({
    vendor: { id: "vendor-1" },
    auth: { user: { id: "user-1" }, member: { id: "member-1", role: "owner" } },
  });
  mocks.findLive.mockResolvedValue({ id: "live-1", products: [] });
  mocks.createRun.mockImplementation(async ({ data }) => ({ id: "run-1", ...data }));
  mocks.updateRun.mockResolvedValue({ count: 1 });
  mocks.updateResponse.mockResolvedValue({ count: 1 });
  mocks.findResponses.mockResolvedValue([]);
  mocks.findPayments.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    liveInteractionRun: { findFirst: mocks.findRun, findMany: vi.fn().mockResolvedValue([]), updateMany: mocks.updateRun },
    liveInteractionResponse: { findFirst: mocks.findResponses, findMany: mocks.findResponses, updateMany: mocks.updateResponse },
    paymentTransaction: { findMany: mocks.findPayments },
    liveQuestion: { findFirst: mocks.findQuestion, updateMany: mocks.updateQuestions, update: mocks.updateQuestion },
  }));
  mocks.findQuestion.mockResolvedValue({ id: "q-1", liveId: "live-1", status: "pending" });
  mocks.updateQuestions.mockResolvedValue({ count: 1 });
  mocks.updateQuestion.mockResolvedValue({ id: "q-1", liveId: "live-1" });
});

describe("Live Studio advanced interaction actions", () => {
  it("starts a normalized manual poll for a tenant-owned live broadcast", async () => {
    const result = await startLiveInteractionAction({ status: "idle", message: "" }, startForm("poll"));
    expect(result).toMatchObject({ status: "success", runId: "run-1" });
    expect(mocks.findLive).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live-1", vendorId: "vendor-1", status: "live" } }));
    expect(mocks.createRun).toHaveBeenCalledWith({ data: expect.objectContaining({
      source: "manual", eventType: "poll", createdByMemberId: "member-1",
      configuration: expect.objectContaining({ kind: "poll", question: "你選哪個？" }),
    }) });
  });

  it("fails closed when Studio tries to start an interaction outside a live broadcast", async () => {
    mocks.findLive.mockResolvedValueOnce(null);
    const result = await startLiveInteractionAction({ status: "idle", message: "" }, startForm("lucky_draw"));
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("ends only a tenant-owned active poll", async () => {
    const form = new FormData();
    form.set("runId", "poll-1");
    const result = await endLiveInteractionAction({ status: "idle", message: "" }, form);
    expect(result).toMatchObject({ status: "success", runId: "poll-1" });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "poll-1", vendorId: "vendor-1", status: "active", eventType: "poll" },
      data: expect.objectContaining({ status: "closed", endsAt: expect.any(Date) }),
    }));
  });

  it("spotlights a tenant-owned pending question and retires an earlier spotlight", async () => {
    const form = new FormData();
    form.set("questionId", "q-1");
    form.set("status", "spotlight");
    const result = await moderateLiveQuestionAction({ status: "idle", message: "" }, form);
    expect(result).toMatchObject({ status: "success" });
    expect(mocks.findQuestion).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "q-1", vendorId: "vendor-1" } }));
    expect(mocks.updateQuestions).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", liveId: "live-1", status: "spotlight" }) }));
    expect(mocks.updateQuestion).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "spotlight", spotlightedAt: expect.any(Date) }) }));
  });

  it("draws the only eligible response exactly once", async () => {
    mocks.findRun.mockResolvedValueOnce({
      id: "run-1",
      liveId: "live-1",
      configuration: { kind: "lucky_draw", excludePreviousWinners: false },
      responses: [{ id: "response-1", participantHash: "hash-1", formSubmissionId: null }],
    });
    const form = new FormData();
    form.set("runId", "run-1");
    const result = await drawLiveInteractionWinnerAction({ status: "idle", message: "" }, form);
    expect(result).toMatchObject({ status: "success", runId: "run-1" });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1", vendorId: "vendor-1", winnerResponseId: null },
      data: expect.objectContaining({ winnerResponseId: "response-1", status: "closed" }),
    }));
    expect(mocks.updateResponse).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "response-1", claimTokenHash: null }),
      data: expect.objectContaining({ claimTokenHash: expect.any(String), winnerClaimCodeEncryptedEnvelope: "v1.test.envelope" }),
    }));
  });

  it("revalidates purchased eligibility at draw time and excludes unpaid entries", async () => {
    mocks.findRun.mockResolvedValueOnce({
      id: "run-1",
      liveId: "live-1",
      configuration: { kind: "lucky_draw", eligibility: "purchased", excludePreviousWinners: false },
      responses: [
        { id: "unpaid-response", participantHash: "hash-1", formSubmissionId: "submission-unpaid" },
        { id: "paid-response", participantHash: "hash-2", formSubmissionId: "submission-paid" },
      ],
    });
    mocks.findPayments.mockResolvedValueOnce([{ metadata: { formSubmissionId: "submission-paid" } }]);
    const form = new FormData();
    form.set("runId", "run-1");

    await expect(drawLiveInteractionWinnerAction({ status: "idle", message: "" }, form)).resolves.toMatchObject({ status: "success" });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ winnerResponseId: "paid-response" }),
    }));
    expect(mocks.findPayments).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-1", status: "paid" }),
    }));
  });

  it("preserves purchased filtering while excluding previous winners", async () => {
    mocks.findRun.mockResolvedValueOnce({
      id: "run-1",
      liveId: "live-1",
      configuration: { kind: "lucky_draw", eligibility: "purchased", excludePreviousWinners: true },
      responses: [
        { id: "unpaid-response", participantHash: "hash-unpaid", formSubmissionId: "submission-unpaid" },
        { id: "previous-response", participantHash: "hash-previous", formSubmissionId: "submission-previous" },
        { id: "eligible-response", participantHash: "hash-eligible", formSubmissionId: "submission-eligible" },
      ],
    });
    mocks.findPayments.mockResolvedValueOnce([
      { metadata: { formSubmissionId: "submission-previous" } },
      { metadata: { formSubmissionId: "submission-eligible" } },
    ]);
    const findPreviousRuns = vi.fn().mockResolvedValueOnce([{ winnerResponseId: "old-winner-response" }]);
    const findPreviousResponses = vi.fn().mockResolvedValueOnce([{ participantHash: "hash-previous" }]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      liveInteractionRun: { findFirst: mocks.findRun, findMany: findPreviousRuns, updateMany: mocks.updateRun },
      liveInteractionResponse: { findFirst: mocks.findResponses, findMany: findPreviousResponses, updateMany: mocks.updateResponse },
      paymentTransaction: { findMany: mocks.findPayments },
    }));
    const form = new FormData();
    form.set("runId", "run-1");

    await expect(drawLiveInteractionWinnerAction({ status: "idle", message: "" }, form)).resolves.toMatchObject({ status: "success" });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ winnerResponseId: "eligible-response" }),
    }));
  });

  it("starts a flash sale interaction for a live product", async () => {
    mocks.findLive.mockResolvedValueOnce({
      id: "live-1",
      products: [{ productId: "prod-1" }],
    });
    const form = new FormData();
    form.set("liveId", "live-1");
    form.set("eventType", "flash_sale");
    form.set("title", "限時下殺");
    form.set("durationSec", "300");
    form.set("productId", "prod-1");
    form.set("salePriceCents", "990");
    form.set("originalPriceCents", "2980");
    form.set("stockLimit", "30");
    form.set("announcementText", "限時 3 折搶購！");

    const result = await startLiveInteractionAction({ status: "idle", message: "" }, form);
    expect(result).toMatchObject({ status: "success", runId: "run-1" });
    expect(mocks.createRun).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "flash_sale",
        configuration: expect.objectContaining({
          kind: "flash_sale",
          productId: "prod-1",
          salePriceCents: 99000,
        }),
      }),
    });
  });

  it("verifies the winner code and atomically redeems it once without auditing the secret", async () => {
    const claimCode = "CD-WIN-ABCD-1234";
    mocks.findRun.mockResolvedValueOnce({ id: "run-1", winnerResponseId: "response-1" });
    mocks.findResponses.mockResolvedValueOnce({ id: "response-1", claimTokenHash: hashLuckyDrawClaimCode(claimCode), winnerClaimedAt: null });
    const form = new FormData();
    form.set("runId", "run-1");
    form.set("claimCode", claimCode);
    await expect(verifyLuckyDrawWinnerClaimAction({ status: "idle", message: "" }, form)).resolves.toMatchObject({ status: "success" });
    expect(mocks.updateResponse).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-1", winnerClaimedAt: null, claimTokenHash: hashLuckyDrawClaimCode(claimCode) }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.not.objectContaining({ after: expect.objectContaining({ claimCode }) }));
  });

  it("rejects an invalid, replayed, or cross-tenant redemption without a write", async () => {
    const claimCode = "CD-WIN-ABCD-1234";
    mocks.findRun.mockResolvedValueOnce({ id: "run-1", winnerResponseId: "response-1" });
    mocks.findResponses.mockResolvedValueOnce({ id: "response-1", claimTokenHash: hashLuckyDrawClaimCode("CD-WIN-ABCD-1235"), winnerClaimedAt: null });
    const invalid = new FormData(); invalid.set("runId", "run-1"); invalid.set("claimCode", claimCode);
    await expect(verifyLuckyDrawWinnerClaimAction({ status: "idle", message: "" }, invalid)).resolves.toMatchObject({ status: "error", message: "核銷碼不正確。" });
    expect(mocks.updateResponse).not.toHaveBeenCalled();

    mocks.findRun.mockResolvedValueOnce({ id: "run-1", winnerResponseId: "response-1" });
    mocks.findResponses.mockResolvedValueOnce({ id: "response-1", claimTokenHash: hashLuckyDrawClaimCode(claimCode), winnerClaimedAt: new Date() });
    const replay = new FormData(); replay.set("runId", "run-1"); replay.set("claimCode", claimCode);
    await expect(verifyLuckyDrawWinnerClaimAction({ status: "idle", message: "" }, replay)).resolves.toMatchObject({ status: "error", message: "此獎項已完成核銷。" });
    expect(mocks.updateResponse).not.toHaveBeenCalled();

    mocks.findRun.mockResolvedValueOnce(null);
    const foreign = new FormData(); foreign.set("runId", "foreign-run"); foreign.set("claimCode", claimCode);
    await expect(verifyLuckyDrawWinnerClaimAction({ status: "idle", message: "" }, foreign)).resolves.toMatchObject({ status: "error", message: "抽獎場次或得獎資料不存在。" });
    expect(mocks.updateResponse).not.toHaveBeenCalled();
  });
});
