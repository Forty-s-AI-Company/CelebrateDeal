import { describe, expect, it } from "vitest";

import {
  buildQaArtifact,
  financeDashboardErrorCategory,
  refundPersistencePassed,
} from "./payuni-sandbox-external-qa.mjs";

describe("PayUni Sandbox QA artifact", () => {
  it("persists only the closed non-sensitive receipt", () => {
    const sensitiveMarker = "do-not-persist-sensitive-provider-or-transaction-data";
    const artifact = buildQaArtifact({
      success: true,
      completedAt: "2026-07-23T12:34:56.789Z",
      orderRef: sensitiveMarker,
      transactionRef: sensitiveMarker,
      providerState: { payload: sensitiveMarker },
      checks: {
        paymentTransactionRefunded: "passed",
        refundRecordProcessed: "passed",
        refundIdempotency: "passed",
        singleRefundRecord: "passed",
        unexpectedProviderField: sensitiveMarker,
      },
    }, {
      AI_TEAM_PROJECT_REVISION: "a38ffd61c",
      AI_TEAM_QA_SIGNER_ROLE: "delivery-qa",
    });

    expect(artifact).toEqual({
      schemaVersion: "celebratedeal-ai-team-payuni-artifact/v1",
      executedAtUtc: "2026-07-23T12:34:56.789Z",
      environment: "staging",
      revision: "a38ffd61c",
      status: "completed",
      gates: {
        paymentTransactionRefunded: "passed",
        refundRecordProcessed: "passed",
        refundIdempotency: "passed",
        singleRefundRecord: "passed",
      },
      safeFailureCategory: "none",
      signerRole: "delivery-qa",
    });
    expect(JSON.stringify(artifact)).not.toContain(sensitiveMarker);
  });

  it("normalises malformed failure data without persisting error text", () => {
    const sensitiveMarker = "do-not-persist-this-error-message";
    const artifact = buildQaArtifact({
      success: false,
      completedAt: "not-a-date",
      error: sensitiveMarker,
      checks: { paymentTransactionRefunded: "passed", browserErrorCategory: "timeout" },
    }, {
      AI_TEAM_PROJECT_REVISION: "invalid revision with unsafe characters",
      AI_TEAM_QA_SIGNER_ROLE: "untrusted-role",
    });

    expect(artifact.status).toBe("failed");
    expect(artifact.revision).toBe("unavailable");
    expect(artifact.signerRole).toBe("delivery-qa");
    expect(artifact.gates).toEqual({
      paymentTransactionRefunded: "passed",
      refundRecordProcessed: "unknown",
      refundIdempotency: "unknown",
      singleRefundRecord: "unknown",
    });
    expect(artifact.safeFailureCategory).toBe("unknown");
    expect(JSON.stringify(artifact)).not.toContain(sensitiveMarker);
  });

  it("classifies an MFA redirect as authentication without retaining browser details", () => {
    expect(financeDashboardErrorCategory({ name: "MfaRequiredError" })).toBe("authentication");
    expect(buildQaArtifact({
      success: false,
      completedAt: "2026-07-23T12:34:56.789Z",
      checks: { financeErrorCategory: "authentication" },
    }).safeFailureCategory).toBe("authentication");
  });

  it("retains only the safe authorization category when read-only DB evidence is blocked", () => {
    expect(buildQaArtifact({
      success: false,
      completedAt: "2026-07-24T00:00:00.000Z",
      checks: { errorCategory: "authorization" },
    }).safeFailureCategory).toBe("authorization");
  });

  it("requires a provider reference and the original processed payment webhook", () => {
    const transaction = {
      status: "refunded",
      grossAmountCents: 10_000,
      refundedAmountCents: 10_000,
      providerTradeNo: "masked-in-test-only",
      refunds: [{
        status: "processed",
        refundAmountCents: 10_000,
        providerEventId: "refund-reference",
      }],
    };

    expect(refundPersistencePassed(transaction, { provider: "payuni", status: "processed" })).toBe(true);
    expect(refundPersistencePassed({
      ...transaction,
      refunds: [{ ...transaction.refunds[0], providerEventId: null }],
    }, { provider: "payuni", status: "processed" })).toBe(false);
    expect(refundPersistencePassed(transaction, { provider: "payuni", status: "failed" })).toBe(false);
    expect(refundPersistencePassed(transaction, { provider: "other", status: "processed" })).toBe(false);
  });
});
