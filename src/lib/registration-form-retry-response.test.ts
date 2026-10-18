import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), limited: vi.fn(), form: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findUnique: mocks.form }, salesProject: { findFirst: mocks.project } }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limited }));
vi.mock("@/lib/registration-form-retry", async (original) => ({ ...await original<typeof import("@/lib/registration-form-retry")>(), saveRegistrationRetryDraft: mocks.save, deleteRegistrationRetryDraft: mocks.remove }));
import { clearRegistrationRetry, registrationRetryResponse } from "./registration-form-retry-response";
import { NextResponse } from "next/server";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); mocks.save.mockResolvedValue("synthetic-retry"); mocks.remove.mockResolvedValue(true); mocks.limited.mockResolvedValue(null); mocks.form.mockResolvedValue({ id: "synthetic-form", vendorId: "synthetic-vendor", isActive: true, projectId: null, fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] }); });
afterEach(() => vi.unstubAllEnvs());
const request = (origin = "https://app.example.test") => new Request("https://app.example.test/api/form-submissions", { method: "POST", headers: { origin } });
function fields(path = "/form/synthetic") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ formId: "synthetic-form", __registrationReturnPath: path, name: "合成使用者", email: "synthetic@example.test", liveId: "synthetic-live" })) data.set(key, value);
  return data;
}
describe("native retry response", () => {
  it.each([400,403,404,429,503])("returns safe 303 and an opaque host cookie for %i", async (status) => {
    const response = await registrationRetryResponse(request(), fields(), status);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://app.example.test/form/synthetic?registrationRetry=${status}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get("__Host-celebratedeal_registration_retry")?.value).toBe("synthetic-retry");
    expect(response.headers.get("location")).not.toContain("synthetic@example.test");
    expect(mocks.save).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ status, vendorId: "synthetic-vendor", formId: "synthetic-form", answers: { name: "合成使用者", email: "synthetic@example.test" }, liveId: "synthetic-live" }));
  });
  it.each(["//attacker.test/collect", "/form/synthetic?email=value", "/admin", "/form/%2e%2e"])("rejects unsafe return path %s before storing", async (path) => {
    const response = await registrationRetryResponse(request(), fields(path), 400);
    expect(response.headers.get("location")).toBe("https://app.example.test/registration-error"); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not preserve cross-origin input", async () => {
    const response = await registrationRetryResponse(request("https://attacker.test"), fields(), 403);
    expect(response.status).toBe(303); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["storage", "limit"])("honestly reports unavailable retention for %s", async (failure) => {
    if (failure === "storage") mocks.save.mockResolvedValue(null); else mocks.limited.mockResolvedValue(new Response(null, { status: 429 }));
    const response = await registrationRetryResponse(request(), fields(), 503);
    expect(response.headers.get("location")).toBe("https://app.example.test/form/synthetic?registrationRetry=unavailable");
    expect(response.cookies.get("__Host-celebratedeal_registration_retry")).toBeUndefined();
    if (failure === "limit") expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not silently overwrite duplicate answers", async () => {
    const data = fields(); data.append("email", "second@example.test");
    await registrationRetryResponse(request(), data, 400); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("clears the browser draft even when database deletion fails", async () => {
    mocks.remove.mockResolvedValue(false);
    const req = new Request(request(), { headers: { cookie: "__Host-celebratedeal_registration_retry=synthetic-existing" } });
    const response = NextResponse.json({ ok: true }); await clearRegistrationRetry(req, response);
    expect(response.cookies.get("__Host-celebratedeal_registration_retry")?.value).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

it("accepts configured public origin across an internal loopback URL without trusting forwarded host", async () => {
 const req = new Request("http://127.0.0.1:9999/api/form-submissions", { method: "POST", headers: { origin: "https://app.example.test", "x-forwarded-host": "attacker.test" } });
 const response = await registrationRetryResponse(req, fields(), 400);
 expect(response.headers.get("location")).toBe("https://app.example.test/form/synthetic?registrationRetry=400");
 expect(response.cookies.get("__Host-celebratedeal_registration_retry")).toBeDefined();
});

it.each(["missing", "inactive", "unpublished-project", "unknown-field"])("does not store ineligible input: %s", async (scenario) => {
  const data = fields();
  if (scenario === "missing") mocks.form.mockResolvedValue(null);
  if (scenario === "inactive") mocks.form.mockResolvedValue({ isActive: false });
  if (scenario === "unpublished-project") { mocks.form.mockResolvedValue({ id: "synthetic-form", isActive: true, projectId: "draft-project", vendorId: "vendor" }); mocks.project.mockResolvedValue(null); }
  if (scenario === "unknown-field") data.set("undefinedField", "synthetic");
  const response = await registrationRetryResponse(request(), data, 404);
  expect(response.headers.get("location")).toContain("registrationRetry=unavailable");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("stores attribution separately from answers and keeps it out of the redirect URL", async () => {
  const data = fields();
  const attribution = { referralCode: "synthetic-ref", shareCode: `tls1.${"a".repeat(32)}`, landingPageId: "synthetic-page" };
  for (const [key, value] of Object.entries(attribution)) data.set(key, value);
  const response = await registrationRetryResponse(request(), data, 400);
  expect(mocks.save).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ attribution, answers: { name: "合成使用者", email: "synthetic@example.test" } }));
  expect(response.headers.get("location")).toBe("https://app.example.test/form/synthetic?registrationRetry=400");
});

it("takes the tenant and form identity from the server record, not the request", async () => {
  const data = fields();
  data.set("vendorId", "attacker-vendor");
  await registrationRetryResponse(request(), data, 400);
  expect(mocks.save).not.toHaveBeenCalled();
  const clean = fields();
  await registrationRetryResponse(request(), clean, 400);
  expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "synthetic-form" } }));
  expect(mocks.save).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ vendorId: "synthetic-vendor", formId: "synthetic-form" }));
});

it("stores an empty liveId as no session and keeps an unknown status opaque", async () => {
  const data = fields(); data.set("liveId", "");
  const response = await registrationRetryResponse(request(), data, 500);
  expect(mocks.save).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ liveId: null, status: 503 }));
  expect(response.headers.get("location")).toBe("https://app.example.test/form/synthetic?registrationRetry=503");
});
