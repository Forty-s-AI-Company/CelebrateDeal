import { afterEach, describe, expect, it, vi } from "vitest";
import { formSubmissionErrorMessage, postRegistrationSubmission } from "./registration-submission-client";

afterEach(() => vi.unstubAllGlobals());

describe("public registration client contract", () => {
  it("posts to the fixed local API and preserves tenant-scoped provenance and optional attribution", async () => {
    const response = Response.json({ ok: true, verificationRequired: true });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const body = { formId: "synthetic-form", landingPageId: "synthetic-page", funnelStepId: "opt_in", liveId: null, payload: { name: "Synthetic", email: "synthetic@example.invalid" }, referralCode: "synthetic-ref" };
    expect(await postRegistrationSubmission(body)).toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/form-submissions");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("manual");
    expect(options.headers).toEqual({ "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" });
    expect(JSON.parse(options.body)).toEqual(body);
  });

  it.each([400, 403, 404, 429, 503])("leaves HTTP %i available to both form callers without displaying server details", async (status) => {
    const response = new Response("synthetic internal diagnostic must not be shown", { status });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const result = await postRegistrationSubmission({ formId: "synthetic-form", payload: {} });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(status);
    expect(formSubmissionErrorMessage(status)).not.toContain("internal");
    expect(formSubmissionErrorMessage(status)).toMatch(/請/);
  });

  it("propagates network failure so the caller can unlock retry without clearing inputs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("synthetic network failure")));
    await expect(postRegistrationSubmission({ payload: {} })).rejects.toThrow(TypeError);
    expect(formSubmissionErrorMessage()).toContain("內容仍保留");
  });

  it("distinguishes security rejection from validation, rate and availability failures", () => {
    expect(formSubmissionErrorMessage(400)).toContain("資料格式");
    expect(formSubmissionErrorMessage(403)).toContain("安全檢查");
    expect(formSubmissionErrorMessage(403)).not.toContain("重新整理");
    expect(formSubmissionErrorMessage(403)).toContain("重新開啟活動頁");
    expect(formSubmissionErrorMessage(429)).toContain("一分鐘");
    expect(formSubmissionErrorMessage(404)).toContain("無法接收");
    expect(formSubmissionErrorMessage(503)).toContain("無法接收");
  });
});

// Server responses must not be presented as failed network connections.
describe("HTTP and network error guidance", () => {
  it.each([409, 422, 500, 502, 504])("keeps HTTP %i neutral and preserves retry guidance", (status) => {
    expect(formSubmissionErrorMessage(status)).not.toContain("網路");
    expect(formSubmissionErrorMessage(status)).toContain("內容仍保留");
    expect(formSubmissionErrorMessage(status)).toContain("稍後再試");
  });
  it("reserves connection advice for fetch failures without an HTTP status", () => {
    expect(formSubmissionErrorMessage()).toContain("檢查網路");
  });
});

it.each([
  () => new Response("<h1>Proxy error</h1>", { headers: { "Content-Type": "text/html" } }),
  () => Response.json({ ok: false, verificationRequired: true }),
  () => Response.json({ ok: true, verificationRequired: false }),
  () => Response.json(null),
  () => new Response("broken", { headers: { "Content-Type": "application/json" } }),
  () => new Response(null, { status: 204 }),
])("does not treat an unrelated 2xx response as accepted registration", async (makeResponse) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse()));
  const response = await postRegistrationSubmission({ formId: "synthetic" });
  expect(response.ok).toBe(false);
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
});
it("rejects a followed redirect even with an otherwise valid body", async () => {
  const redirected = Response.json({ ok: true, verificationRequired: true });
  Object.defineProperty(redirected, "redirected", { value: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirected));
  expect((await postRegistrationSubmission({})).status).toBe(503);
});
it("keeps the original accepted response body readable by callers", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, verificationRequired: true })));
  const response = await postRegistrationSubmission({});
  expect(await response.json()).toEqual({ ok: true, verificationRequired: true });
});

it("rejects manual opaque redirects and retains neutral retry guidance", async () => {
  // 瀏覽器 manual redirect 為 status 0，不能用一般 Response constructor 建立。
  const opaque = Response.error();
  Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(opaque));
  const response = await postRegistrationSubmission({});
  expect(response.ok).toBe(false);
  expect(response.status).toBe(0);
  expect(formSubmissionErrorMessage(response.status)).not.toContain("網路");
  expect(formSubmissionErrorMessage(response.status)).toContain("內容仍保留");
});
