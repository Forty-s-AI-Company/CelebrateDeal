import { describe, expect, it } from "vitest";
import { publicInteractionMetadata } from "./public-interaction-metadata";

describe("publicInteractionMetadata", () => {
  it("only exposes normalized poll fields, including nested options", () => {
    expect(publicInteractionMetadata({ eventType: "poll", triggerSec: 0, metadata: {
      question: " 選擇課程 ", durationSec: 60, internalNote: "private",
      options: [{ label: "A", privateKey: "private" }, { label: "B" }],
    } }, new Set())).toEqual({ metadata: {
      kind: "poll", question: "選擇課程", durationSec: 60,
      options: [{ id: "option-1", label: "A" }, { id: "option-2", label: "B" }],
    } });
  });

  it.each(["flash_sale", "flash_voucher"])("does not expose %s for an unbound product", (eventType) => {
    const event = { eventType, triggerSec: 0, metadata: {
      productId: "other-product", discountValue: 10, maxClaims: 5,
    } };
    expect(publicInteractionMetadata(event, new Set(["live-product"]))).toEqual({});
    expect(publicInteractionMetadata(event, new Set(["other-product"]))).toHaveProperty("metadata.productId", "other-product");
  });

  it("preserves a live-wide voucher without a product restriction", () => {
    expect(publicInteractionMetadata({ eventType: "flash_voucher", triggerSec: 0,
      metadata: { discountValue: 10, maxClaims: 5 } }, new Set())).toHaveProperty("metadata.productId", null);
  });

  it.each([
    { eventType: "poll", triggerSec: 0, metadata: { question: "invalid", options: [] } },
    { eventType: "unknown", triggerSec: 0, metadata: { privateKey: "private" } },
    { eventType: "reminder", triggerSec: 0, message: "hello", metadata: { privateKey: "private" } },
  ])("omits invalid or non-advanced metadata", (event) => {
    expect(publicInteractionMetadata(event, new Set())).toEqual({});
  });
});
