import { describe, expect, it } from "vitest";
import { safeInternalPath, safeInternalPathOr } from "@/lib/safe-internal-path";

describe("safeInternalPath", () => {
  it.each([
    "/dashboard",
    "/orders?status=paid",
    "/lives/live-1/analytics#messages",
    "/invitations/accept?token=abc_DEF-123",
  ])("keeps the in-app path %s", (value) => {
    expect(safeInternalPath(value)).toBe(value);
  });

  it.each([
    ["tab after slash", "/\t/evil.example"],
    ["newline after slash", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["double backslash", "/\\\\evil.example"],
    ["double slash later in the path", "/a//evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["absolute https", "https://evil.example"],
    ["relative without slash", "dashboard"],
    ["space", "/ /evil.example"],
    ["non-breaking space", `/${String.fromCodePoint(0xa0)}/evil.example`],
    ["line separator", `/${String.fromCodePoint(0x2028)}/evil.example`],
    ["byte order mark", `/${String.fromCodePoint(0xfeff)}/evil.example`],
    ["empty", ""],
    ["too long", `/${"a".repeat(2048)}`],
  ])("rejects %s", (_label, value) => {
    expect(safeInternalPath(value)).toBeUndefined();
  });

  it("rejects non-strings and falls back", () => {
    expect(safeInternalPath(undefined)).toBeUndefined();
    expect(safeInternalPath(["/dashboard"])).toBeUndefined();
    expect(safeInternalPathOr("/\t/evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeInternalPathOr("/orders", "/dashboard")).toBe("/orders");
  });

  it("never yields a cross-origin destination after browser resolution", () => {
    for (const value of ["/%09/evil.example", "/.%2F%2Fevil.example", "/%5C%5Cevil.example", "/./evil.example"]) {
      const safe = safeInternalPath(value);
      if (safe) expect(new URL(safe, "https://app.example").origin).toBe("https://app.example");
    }
  });
});
