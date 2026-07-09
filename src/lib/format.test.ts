import { describe, expect, it } from "vitest";
import { formatCurrency, toSlug } from "./format";

describe("format helpers", () => {
  it("formats TWD without fractional digits", () => {
    expect(formatCurrency(168000, "TWD")).toContain("1,680");
  });

  it("creates URL-safe slugs while keeping Chinese words", () => {
    expect(toSlug(" 夏季 新品 Live!! ")).toBe("夏季-新品-live");
  });
});
