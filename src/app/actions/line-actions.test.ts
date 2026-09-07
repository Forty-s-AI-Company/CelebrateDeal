import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorOwner: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  writeAuditLog: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ lineOfficialAccount: { upsert: mocks.upsert, findUnique: mocks.findUnique, update: mocks.update } }) }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveLineOfficialAccountAction, testLineOfficialAccountAction } from "@/app/actions/line-actions";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";

function credentialsForm() {
  const form = new FormData();
  form.set("_csrf", "valid");
  form.set("messagingChannelId", "2000123456");
  form.set("messagingChannelSecret", "messaging-secret-1234567890");
  form.set("messagingAccessToken", "access-token-with-at-least-thirty-two-characters");
  form.set("loginChannelId", "2000654321");
  form.set("loginChannelSecret", "login-secret-1234567890");
  return form;
}

describe("saveLineOfficialAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CSRF_SECRET", "line-action-test-secret-that-is-at-least-32-bytes");
    mocks.requireVendorOwner.mockResolvedValue({
      vendor: { id: "vendor-1" },
      user: { id: "user-1" },
      member: { role: "owner" },
    });
    mocks.upsert.mockResolvedValue({ id: "line-account-1", status: "active", connectedAt: new Date("2026-09-05T00:00:00Z") });
    mocks.findUnique.mockResolvedValue(null);
    mocks.update.mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires CSRF and owner authorization before saving only encrypted values", async () => {
    await expect(saveLineOfficialAccountAction({ status: "idle", error: null }, credentialsForm()))
      .resolves.toEqual({ status: "saved", error: null });

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    const payload = mocks.upsert.mock.calls[0]?.[0];
    expect(payload.create.messagingChannelIdEncrypted).toMatch(/^v1\./u);
    expect(JSON.stringify(payload)).not.toContain("messaging-secret-1234567890");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "save_line_official_account",
      after: expect.objectContaining({ messagingConfigured: true, loginConfigured: true }),
    }));
  });

  it("rejects incomplete LINE Login credentials without touching the database", async () => {
    const form = credentialsForm();
    form.set("loginChannelSecret", "");
    await expect(saveLineOfficialAccountAction({ status: "idle", error: null }, form))
      .resolves.toEqual({ status: "error", error: "invalid_credentials" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("tests the tenant-owned bot connection without returning credentials", async () => {
    const protectedCredentials = protectLineOfficialAccountCredentials("vendor-1", {
      messagingChannelId: "2000123456",
      messagingChannelSecret: "messaging-secret-1234567890",
      messagingAccessToken: "access-token-with-at-least-thirty-two-characters",
      loginChannelId: null,
      loginChannelSecret: null,
    });
    mocks.findUnique.mockResolvedValue({
      id: "line-account-1",
      ...protectedCredentials,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      userId: "bot-user-id",
      displayName: "CelebrateDeal 官方帳號",
      pictureUrl: "https://profile.example.test/bot.png",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testLineOfficialAccountAction({ status: "idle", error: null, bot: null }, credentialsForm());

    expect(result).toEqual({
      status: "validated",
      error: null,
      bot: { displayName: "CelebrateDeal 官方帳號", pictureUrl: "https://profile.example.test/bot.png" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.line.me/v2/bot/info", expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer access-token-with-at-least-thirty-two-characters" },
    }));
    expect(mocks.update).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1" },
      data: { lastValidatedAt: expect.any(Date) },
    });
    expect(JSON.stringify(result)).not.toContain("access-token-with-at-least-thirty-two-characters");
  });

  it("does not call LINE when the tenant has no configured account", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(testLineOfficialAccountAction({ status: "idle", error: null, bot: null }, credentialsForm()))
      .resolves.toEqual({ status: "error", error: "not_configured", bot: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
