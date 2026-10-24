import { describe, expect, it } from "vitest";
import {
  hasUnsafeUrlCharacter,
  isSafeContentAssetUrl,
  isSafeContentHref,
  isSafeExternalHttpsUrl,
  isSafeFragmentHref,
  isSafeInternalPath,
  safeContentAssetUrl,
  safeContentHref,
  safeExternalHttpsUrl,
  safeInternalRedirectPath,
} from "@/lib/safe-url";

const cp = (code: number) => String.fromCodePoint(code);
const APP = "https://app.example";

/** Inputs that try to leave the origin or run script; none may pass any helper. */
const BYPASS_VECTORS: Array<[string, string]> = [
  ["protocol-relative", "//evil.example"],
  ["backslash after slash", "/\\evil.example"],
  ["two backslashes after slash", "/\\\\evil.example"],
  ["leading double backslash", "\\\\evil.example"],
  ["backslash then slash", "\\/evil.example"],
  ["tab after slash", "/\t/evil.example"],
  ["newline after slash", "/\n/evil.example"],
  ["carriage return after slash", "/\r/evil.example"],
  ["NUL after slash", `/${cp(0)}/evil.example`],
  ["dot segment collapsing to //", "/.//evil.example"],
  ["dot-dot segment collapsing to //", "/..//evil.example"],
  ["zero-width space after slash", `/${cp(0x200b)}/evil.example`],
  ["right-to-left override", `/${cp(0x202e)}evil.example`],
  ["line separator", `/${cp(0x2028)}/evil.example`],
  ["byte order mark", `/${cp(0xfeff)}/evil.example`],
  ["C1 control", `/${cp(0x85)}/evil.example`],
  ["javascript scheme", "javascript:alert(1)"],
  ["javascript mixed case", "JaVaScRiPt:alert(1)"],
  ["javascript with tab in scheme", "java\tscript:alert(1)"],
  ["javascript with newline in scheme", "java\nscript:alert(1)"],
  ["javascript HTML entity", "&#106;avascript:alert(1)"],
  ["javascript hex entity", "&#x6A;avascript:alert(1)"],
  ["data URL", "data:text/html,<script>alert(1)</script>"],
  ["data URL mixed case", "DaTa:text/html;base64,PHNjcmlwdD4="],
  ["vbscript", "vbscript:msgbox(1)"],
  ["vbscript mixed case", "VBScript:msgbox(1)"],
  ["plain http", "http://evil.example"],
  ["https without slashes", "https:evil.example"],
  ["https with one slash", "https:/evil.example"],
  ["https with backslashes", "https:\\\\evil.example"],
  ["https with backslash authority", "https://\\evil.example"],
  ["https userinfo trick", "https://app.example@evil.example"],
  ["https user and password", "https://user:pass@evil.example/"],
  ["https empty host", "https://"],
  ["https triple slash", "https:///evil.example"],
  ["https empty credentials", "https://:@evil.example"],
  ["https empty user", "https://@evil.example"],
  ["https userinfo with path", "https://app.example@evil.example/a?b=@c"],
  ["https newline in host", "https://exa\nmple.com"],
  ["bare host", "evil.example"],
  ["empty", ""],
];

describe("safe-url bypass vectors", () => {
  it.each(BYPASS_VECTORS)("rejects %s in every helper", (_label, value) => {
    expect(isSafeInternalPath(value)).toBe(false);
    expect(safeInternalRedirectPath(value)).toBeUndefined();
    expect(isSafeExternalHttpsUrl(value)).toBe(false);
    expect(safeExternalHttpsUrl(value)).toBeNull();
    expect(isSafeContentHref(value)).toBe(false);
    expect(isSafeContentAssetUrl(value)).toBe(false);
    expect(safeContentHref(value)).toBeNull();
    expect(safeContentAssetUrl(value)).toBeNull();
  });

  it.each(BYPASS_VECTORS)("rejects %s even with surrounding whitespace", (_label, value) => {
    expect(safeContentHref(`  ${value}  `)).toBeNull();
    expect(safeContentAssetUrl(`\n${value}\t`)).toBeNull();
  });

  it("rejects non-string input everywhere", () => {
    for (const value of [undefined, null, 1, true, {}, ["/dashboard"]]) {
      expect(isSafeInternalPath(value)).toBe(false);
      expect(safeInternalRedirectPath(value)).toBeUndefined();
      expect(isSafeExternalHttpsUrl(value)).toBe(false);
      expect(isSafeFragmentHref(value)).toBe(false);
      expect(safeContentHref(value)).toBeNull();
      expect(safeContentAssetUrl(value)).toBeNull();
    }
  });

  it("rejects values over the length limit", () => {
    expect(isSafeInternalPath(`/${"a".repeat(2048)}`)).toBe(false);
    expect(isSafeExternalHttpsUrl(`https://example.com/${"a".repeat(2048)}`)).toBe(false);
    expect(isSafeFragmentHref(`#${"a".repeat(2048)}`)).toBe(false);
  });
});

describe("isSafeInternalPath (content links)", () => {
  const accepted = [
    "/",
    "/lp/shop",
    "/lp/shop/order?utm_source=line#pricing",
    "/lp/shop?ref=https://partner.example/a",
    "/a//b",
    "/files/my file.pdf",
    "/活動/報名",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%09/evil.example",
  ];

  it.each(accepted)("accepts %s and it stays same-origin when the browser resolves it", (value) => {
    expect(isSafeInternalPath(value)).toBe(true);
    expect(new URL(value, APP).origin).toBe(APP);
  });

  it.each([["anchor", "#top"], ["relative without slash", "lp/shop"], ["leading space", " /lp/shop"], ["backslash later in the path", "/lp\\shop"]])("rejects %s", (_label, value) => {
    expect(isSafeInternalPath(value)).toBe(false);
  });
});

describe("safeInternalRedirectPath (next / return paths)", () => {
  it.each(["/dashboard", "/orders?status=paid", "/lives/live-1/analytics#messages", "/invitations/accept?token=abc_DEF-123"])("keeps %s", (value) => {
    expect(safeInternalRedirectPath(value)).toBe(value);
  });

  it.each([["double slash later", "/a//evil.example"], ["slashes in the query", "/orders?ref=https://evil.example"], ["space", "/ /evil.example"], ["non-breaking space", `/${cp(0xa0)}/evil.example`]])("is stricter than content links: rejects %s", (_label, value) => {
    expect(safeInternalRedirectPath(value)).toBeUndefined();
  });

  it("returns a normalized path that is still same-origin", () => {
    for (const value of ["/%2F%2Fevil.example", "/%5C%5Cevil.example", "/./orders", "/a/../orders"]) {
      const safe = safeInternalRedirectPath(value);
      expect(safe).toBeDefined();
      expect(safe!.startsWith("//")).toBe(false);
      expect(new URL(safe!, APP).origin).toBe(APP);
    }
  });
});

describe("isSafeFragmentHref", () => {
  it("accepts in-page anchors and rejects control characters", () => {
    expect(isSafeFragmentHref("#pricing")).toBe(true);
    expect(isSafeFragmentHref("#")).toBe(true);
    expect(isSafeFragmentHref("#\t//evil.example")).toBe(false);
    expect(isSafeFragmentHref("#a\\b")).toBe(false);
    expect(isSafeFragmentHref("/#x")).toBe(false);
  });
});

describe("safeExternalHttpsUrl", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    ["https://example.com/offer?x=1#y", "https://example.com/offer?x=1#y"],
    ["HTTPS://Example.com/a", "https://example.com/a"],
    ["https://example.com:8443/a", "https://example.com:8443/a"],
    ["https://example.com/u/@handle?mail=a@b.example#@x", "https://example.com/u/@handle?mail=a@b.example#@x"],
  ])("accepts %s", (value, canonical) => {
    expect(isSafeExternalHttpsUrl(value)).toBe(true);
    expect(safeExternalHttpsUrl(value)).toBe(canonical);
  });
});

describe("content href / asset helpers", () => {
  it("accepts the legitimate forms and returns them as authored", () => {
    expect(safeContentHref("  /lp/shop?x=1#y  ")).toBe("/lp/shop?x=1#y");
    expect(safeContentHref("#webinar-registration")).toBe("#webinar-registration");
    expect(safeContentHref("https://example.com/offer")).toBe("https://example.com/offer");
    expect(safeContentHref("https://Example.com")).toBe("https://Example.com");
    expect(safeContentAssetUrl("/images/bg.png")).toBe("/images/bg.png");
    expect(safeContentAssetUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
  });

  it("does not treat a bare anchor as an asset", () => {
    expect(isSafeContentHref("#top")).toBe(true);
    expect(isSafeContentAssetUrl("#top")).toBe(false);
    expect(safeContentAssetUrl("#top")).toBeNull();
  });

  it("flags unsafe characters", () => {
    expect(hasUnsafeUrlCharacter("/a\\b")).toBe(true);
    expect(hasUnsafeUrlCharacter("/a\tb")).toBe(true);
    expect(hasUnsafeUrlCharacter("/a b")).toBe(false);
    expect(hasUnsafeUrlCharacter("/活動")).toBe(false);
  });
});
