import { describe, expect, it } from "vitest";

import { checkoutSessionFromMetadata } from "./payment-checkout-presentation";

const validPayUniPayload = {
  MerID: "synthetic-merchant",
  Version: "2.0",
  EncryptInfo: "synthetic-encrypted",
  HashInfo: "synthetic-hash",
};

describe("checkoutSessionFromMetadata", () => {
  it("returns only the complete PayUni checkout field allowlist", () => {
    const session = checkoutSessionFromMetadata({
      checkoutSession: {
        provider: "payuni",
        mode: "form_post",
        formPayload: { ...validPayUniPayload, unexpected: "must-not-leave-the-server" },
      },
    });

    expect(session.formPayload).toEqual(validPayUniPayload);
    expect(session.formPayload).not.toHaveProperty("unexpected");
  });

  it.each([
    ["missing required field", { MerID: "synthetic-merchant", Version: "2.0", EncryptInfo: "synthetic-encrypted" }],
    ["empty required field", { ...validPayUniPayload, HashInfo: "" }],
    ["oversized field", { ...validPayUniPayload, EncryptInfo: "x".repeat(4097) }],
    ["unsupported provider", validPayUniPayload, "other-provider"],
  ])("fails closed for %s", (_label, formPayload, provider = "payuni") => {
    const session = checkoutSessionFromMetadata({
      checkoutSession: { provider, mode: "form_post", formPayload },
    });

    expect(session.formPayload).toEqual({});
  });
});
