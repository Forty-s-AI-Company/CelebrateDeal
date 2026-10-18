import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { attachRegistrationResult, registrationResultCookieName, verifyRegistrationResult, REGISTRATION_RESULT_TTL_MS } from "./registration-submission-receipt";
const now = 1_791_763_200_000;
const name = registrationResultCookieName(true);
const request = new Request("https://app.example.test/api/form-submissions", { method: "POST", headers: { origin: "https://app.example.test" } });
function result() {
  const response = NextResponse.redirect("https://app.example.test/form/synthetic?submitted=verification_required", 303);
  const data = new FormData(); data.set("formId", "synthetic-form");
  attachRegistrationResult(request, response, data, now);
  return response;
}
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); vi.stubEnv("CSRF_SECRET", "synthetic-receipt-material-".repeat(3)); vi.stubEnv("JOB_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("registration result proof", () => {
  it("binds recent success to form and destination without PII", () => {
    const response = result(); const value = response.cookies.get(name)?.value;
    expect(verifyRegistrationResult(value, "synthetic-form", "/form/synthetic", now)).toBe(true);
    expect(verifyRegistrationResult(value, "other-form", "/form/synthetic", now)).toBe(false);
    expect(verifyRegistrationResult(value, "synthetic-form", "/form/other", now)).toBe(false);
    expect(verifyRegistrationResult(value, "synthetic-form", "/form/synthetic", now + REGISTRATION_RESULT_TTL_MS)).toBe(false);
    expect(response.cookies.get(name)).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects missing, malformed, oversized and tampered proof", () => {
    const value = result().cookies.get(name)!.value;
    const parts = value.split("."); const bytes = Buffer.from(parts[3], "base64url"); bytes[0] ^= 1; parts[3] = bytes.toString("base64url");
    for (const invalid of [undefined, "verification_required", "x".repeat(3801), parts.join(".")]) expect(verifyRegistrationResult(invalid, "synthetic-form", "/form/synthetic", now)).toBe(false);
  });
  it("never issues proof for errors, foreign origin/destination or missing encryption", () => {
    const data = new FormData(); data.set("formId", "synthetic-form");
    for (const response of [NextResponse.json({}, {status:400}), NextResponse.redirect("https://other.example.test/form/synthetic?submitted=verification_required",303),NextResponse.redirect("https://app.example.test/form/synthetic?registrationRetry=400",303)]) {
      attachRegistrationResult(request,response,data,now);expect(response.cookies.get(name)).toBeUndefined();
    }
    const response = NextResponse.redirect("https://app.example.test/form/synthetic?submitted=verification_required",303);
    attachRegistrationResult(new Request(request,{headers:{origin:"https://other.example.test"}}),response,data,now);expect(response.cookies.get(name)).toBeUndefined();
    vi.stubEnv("CSRF_SECRET", "");expect(result().cookies.get(name)).toBeUndefined();
  });
});

it("supports a server-internal response origin while requiring the configured public request origin", () => {
  const req = new Request("http://localhost:31026/api/form-submissions", {method:"POST",headers:{origin:"https://app.example.test"}});
  const response = NextResponse.redirect("http://localhost:31026/form/synthetic?submitted=verification_required",303);
  const data = new FormData();data.set("formId","synthetic-form");
  attachRegistrationResult(req,response,data,now);
  expect(response.headers.get("location")).toBe("https://app.example.test/form/synthetic?submitted=verification_required");
  expect(verifyRegistrationResult(response.cookies.get(name)?.value,"synthetic-form","/form/synthetic",now)).toBe(true);
});

it("keeps success redirect uncacheable when result encryption is unavailable", () => {
  vi.stubEnv("CSRF_SECRET", "");
  const response = result();
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("location")).toBe("https://app.example.test/form/synthetic?submitted=verification_required");
  expect(response.cookies.get(name)).toBeUndefined();
});

it.each([undefined, "null", "https://other.example.test"])("never caches a redirect or issues proof for invalid origin %s", (origin) => {
  const headers = new Headers(); if (origin !== undefined) headers.set("origin", origin);
  const req = new Request(request, { headers });
  const response = NextResponse.redirect("https://app.example.test/form/synthetic?submitted=verification_required", 303);
  const data = new FormData(); data.set("formId", "synthetic-form");
  attachRegistrationResult(req, response, data, now);
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.cookies.get(name)).toBeUndefined();
});
