import { describe, expect, it } from "vitest";
import { GET } from "@/app/sandbox/custom-code/route";
import { FUNNEL_CUSTOM_CODE_SANDBOX_CSP } from "@/lib/content-security-policy";
import { FUNNEL_CUSTOM_CODE_SANDBOX_BOOTSTRAP } from "@/lib/funnel-custom-code";

describe("GET /sandbox/custom-code (F-156)", () => {
  it("serves the fixed bootstrap document under the sandbox CSP", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(FUNNEL_CUSTOM_CODE_SANDBOX_CSP);
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toBe(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><script>${FUNNEL_CUSTOM_CODE_SANDBOX_BOOTSTRAP}</script></head><body></body></html>`);
  });

  it("takes no input: every request gets the same response", async () => {
    expect(await (await GET()).text()).toBe(await (await GET()).text());
    expect(GET.length).toBe(0);
  });
});
