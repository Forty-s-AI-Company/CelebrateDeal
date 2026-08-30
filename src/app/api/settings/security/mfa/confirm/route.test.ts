import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeMfaEnrollment: vi.fn(),
}));

vi.mock("@/lib/mfa-enrollment", () => ({
  completeMfaEnrollment: mocks.completeMfaEnrollment,
}));

import { POST } from "./route";

describe("MFA confirmation route", () => {
  beforeEach(() => {
    mocks.completeMfaEnrollment.mockReset();
  });

  it("keeps the validated browser origin on the native redirect", async () => {
    mocks.completeMfaEnrollment.mockResolvedValue({ ok: true, destination: "/settings/security" });
    const formData = new FormData();
    formData.set("code", "123456");

    const response = await POST(new Request("http://127.0.0.1:31023/api/settings/security/mfa/confirm", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:31023" },
      body: formData,
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31023/settings/security?updated=mfa_enabled");
    expect(mocks.completeMfaEnrollment).toHaveBeenCalledWith(formData);
  });

  it("falls back to the request origin when a browser omits Origin", async () => {
    mocks.completeMfaEnrollment.mockResolvedValue({ ok: false, destination: "/settings/security", error: "mfa_code" });

    const response = await POST(new Request("https://app.example.test/api/settings/security/mfa/confirm", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/security?error=mfa_code");
  });
});
