import { describe, expect, it } from "vitest";
import { platformPaymentHandoffResponse } from "./platform-payment-handoff";

const session = { provider: "payuni", mode: "form_post", formAction: "https://api.payuni.com.tw/api/upp", formPayload: { MerID: "synthetic", Version: "2.0", EncryptInfo: 'synthetic\"<script>', HashInfo: "synthetic-hash" } };
describe("POST-only platform payment handoff", () => {
  it("posts allowlisted encrypted fields with escaped attributes and a hashed script CSP", async () => {
    const response = platformPaymentHandoffResponse(session)!;
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(html).toContain('method="post" action="https://api.payuni.com.tw/api/upp"');
    expect(html).toContain("synthetic&quot;&lt;script&gt;");
    expect(html).toContain("requestSubmit()");
    expect(html).toContain("若未自動跳轉，按此繼續付款");
  });
  it.each([null, { ...session, formAction: "https://evil.example/" }, { ...session, formPayload: { MerID: "only-one-field" } }, { ...session, mode: "manual" }])("fails closed for unusable sessions %j", (value) => {
    expect(platformPaymentHandoffResponse(value)).toBeNull();
  });
  it("redirects only to an exact allowed provider URL", () => {
    expect(platformPaymentHandoffResponse({ mode: "redirect", checkoutUrl: "https://api.payuni.com.tw/api/upp" })?.headers.get("location")).toBe("https://api.payuni.com.tw/api/upp");
    expect(platformPaymentHandoffResponse({ mode: "redirect", checkoutUrl: "https://evil.example/" })).toBeNull();
  });
});
