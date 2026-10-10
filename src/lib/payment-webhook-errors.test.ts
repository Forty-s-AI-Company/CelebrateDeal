import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { classifyPaymentWebhookErrorClass, classifyPaymentWebhookFailure, paymentWebhookFailureMessage,
  PAYMENT_WEBHOOK_STAGES, tagPaymentWebhookStage, paymentWebhookErrorStage, retainPaymentWebhookCause, withPaymentWebhookStage } from "./payment-webhook-errors";

describe("payment webhook failure classification", () => {
  it.each(PAYMENT_WEBHOOK_STAGES)("preserves the closed stage %s and the original exception", stage => {
    const error = new Prisma.PrismaClientKnownRequestError("synthetic confidential diagnostic", { code: "P2022", clientVersion: "synthetic" });
    tagPaymentWebhookStage(error, stage);
    expect(paymentWebhookErrorStage(error)).toBe(stage);
    expect(classifyPaymentWebhookErrorClass(error)).toBe("P2022");
    tagPaymentWebhookStage(error, "PAYMENT_UPDATE");
    expect(paymentWebhookErrorStage(error)).toBe(stage);
    expect(JSON.stringify(error)).not.toContain(stage);
  });

  it("retains a sanitized wrapper's cause class without exposing the cause", () => {
    const original = new Error("Unsupported state or unable to authenticate data");
    const wrapper = retainPaymentWebhookCause(new Error("Commerce order PII envelope could not be decrypted."), original);
    expect(classifyPaymentWebhookErrorClass(wrapper)).toBe("SENSITIVE_ENVELOPE_AUTH_FAILED");
    expect(wrapper).not.toHaveProperty("cause");
    expect(JSON.stringify(wrapper)).not.toContain(original.message);
    expect(paymentWebhookErrorStage(null)).toBe("UNKNOWN");
  });
  it("does not change promise rejection identity or overwrite a nested stage", async () => {
    const error = new Error("synthetic private exception");
    await expect(withPaymentWebhookStage("PAYMENT_UPDATE", () => withPaymentWebhookStage("MERCHANT_AFFILIATE", () => Promise.reject(error)))).rejects.toBe(error);
    expect(paymentWebhookErrorStage(error)).toBe("MERCHANT_AFFILIATE");
    expect(await withPaymentWebhookStage("INVENTORY", () => Promise.resolve(42))).toBe(42);
  });
  it.each([
    ["Recovery payment identity changed before processing.", "scope_mismatch"],
    ["Recovery webhook tenant does not match the reserved payment.", "scope_mismatch"],
    ["付款 webhook 訂單金額與既存交易不一致。", "amount_mismatch"],
    ["付款 webhook 訂單幣別與既存交易不一致。", "amount_mismatch"],
    ["Inventory reservation item snapshot is invalid.", "inventory_conflict"],
  ])("classifies the actual guard message %s", (message, expected) => {
    expect(classifyPaymentWebhookFailure(new Error(message))).toBe(expected);
  });

  it.each(["P2010", "P2021", "P2022", "P2028"])("preserves only bounded Prisma code %s", code => {
    const error = new Prisma.PrismaClientKnownRequestError("synthetic private diagnostic", {
      code, clientVersion: "synthetic", meta: { query: "never include this metadata" },
    });
    expect(classifyPaymentWebhookErrorClass(error)).toBe(code);
  });

  it.each([
    ["Sensitive data encryption key is not configured.", "SENSITIVE_KEY_MISSING"],
    ["Sensitive data encryption key is too short.", "SENSITIVE_KEY_TOO_SHORT"],
    ["Invalid sensitive data envelope.", "SENSITIVE_ENVELOPE_INVALID"],
    ["Unsupported state or unable to authenticate data", "SENSITIVE_ENVELOPE_AUTH_FAILED"],
  ])("classifies crypto failure without key or envelope data %s", (message, expected) => {
    expect(classifyPaymentWebhookErrorClass(new Error(message))).toBe(expected);
  });

  it("never returns arbitrary error names, messages, codes or metadata", () => {
    const error = Object.assign(new Error("synthetic confidential value"), {
      name: "arbitrary-confidential-class", code: "P2022:private", meta: { private: "confidential" },
    });
    expect(classifyPaymentWebhookErrorClass(error)).toBe("OTHER");
    error.name = "PrismaClientKnownRequestError";
    expect(classifyPaymentWebhookErrorClass(error)).toBe("PrismaClientKnownRequestError");
    expect(classifyPaymentWebhookErrorClass({ name: "ZodError" })).toBe("OTHER");
    error.name = "CommerceOrderValidationError";
    expect(classifyPaymentWebhookErrorClass(error)).toBe("CommerceOrderValidationError");
  });
  it("classifies Prisma interactive transaction expiry without exposing details", () => {
    const error = Object.assign(new Error("Transaction already closed: expired transaction"), { code: "P2028" });
    expect(classifyPaymentWebhookFailure(error)).toBe("processing_timeout");
    expect(paymentWebhookFailureMessage("processing_timeout")).toBe(
      "Payment webhook processing failed (processing_timeout).",
    );
  });

  it("maps reviewed business failures to closed operator codes", () => {
    expect(classifyPaymentWebhookFailure(new Error(
      "付款 webhook 訂單金額或幣別與既存交易不一致。",
    ))).toBe("amount_mismatch");
    expect(classifyPaymentWebhookFailure(new Error(
      "Inventory reservation tenant mismatch.",
    ))).toBe("inventory_conflict");
    expect(classifyPaymentWebhookFailure(new Error(
      "付款 webhook 事件處理權已變更。",
    ))).toBe("processing_claim_lost");
  });

  it("never includes an unknown exception message in the persisted description", () => {
    const secretBearingError = new Error("postgresql://user:password@db.example.test/private"); // secret-scan: allow-test-fixture
    const code = classifyPaymentWebhookFailure(secretBearingError);
    const message = paymentWebhookFailureMessage(code);

    expect(code).toBe("processing_failed");
    expect(message).toBe("Payment webhook processing failed (processing_failed).");
    expect(message).not.toContain(secretBearingError.message);
  });
});
