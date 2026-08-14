"use server";

import { revalidatePath } from "next/cache";
import { assertServerActionSecurity } from "@/lib/csrf";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireAuth, requireVendor } from "@/lib/auth";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  createTeamFunnelLiveShare,
  disableTeamFunnelLiveShare,
  TeamFunnelLiveShareConflictError,
  TeamFunnelLiveShareUnavailableError,
} from "@/lib/team-funnel-live-sharing";

export type TeamLiveShareActionState = {
  status: "idle" | "success" | "error";
  message: string;
  shareUrl?: string;
  pageId?: string;
  promoterMembershipId?: string;
};

export const initialTeamLiveShareActionState: TeamLiveShareActionState = {
  status: "idle",
  message: "",
};

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function actionError(error: unknown): TeamLiveShareActionState {
  if (error instanceof TeamFunnelAccessDeniedError) {
    return { status: "error", message: "你沒有管理這個 Live 分享的權限，或來源頁已不存在。" };
  }
  if (error instanceof TeamFunnelLiveShareUnavailableError) {
    return { status: "error", message: "這個 Live 分享已不存在、過期或已停用。" };
  }
  if (error instanceof TeamFunnelLiveShareConflictError) {
    return { status: "error", message: "這個 Live 目前不能分享，請確認頁面 owner、直播狀態與上下線關係。" };
  }
  if (error instanceof Error && error.message === "Invalid CSRF token.") {
    return { status: "error", message: "安全驗證已失效，請重新整理頁面後再送出。" };
  }
  return { status: "error", message: "操作未完成，請重新整理後再試一次。" };
}

async function actorContext() {
  const [auth, vendor] = await Promise.all([requireAuth(), requireVendor()]);
  return { auth, vendor };
}

export async function createTeamLiveShareAction(
  _previousState: TeamLiveShareActionState,
  formData: FormData,
): Promise<TeamLiveShareActionState> {
  try {
    await assertServerActionSecurity(formData);
    const teamId = value(formData, "teamId");
    const pageId = value(formData, "pageId");
    const promoterMembershipId = value(formData, "promoterMembershipId");
    if (!teamId || !pageId || !promoterMembershipId) {
      return { status: "error", message: "找不到要分享的 Live 或目標夥伴。" };
    }

    const { auth, vendor } = await actorContext();
    const result = await createTeamFunnelLiveShare({ teamId, pageId, promoterMembershipId });
    await writeAuditLog({
      vendorId: vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? "member",
      action: "create_team_live_share",
      targetType: "PartnerLiveShare",
      targetId: result.share.id,
      after: auditSnapshot({ teamId, pageId, liveId: result.share.liveId, promoterMembershipId, expiresAt: result.share.expiresAt }),
    });
    revalidatePath("/partner-pages");
    return {
      status: "success",
      message: "Live 分享連結已建立；請在這次畫面中複製，之後不會再次顯示完整 token。",
      shareUrl: result.shareUrl,
      pageId,
      promoterMembershipId,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function disableTeamLiveShareAction(
  _previousState: TeamLiveShareActionState,
  formData: FormData,
): Promise<TeamLiveShareActionState> {
  try {
    await assertServerActionSecurity(formData);
    const teamId = value(formData, "teamId");
    const pageId = value(formData, "pageId");
    const promoterMembershipId = value(formData, "promoterMembershipId");
    if (!teamId || !pageId || !promoterMembershipId) {
      return { status: "error", message: "找不到要停用的 Live 分享。" };
    }

    const { auth, vendor } = await actorContext();
    const result = await disableTeamFunnelLiveShare({ teamId, pageId, promoterMembershipId });
    await writeAuditLog({
      vendorId: vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? "member",
      action: "disable_team_live_share",
      targetType: "PartnerLiveShare",
      after: auditSnapshot({ teamId, pageId, liveId: result.liveId, promoterMembershipId, isEnabled: false }),
    });
    revalidatePath("/partner-pages");
    return { status: "success", message: "Live 分享已停用。", pageId, promoterMembershipId };
  } catch (error) {
    return actionError(error);
  }
}
