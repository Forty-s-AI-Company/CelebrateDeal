import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOptionalCommerceUrl, safeCommerceUrlOrNull, UnsafeCommerceUrlError } from "@/lib/safe-commerce-url";

describe("safe commerce URLs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts and normalizes an absolute HTTPS URL", () => {
    expect(safeCommerceUrlOrNull("https://shop.example.com/item?id=1")).toBe("https://shop.example.com/item?id=1");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,unsafe",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "//evil.example/item",
    " https://evil.example/item",
    "https://user:pass@evil.example/item",
    "https://evil.example/\nitem",
  ])("rejects unsafe URL %s", (value) => {
    expect(safeCommerceUrlOrNull(value)).toBeNull();
  });

  it("allows local HTTP only outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(safeCommerceUrlOrNull("http://localhost:31023/checkout")).toBe("http://localhost:31023/checkout");
    vi.stubEnv("NODE_ENV", "production");
    expect(safeCommerceUrlOrNull("http://localhost:31023/checkout")).toBeNull();
  });

  it("throws for unsafe persisted values", () => {
    expect(() => normalizeOptionalCommerceUrl("javascript:alert(1)")).toThrow(UnsafeCommerceUrlError);
    expect(normalizeOptionalCommerceUrl(null)).toBeNull();
  });
});
