import { describe, expect, it, vi } from "vitest";

import {
  checkoutIdempotencyStorageKey,
  clearCheckoutIdempotencyKey,
  getOrCreateCheckoutIdempotencyKey,
  readCheckoutIdempotencyKey,
} from "@/lib/checkout-idempotency";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

describe("checkout idempotency persistence", () => {
  it("reuses the same scoped key after a component remount or page refresh", () => {
    const storage = memoryStorage();
    const create = vi.fn().mockReturnValueOnce(FIRST).mockReturnValueOnce(SECOND);

    expect(getOrCreateCheckoutIdempotencyKey(storage, "vendor-1", "product-1", create)).toBe(FIRST);
    expect(getOrCreateCheckoutIdempotencyKey(storage, "vendor-1", "product-1", create)).toBe(FIRST);
    expect(create).toHaveBeenCalledOnce();
  });

  it("isolates keys by vendor/product and clears only the completed or edited checkout", () => {
    const storage = memoryStorage();
    const create = vi.fn().mockReturnValueOnce(FIRST).mockReturnValueOnce(SECOND);

    expect(getOrCreateCheckoutIdempotencyKey(storage, "vendor-1", "product-1", create)).toBe(FIRST);
    expect(getOrCreateCheckoutIdempotencyKey(storage, "vendor-1", "product-2", create)).toBe(SECOND);
    clearCheckoutIdempotencyKey(storage, "vendor-1", "product-1");

    expect(storage.removeItem).toHaveBeenCalledWith(checkoutIdempotencyStorageKey("vendor-1", "product-1"));
    expect(storage.getItem(checkoutIdempotencyStorageKey("vendor-1", "product-2"))).toBe(SECOND);
  });

  it("replaces malformed storage instead of sending it to checkout", () => {
    const storage = memoryStorage();
    storage.setItem(checkoutIdempotencyStorageKey("vendor-1", "product-1"), "forged");

    expect(getOrCreateCheckoutIdempotencyKey(storage, "vendor-1", "product-1", () => FIRST)).toBe(FIRST);
  });

  it("detects only a valid persisted recovery identity without creating a new checkout", () => {
    const storage = memoryStorage();
    expect(readCheckoutIdempotencyKey(storage, "vendor-1", "product-1")).toBeNull();

    storage.setItem(checkoutIdempotencyStorageKey("vendor-1", "product-1"), "forged");
    expect(readCheckoutIdempotencyKey(storage, "vendor-1", "product-1")).toBeNull();

    storage.setItem(checkoutIdempotencyStorageKey("vendor-1", "product-1"), FIRST);
    expect(readCheckoutIdempotencyKey(storage, "vendor-1", "product-1")).toBe(FIRST);
  });
});
