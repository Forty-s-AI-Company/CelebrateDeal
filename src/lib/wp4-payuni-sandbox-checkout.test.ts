import { describe, expect, it } from "vitest";
import {
  wp4PayUniSandboxCheckoutIdempotencyKey,
  wp4PayUniSandboxMetadata,
} from "@/lib/wp4-payuni-sandbox-checkout";

const sourceCommit = "a".repeat(40);

describe("WP4 source-bound checkout identity", () => {
  it("creates a deterministic current-source idempotency key", () => {
    expect(wp4PayUniSandboxCheckoutIdempotencyKey(sourceCommit, "buyer_order"))
      .toBe(`wp4-payuni-sandbox:v1:${sourceCommit}:buyer_order`);
  });

  it("adds only server-owned source and fixture identity metadata", () => {
    expect(wp4PayUniSandboxMetadata(sourceCommit, "invoice_payment", { invoiceId: "wp4_synthetic_invoice_v1" }))
      .toEqual({
        billingPurpose: "invoice_payment",
        invoiceId: "wp4_synthetic_invoice_v1",
        wp4SourceCommit: sourceCommit,
      });
  });

  it("fails closed for malformed source, purpose, or fixture values", () => {
    expect(wp4PayUniSandboxCheckoutIdempotencyKey("main", "buyer_order")).toBeNull();
    expect(wp4PayUniSandboxMetadata(sourceCommit, "buyer_order", { "caller-input": "x" })).toBeNull();
    expect(wp4PayUniSandboxMetadata(sourceCommit, "buyer_order", { productId: "" })).toBeNull();
  });
});
