import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startMfaEnrollment: vi.fn(),
}));

vi.mock("@/lib/mfa-enrollment", () => ({
  startMfaEnrollment: mocks.startMfaEnrollment,
}));

import { POST } from "./route";

describe("MFA start route", () => {
  beforeEach(() => {
    mocks.startMfaEnrollment.mockReset();
  });

  it.each(["/orders?status=paid", "//outside.invalid"])("preserves only a validated return: %s", async (next) => {
    mocks.startMfaEnrollment.mockResolvedValue({ destination: "/mfa/setup", updated: "mfa_started" });
    const body = new FormData();
    body.set("next", next);
    const response = await POST(new Request("https://app.example.test/api/settings/security/mfa/start", { method: "POST", body }));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://app.example.test");
    expect(location.pathname).toBe("/mfa/setup");
    expect(location.searchParams.get("updated")).toBe("mfa_started");
    expect(location.searchParams.get("next")).toBe(next.startsWith("//") ? null : next);
  });

  it("keeps the validated browser origin on the native redirect", async () => {
    mocks.startMfaEnrollment.mockResolvedValue({ destination: "/mfa/setup", updated: "mfa_started" });
    const formData = new FormData();
    formData.set("csrf", "synthetic-csrf");

    const response = await POST(new Request("http://127.0.0.1:31023/api/settings/security/mfa/start", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:31023" },
      body: formData,
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31023/mfa/setup?updated=mfa_started");
    expect(mocks.startMfaEnrollment).toHaveBeenCalledWith(formData);
  });

  it("returns the existing-factor state without exposing account data", async () => {
    mocks.startMfaEnrollment.mockResolvedValue({ destination: "/settings/security", updated: "mfa_exists" });

    const response = await POST(new Request("https://app.example.test/api/settings/security/mfa/start", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/security?updated=mfa_exists");
  });
});
