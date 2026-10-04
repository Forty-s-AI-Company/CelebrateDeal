import { describe, expect, it } from "vitest";
import { safeMfaReturnPath, withMfaReturnPath } from "./mfa-return-path";

describe("MFA return navigation", () => {
  it.each(["https://outside.invalid/orders", "//outside.invalid", "/\\outside.invalid", "/\t/outside.invalid", "/\n/outside.invalid", "orders", null, ["/orders"], "/" + "a".repeat(2048)])("rejects unsafe or malformed destination %j", (value) => {
    expect(safeMfaReturnPath(value)).toBeUndefined();
    expect(withMfaReturnPath("/mfa/setup?error=mfa_code", value)).toBe("/mfa/setup?error=mfa_code");
  });

  it("preserves internal query and fragment through nested query encoding", () => {
    const next = "/orders?filter=paid&search=%E8%AA%B2%E7%A8%8B#receipt";
    const result = withMfaReturnPath("/mfa/setup?updated=mfa_enabled", next);
    const url = new URL(result, "https://app.invalid");
    expect(url.searchParams.get("updated")).toBe("mfa_enabled");
    expect(url.searchParams.get("next")).toBe(next);
    expect(url.origin).toBe("https://app.invalid");
  });

  it("normalizes internal dot segments and replaces an earlier next parameter", () => {
    expect(safeMfaReturnPath("/projects/../orders")).toBe("/orders");
    expect(withMfaReturnPath("/mfa/verify?next=%2Fold", "/orders")).toBe("/mfa/verify?next=%2Forders");
  });
});
