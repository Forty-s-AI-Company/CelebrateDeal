import { describe, expect, it, vi } from "vitest";
import {
  CommerceCustomCheckoutValidationError,
  createCustomCheckoutIdentityHash,
  parseCustomCheckoutFields,
  protectCustomCheckoutAnswers,
  revealCustomCheckoutAnswers,
  validateCustomCheckoutAnswers,
} from "./commerce-custom-checkout";

const fields = [
  { key: "engraving", label: "刻字內容", type: "text" as const, required: true },
  { key: "note", label: "備註", type: "textarea" as const, required: false },
  { key: "size", label: "尺寸", type: "select" as const, required: true, options: ["S", "M", "L"] },
  { key: "confirmed", label: "我已確認內容", type: "checkbox" as const, required: true },
];
const answers = { engraving: "給小明", note: "", size: "M", confirmed: true };

describe("commerce custom checkout", () => {
  it("accepts a bounded strict definition and exact answers", () => {
    expect(parseCustomCheckoutFields(fields)).toEqual(fields);
    expect(validateCustomCheckoutAnswers(fields, answers)).toEqual(answers);
  });

  it("rejects extra keys, duplicate options, optional checkboxes, and invalid answers", () => {
    expect(() => parseCustomCheckoutFields([{ ...fields[0], extra: true }])).toThrow(CommerceCustomCheckoutValidationError);
    expect(() => parseCustomCheckoutFields([{ ...fields[2], options: ["S", "S"] }])).toThrow(CommerceCustomCheckoutValidationError);
    expect(() => parseCustomCheckoutFields([{ ...fields[3], required: false }])).toThrow(CommerceCustomCheckoutValidationError);
    expect(() => validateCustomCheckoutAnswers(fields, { ...answers, forged: "x" })).toThrow(CommerceCustomCheckoutValidationError);
    expect(() => validateCustomCheckoutAnswers(fields, { ...answers, size: "XL" })).toThrow(CommerceCustomCheckoutValidationError);
    expect(() => validateCustomCheckoutAnswers(fields, { ...answers, confirmed: false })).toThrow(CommerceCustomCheckoutValidationError);
  });

  it("creates a deterministic custom-answer identity hash and preserves the legacy hash without fields", () => {
    vi.stubEnv("CSRF_SECRET", "custom-checkout-test-secret-that-is-at-least-32-bytes");
    const input = {
      vendorId: "vendor-1",
      productId: "product-1",
      basePiiHash: "base-pii-hash",
      definitions: fields,
      answers,
    };
    const hash = createCustomCheckoutIdentityHash(input);

    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createCustomCheckoutIdentityHash({
      ...input,
      answers: { size: "M", confirmed: true, note: "", engraving: "給小明" },
    })).toBe(hash);
    expect(createCustomCheckoutIdentityHash({
      ...input,
      answers: { ...answers, engraving: "給小華" },
    })).not.toBe(hash);
    expect(createCustomCheckoutIdentityHash({
      ...input,
      definitions: [],
      answers: undefined,
    })).toBe("base-pii-hash");
    vi.unstubAllEnvs();
  });

  it("encrypts answers and fails closed when any purpose binding changes", () => {
    vi.stubEnv("CSRF_SECRET", "custom-checkout-test-secret-that-is-at-least-32-bytes");
    const binding = { vendorId: "vendor-1", orderId: "order-1", orderItemId: "item-1" };
    const envelope = protectCustomCheckoutAnswers(fields, answers, binding);
    expect(envelope).toMatch(/^v1\./u);
    expect(envelope).not.toContain("給小明");
    expect(revealCustomCheckoutAnswers(envelope, fields, binding)).toEqual(answers);
    expect(() => revealCustomCheckoutAnswers(envelope, fields, { ...binding, orderItemId: "item-2" })).toThrow();
    vi.unstubAllEnvs();
  });
});
