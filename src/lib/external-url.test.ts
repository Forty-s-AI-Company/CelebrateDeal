import { describe, expect, it } from "vitest";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";

describe("parseSafeExternalHttpUrl", () => {
  it.each([
    ["https://shop.example.test/product?id=1", "https://shop.example.test/product?id=1"],
    ["http://localhost:31023/test", "http://localhost:31023/test"],
  ])("accepts the HTTP(S) URL %s", (value, expected) => {
    expect(parseSafeExternalHttpUrl(value)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//attacker.example.test/path",
    "/relative-path",
    "https://user:password@example.test/path",
    "not a url",
    "",
  ])("rejects the unsafe external URL %j", (value) => {
    expect(parseSafeExternalHttpUrl(value)).toBeNull();
  });
});
