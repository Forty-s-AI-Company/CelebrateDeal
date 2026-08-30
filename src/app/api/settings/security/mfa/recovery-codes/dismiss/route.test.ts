import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dismissMfaRecoveryCodes: vi.fn() }));

vi.mock("@/lib/mfa-enrollment", () => ({
  dismissMfaRecoveryCodes: mocks.dismissMfaRecoveryCodes,
}));

import { POST } from "./route";

describe("MFA recovery-code dismissal route", () => {
  beforeEach(() => {
    mocks.dismissMfaRecoveryCodes.mockReset();
  });

  it("uses the validated browser origin for the platform-admin redirect", async () => {
    mocks.dismissMfaRecoveryCodes.mockResolvedValue({ destination: "/mfa/verify" });
    const formData = new FormData();
    formData.set("csrf", "synthetic-csrf");

    const response = await POST(new Request("http://127.0.0.1:31023/api/settings/security/mfa/recovery-codes/dismiss", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:31023" },
      body: formData,
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31023/mfa/verify");
    expect(mocks.dismissMfaRecoveryCodes).toHaveBeenCalledWith(formData);
  });

  it("falls back to the request origin for the merchant security redirect", async () => {
    mocks.dismissMfaRecoveryCodes.mockResolvedValue({ destination: "/settings/security" });

    const response = await POST(new Request("https://app.example.test/api/settings/security/mfa/recovery-codes/dismiss", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/security");
  });
});
