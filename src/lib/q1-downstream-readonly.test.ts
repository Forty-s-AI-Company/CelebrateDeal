import { describe, expect, it } from "vitest";
import { Q1DownstreamReceipt, Q1_DOWNSTREAM_MODELS } from "./q1-downstream-readonly";

describe("closed downstream diagnostic receipt", () => {
  const valid = { classification: "DOWNSTREAM_OBSERVED", readStage: "NONE", readClass: "NONE", schema: [], enums: [], decrypt: "OK", protect: "OK",
    billingPurposeClass: "buyer_order", coursePolicySnapshotClass: "ABSENT", merchantSnapshotExists: false,
    emailDeliveryExists: false, paidOrderEventExists: false, databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false };
  it.each(["email", "name", "envelope", "key", "paymentId"])("rejects extra protected property %s", property => {
    expect(Q1DownstreamReceipt.safeParse({ ...valid, [property]: "synthetic confidential value" }).success).toBe(false);
  });
  it.each(["decrypt", "protect", "billingPurposeClass", "coursePolicySnapshotClass", "classification", "readStage", "readClass"])("rejects free text in %s", property => {
    expect(Q1DownstreamReceipt.safeParse({ ...valid, [property]: "arbitrary confidential detail" }).success).toBe(false);
  });
  it.each([{ databaseWrites: true }, { callbackPosts: 1 }, { callbackReplayAuthorized: true }])("rejects a claimed write or replay %j", change => {
    expect(Q1DownstreamReceipt.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it("rejects unknown schema names and missing column text", () => {
    expect(Q1DownstreamReceipt.safeParse({ ...valid, schema: [{ model: "private_table", compatible: false, missingColumns: [] }] }).success).toBe(false);
    expect(Q1DownstreamReceipt.safeParse({ ...valid, schema: [{ model: "EmailDelivery", compatible: false, missingColumns: ["private_column"] }] }).success).toBe(false);
    expect(Q1DownstreamReceipt.parse(valid)).toEqual(valid);
    expect(Q1_DOWNSTREAM_MODELS).toEqual(expect.arrayContaining(["CommerceOrderEvent", "CommerceOrderItem", "CommerceEntitlement",
      "EmailDelivery", "RefundRecord", "AffiliateCommission", "MerchantAffiliateCheckoutSnapshot", "MerchantAffiliateCheckoutRecipient"]));
  });
});
