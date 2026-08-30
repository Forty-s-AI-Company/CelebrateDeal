import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireAuth: vi.fn(),
  requireVendor: vi.fn(),
  createTeamFunnelLiveShare: vi.fn(),
  disableTeamFunnelLiveShare: vi.fn(),
  auditSnapshot: vi.fn((value: unknown) => value),
  writeAuditLog: vi.fn(),
  revalidatePath: vi.fn(),
  TeamFunnelAccessDeniedError: class TeamFunnelAccessDeniedError extends Error {},
  TeamFunnelLiveShareConflictError: class TeamFunnelLiveShareConflictError extends Error {},
  TeamFunnelLiveShareUnavailableError: class TeamFunnelLiveShareUnavailableError extends Error {},
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireVendor: mocks.requireVendor }));
vi.mock("@/lib/team-funnel-live-sharing", () => ({
  createTeamFunnelLiveShare: mocks.createTeamFunnelLiveShare,
  disableTeamFunnelLiveShare: mocks.disableTeamFunnelLiveShare,
  TeamFunnelLiveShareConflictError: mocks.TeamFunnelLiveShareConflictError,
  TeamFunnelLiveShareUnavailableError: mocks.TeamFunnelLiveShareUnavailableError,
}));
vi.mock("@/lib/team-funnel-access", () => ({ TeamFunnelAccessDeniedError: mocks.TeamFunnelAccessDeniedError }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: mocks.auditSnapshot, writeAuditLog: mocks.writeAuditLog }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createTeamLiveShareAction, disableTeamLiveShareAction } from "./team-funnel-live-share-actions";

function formData(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ user: { id: "user-a" }, member: { role: "member" } });
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("team Live share server actions", () => {
  it("creates a share, audits only bounded identifiers, and returns one-time URL state", async () => {
    mocks.createTeamFunnelLiveShare.mockResolvedValue({
      share: { id: "share-1", liveId: "live-1", expiresAt: null },
      shareUrl: "/live/summer?share=tls1.synthetic-token",
    });

    const result = await createTeamLiveShareAction({ status: "idle", message: "" }, formData({
      _csrf: "csrf",
      teamId: "team-1",
      pageId: "page-1",
      promoterMembershipId: "membership-b",
    }));

    expect(result).toEqual({
      status: "success",
      message: "Live 分享連結已建立；請在這次畫面中複製，之後不會再次顯示完整 token。",
      shareUrl: "/live/summer?share=tls1.synthetic-token",
      pageId: "page-1",
      promoterMembershipId: "membership-b",
    });
    expect(mocks.createTeamFunnelLiveShare).toHaveBeenCalledWith({ teamId: "team-1", pageId: "page-1", promoterMembershipId: "membership-b" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "create_team_live_share",
      targetId: "share-1",
      after: { teamId: "team-1", pageId: "page-1", liveId: "live-1", promoterMembershipId: "membership-b", expiresAt: null },
    }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0])).not.toContain("tls1.synthetic-token");
  });

  it("rejects incomplete payload before domain access", async () => {
    const result = await createTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: "team-1" }));

    expect(result).toEqual({ status: "error", message: "找不到要分享的 Live 或目標夥伴。" });
    expect(mocks.createTeamFunnelLiveShare).not.toHaveBeenCalled();
    expect(mocks.requireAuth).not.toHaveBeenCalled();

    const nonString = new FormData();
    nonString.set("_csrf", "csrf");
    nonString.set("teamId", "team-1");
    nonString.set("pageId", new Blob(["page-1"]));
    nonString.set("promoterMembershipId", "membership-b");
    const nonStringResult = await createTeamLiveShareAction({ status: "idle", message: "" }, nonString);
    expect(nonStringResult).toEqual({ status: "error", message: "找不到要分享的 Live 或目標夥伴。" });
  });

  it("maps domain conflict and records disable audit without exposing internal errors", async () => {
    const conflict = new Error("conflict");
    mocks.createTeamFunnelLiveShare.mockRejectedValue(conflict);
    const failed = await createTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: "team-1", pageId: "page-1", promoterMembershipId: "membership-b" }));
    expect(failed).toEqual({ status: "error", message: "操作未完成，請重新整理後再試一次。" });

    mocks.createTeamFunnelLiveShare.mockResolvedValue({ share: { id: "share-1", liveId: "live-1", expiresAt: null }, shareUrl: "/live/summer?share=tls1.new" });
    mocks.disableTeamFunnelLiveShare.mockResolvedValue({ liveId: "live-1", pageId: "page-1", promoterMembershipId: "membership-b", isEnabled: false });
    const disabled = await disableTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: "team-1", pageId: "page-1", promoterMembershipId: "membership-b" }));

    expect(disabled).toEqual({ status: "success", message: "Live 分享已停用。", pageId: "page-1", promoterMembershipId: "membership-b" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "disable_team_live_share", targetType: "PartnerLiveShare" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/partner-pages");
  });

  it("maps every bounded domain and security error without leaking internals", async () => {
    const validForm = formData({ _csrf: "csrf", teamId: "team-1", pageId: "page-1", promoterMembershipId: "membership-b" });
    const expected = [
      [new mocks.TeamFunnelAccessDeniedError("cross-tenant"), "你沒有管理這個 Live 分享的權限，或來源頁已不存在。"],
      [new mocks.TeamFunnelLiveShareUnavailableError("expired"), "這個 Live 分享已不存在、過期或已停用。"],
      [new mocks.TeamFunnelLiveShareConflictError("owner mismatch"), "這個 Live 目前不能分享，請確認頁面 owner、直播狀態與上下線關係。"],
      [new Error("Invalid CSRF token."), "安全驗證已失效，請重新整理頁面後再送出。"],
    ] as const;

    for (const [error, message] of expected) {
      mocks.createTeamFunnelLiveShare.mockRejectedValueOnce(error);
      await expect(createTeamLiveShareAction({ status: "idle", message: "" }, validForm)).resolves.toEqual({ status: "error", message });
    }
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects incomplete disable payload before authentication and maps unavailable disable", async () => {
    const incomplete = await disableTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: "team-1", pageId: "page-1" }));
    expect(incomplete).toEqual({ status: "error", message: "找不到要停用的 Live 分享。" });
    expect(mocks.disableTeamFunnelLiveShare).not.toHaveBeenCalled();
    expect(mocks.requireAuth).not.toHaveBeenCalled();

    mocks.disableTeamFunnelLiveShare.mockRejectedValueOnce(new mocks.TeamFunnelLiveShareUnavailableError("expired"));
    const unavailable = await disableTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: "team-1", pageId: "page-1", promoterMembershipId: "membership-b" }));
    expect(unavailable).toEqual({ status: "error", message: "這個 Live 分享已不存在、過期或已停用。" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("trims form values and fails closed when audit or revalidation fails", async () => {
    mocks.createTeamFunnelLiveShare.mockResolvedValue({
      share: { id: "share-2", liveId: "live-2", expiresAt: "2030-01-01T00:00:00.000Z" },
      shareUrl: "/live/winter?share=tls1.audit-boundary",
    });
    mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit storage unavailable"));
    const auditFailure = await createTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: " team-2 ", pageId: " page-2 ", promoterMembershipId: " membership-c " }));
    expect(auditFailure).toEqual({ status: "error", message: "操作未完成，請重新整理後再試一次。" });
    expect(mocks.createTeamFunnelLiveShare).toHaveBeenCalledWith({ teamId: "team-2", pageId: "page-2", promoterMembershipId: "membership-c" });

    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("revalidation unavailable"); });
    const revalidationFailure = await disableTeamLiveShareAction({ status: "idle", message: "" }, formData({ _csrf: "csrf", teamId: " team-2 ", pageId: " page-2 ", promoterMembershipId: " membership-c " }));
    expect(revalidationFailure).toEqual({ status: "error", message: "操作未完成，請重新整理後再試一次。" });
  });
});
