import { describe, expect, it } from "vitest";
import { registrationAttribution, registrationAttributionFromSearchParams } from "./registration-attribution";

describe("registration attribution transport", () => {
  it("maps supported scalar query fields without treating them as authorization", () => {
    expect(registrationAttribution({ ref: "synthetic-ref", share: `tls1.${"a".repeat(32)}`, lp: "synthetic-page" })).toEqual({ referralCode: "synthetic-ref", shareCode: `tls1.${"a".repeat(32)}`, landingPageId: "synthetic-page" });
  });
  it("omits duplicates, malformed identities and oversized values", () => {
    expect(registrationAttribution({ ref: ["one", "two"], share: "invalid", lp: "../other" })).toEqual({});
    expect(registrationAttribution({ ref: "x".repeat(81), share: `tls1.${"a".repeat(156)}`, lp: "a".repeat(129) })).toEqual({});
    expect(registrationAttribution()).toEqual({});
  });
});

it("legacy browser query rejects repeated values like server searchParams", () => {
  expect(registrationAttributionFromSearchParams(new URLSearchParams("ref=a&ref=b&lp=x&lp=y"))).toEqual({});
  expect(registrationAttributionFromSearchParams(new URLSearchParams("ref=a&lp=x"))).toEqual(registrationAttribution({ ref: "a", lp: "x" }));
});
