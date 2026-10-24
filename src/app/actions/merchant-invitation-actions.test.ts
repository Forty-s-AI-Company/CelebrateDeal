import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real platform-admin guard and audit writer run; only the session store,
// request headers and database are synthetic.
const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  findSession: vi.fn(),
  findUser: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic-session-token" }) }),
  headers: async () => new Headers({ "user-agent": "synthetic-agent" }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/mfa", () => ({ decryptMfaSecret: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    userSession: { findUnique: mocks.findSession },
    user: { findUnique: mocks.findUser },
    auditLog: { create: mocks.auditCreate },
  }),
}));

import { createMerchantInvitationAction } from "./merchant-invitation-actions";
import { verifyMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";

function sessionFor({ platformRole, memberRole, mfaFactor = { id: "mfa-1" }, mfaVerifiedAt = new Date() }: {
  platformRole: string;
  memberRole?: string;
  mfaFactor?: { id: string } | null;
  mfaVerifiedAt?: Date | null;
}) {
  const memberships = memberRole
    ? [{ id: "member-1", vendorId: "vendor-1", role: memberRole, status: "active", createdAt: new Date("2026-01-01T00:00:00.000Z"), vendor: { id: "vendor-1", name: "商家一", tracking: null } }]
    : [];
  return {
    id: "session-1",
    vendorId: memberships[0]?.vendorId ?? null,
    revokedAt: null,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    mfaVerifiedAt,
    vendor: memberships[0]?.vendor ?? null,
    user: { id: memberRole ? "merchant-user" : "admin-1", status: "active", platformRole, memberships, mfaFactor, recoveryCodes: [] },
  };
}

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ email: "  New.Merchant@Example.test ", note: "介紹人：小明", ...values })) data.set(key, value);
  return data;
}

const idle = { status: "idle" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "synthetic-merchant-invitation-secret-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  mocks.security.mockResolvedValue(undefined);
  mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin" }));
  mocks.findUser.mockResolvedValue(null);
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("createMerchantInvitationAction", () => {
  it("returns a signed link for the normalised email and audits who invited whom without the token", async () => {
    const state = await createMerchantInvitationAction(idle, form());
    expect(state.status).toBe("created");
    if (state.status !== "created") throw new Error("expected created");
    expect(state.email).toBe("new.merchant@example.test");
    const url = new URL(state.link);
    expect(url.origin).toBe("https://app.example.test");
    expect(url.pathname).toBe("/register");
    const token = url.searchParams.get("invite")!;
    const invite = verifyMerchantRegistrationInvite(token);
    expect(invite).toMatchObject({ email: "new.merchant@example.test" });
    expect(state.expiresAt).toBe(invite!.expiresAt.toISOString());

    expect(mocks.findUser).toHaveBeenCalledWith({ where: { email: "new.merchant@example.test" }, select: { id: true } });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: null,
      actorId: "admin-1",
      actorLabel: "platform_admin",
      action: "merchant_registration_invite_created",
      targetType: "MerchantRegistrationInvite",
      targetId: invite!.jti,
      after: { email: "new.merchant@example.test", expiresAt: invite!.expiresAt.toISOString(), note: "介紹人：小明" },
      userAgent: "synthetic-agent",
    }) });
    const audited = JSON.stringify(mocks.auditCreate.mock.calls);
    expect(audited).not.toContain(token);
    expect(audited).not.toContain(token.split(".")[2]);
  });

  it("omits an empty note from the audit entry", async () => {
    await createMerchantInvitationAction(idle, form({ note: "   " }));
    expect(mocks.auditCreate.mock.calls[0]![0].data.after).toEqual({ email: "new.merchant@example.test", expiresAt: expect.any(String) });
  });

  it.each(["owner", "admin", "accountant"])("rejects a merchant %s before reading input or signing", async (memberRole) => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));
    await expect(createMerchantInvitationAction(idle, form())).rejects.toThrow("redirect:/dashboard");
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("rejects a signed-out visitor and a non-admin without a membership", async () => {
    mocks.findSession.mockResolvedValue(null);
    await expect(createMerchantInvitationAction(idle, form())).rejects.toThrow("redirect:/login");
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none" }));
    await expect(createMerchantInvitationAction(idle, form())).rejects.toThrow("redirect:/dashboard");
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("requires a platform admin to have a verified MFA factor", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin", mfaFactor: null }));
    await expect(createMerchantInvitationAction(idle, form())).rejects.toThrow("redirect:/mfa/setup");
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin", mfaVerifiedAt: null }));
    await expect(createMerchantInvitationAction(idle, form())).rejects.toThrow("redirect:/mfa/verify");
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("checks CSRF before the admin guard", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(createMerchantInvitationAction(idle, form())).rejects.toThrow("csrf");
    expect(mocks.findSession).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ email: "not-an-email" }, { email: "" }, { email: `${"a".repeat(320)}@example.test` }, { note: "x".repeat(201) }])("rejects invalid input %j without signing", async (values) => {
    const state = await createMerchantInvitationAction(idle, form(values));
    expect(state).toEqual({ status: "error", message: "請輸入有效的 Email；備註最多 200 字。" });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("does not invite an email that already has an account", async () => {
    mocks.findUser.mockResolvedValue({ id: "user-9" });
    const state = await createMerchantInvitationAction(idle, form());
    expect(state).toEqual({ status: "error", message: "這個 Email 已經有帳號，請對方直接登入，不需要邀請連結。" });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("returns no link when the audit entry cannot be stored", async () => {
    mocks.auditCreate.mockRejectedValue(new Error("synthetic audit failure"));
    const state = await createMerchantInvitationAction(idle, form());
    expect(state).toEqual({ status: "error", message: "無法寫入稽核紀錄，未產生邀請連結，請稍後再試。" });
  });

  it("returns no link when the signing secret is missing", async () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");
    const state = await createMerchantInvitationAction(idle, form());
    expect(state).toEqual({ status: "error", message: "伺服器的簽章密鑰或公開網址尚未設定，暫時無法產生邀請連結。" });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
