import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ regenerateMfaRecoveryCodes: vi.fn() }));

vi.mock("@/lib/mfa-recovery-regeneration", () => ({
  regenerateMfaRecoveryCodes: mocks.regenerateMfaRecoveryCodes,
}));

import { POST } from "./route";

describe("MFA recovery-code regeneration route", () => {
  beforeEach(() => mocks.regenerateMfaRecoveryCodes.mockReset());

  it("keeps the browser origin for the successful native redirect", async () => {
    mocks.regenerateMfaRecoveryCodes.mockResolvedValue({ ok: true, destination: "/mfa/setup" });
    const formData = new FormData();
    formData.set("code", "123456");
    const response = await POST(new Request("http://127.0.0.1:31023/api/settings/security/mfa/recovery-codes/regenerate", {
      method: "POST", headers: { origin: "http://127.0.0.1:31023" }, body: formData,
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31023/mfa/setup?updated=recovery_regenerated");
    expect(mocks.regenerateMfaRecoveryCodes).toHaveBeenCalledWith(formData);
  });

  it("returns a bounded error redirect without relying on a Server Action", async () => {
    mocks.regenerateMfaRecoveryCodes.mockResolvedValue({ ok: false, destination: "/settings/security", error: "mfa_code" });
    const response = await POST(new Request("https://app.example.test/api/settings/security/mfa/recovery-codes/regenerate", {
      method: "POST", body: new FormData(),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/security?error=mfa_code");
  });
});
