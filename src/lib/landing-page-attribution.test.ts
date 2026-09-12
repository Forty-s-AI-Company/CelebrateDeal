import { describe, expect, it } from "vitest";
import { registrationAttributionHref } from "./landing-page-attribution";

describe("招生頁來源傳遞", () => {
  it("保留場次與錨點，只傳允許的來源參數", () => {
    const result = new URL(registrationAttributionHref("/form/course?liveId=live1#register", "?utm_source=ad&secret=hidden&share=team", "page1"), "https://test.invalid");
    expect(result.searchParams.get("liveId")).toBe("live1");
    expect(result.searchParams.get("utm_source")).toBe("ad");
    expect(result.searchParams.get("share")).toBe("team");
    expect(result.searchParams.get("lp")).toBe("page1");
    expect(result.searchParams.has("secret")).toBe(false);
    expect(result.hash).toBe("#register");
  });
  it("不傳送來源到外站，也不覆寫明確設定的來源", () => {
    expect(registrationAttributionHref("https://example.com", "?utm_source=ad", "page1")).toBe("https://example.com");
    expect(registrationAttributionHref("#pricing", "?utm_source=ad")).toBe("#pricing");
    expect(registrationAttributionHref("/form/course?utm_source=own", "?utm_source=ad")).toBe("/form/course?utm_source=own");
  });
});
