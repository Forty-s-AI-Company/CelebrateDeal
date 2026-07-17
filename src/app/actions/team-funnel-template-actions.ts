"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireVendor } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  createTeamFunnelOriginalPage,
  publishTeamFunnelTemplateVersion,
  TeamFunnelConflictError,
  type TeamFunnelPageContent,
  type TeamFunnelPageField,
} from "@/lib/team-funnel-pages";
import {
  createTeamFunnelTemplateProductSlot,
  TeamFunnelProductSlotConflictError,
  type TeamFunnelProductSlotKey,
} from "@/lib/team-funnel-product-slots";
import {
  createTeamFunnelShare,
  disableTeamFunnelShare,
  TeamFunnelShareConflictError,
} from "@/lib/team-funnel-sharing";

const fields = ["HEADLINE", "SUBHEADLINE", "BODY", "CTA_LABEL", "CTA_URL", "PRODUCT_SLOTS"] as const;
const slotKeys = ["main_product", "bundle_product", "join_member", "consultation"] as const;

type TeamTemplateActionState = {
  status: "idle" | "success" | "error";
  message: string;
  shareUrl?: string;
  sharePageId?: string;
};

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw || null;
}

function isSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function contentFrom(formData: FormData): TeamFunnelPageContent {
  return {
    headline: value(formData, "headline"),
    subheadline: optionalValue(formData, "subheadline"),
    body: optionalValue(formData, "body"),
    ctaLabel: value(formData, "ctaLabel"),
    ctaUrl: optionalValue(formData, "ctaUrl"),
  };
}

function validationMessage(formData: FormData, content: TeamFunnelPageContent) {
  if (!value(formData, "teamId")) return "請選擇團隊後再繼續。";
  if (!content.headline || !content.ctaLabel) return "請填寫標題與 CTA 按鈕文字。";
  if (content.ctaUrl) {
    try {
      new URL(content.ctaUrl);
    } catch {
      return "CTA 連結必須是有效的完整網址。";
    }
  }
  return null;
}

function lockedFields(formData: FormData): TeamFunnelPageField[] {
  return formData.getAll("lockedFields")
    .filter((field): field is TeamFunnelPageField => typeof field === "string" && (fields as readonly string[]).includes(field));
}

async function addSelectedProductSlots(formData: FormData, teamId: string, templateVersionId: string) {
  for (const slotKey of slotKeys) {
    const productId = value(formData, `product_${slotKey}`);
    if (!productId) continue;
    await createTeamFunnelTemplateProductSlot({
      teamId,
      templateVersionId,
      slotKey: slotKey as TeamFunnelProductSlotKey,
      productId,
      offerLabel: optionalValue(formData, `offerLabel_${slotKey}`),
    });
  }
}

/**
 * `liveId` belongs to the source page rather than a template version. The
 * template services intentionally own template/version writes; this scoped
 * lookup only allows the selected team's existing webinar to be attached to
 * that source page.
 */
async function selectedWebinarId(formData: FormData, vendorId: string, teamId: string) {
  const webinarId = optionalValue(formData, "webinarId");
  if (!webinarId) return null;

  const webinar = await getDb().live.findFirst({
    where: { id: webinarId, vendorId, teamId },
    select: { id: true },
  });
  if (!webinar) throw new TeamFunnelAccessDeniedError("missing_resource");
  return webinar.id;
}

async function updateSourcePage({
  pageId,
  vendorId,
  teamId,
  templateId,
  templateVersionId,
  vendorMemberId,
  slug,
  content,
  webinarId,
}: {
  pageId: string;
  vendorId: string;
  teamId: string;
  templateId?: string;
  templateVersionId?: string;
  vendorMemberId: string;
  slug: string;
  content: TeamFunnelPageContent;
  webinarId: string | null;
}) {
  const result = await getDb().partnerFunnelPage.updateMany({
    where: {
      id: pageId,
      vendorId,
      teamId,
      promoter: { vendorMemberId },
      ...(templateId ? { templateVersion: { templateId } } : {}),
    },
    data: {
      ...(templateVersionId ? { templateVersionId } : {}),
      slug,
      liveId: webinarId,
      headline: content.headline,
      subheadline: content.subheadline ?? null,
      body: content.body ?? null,
      ctaLabel: content.ctaLabel,
      ctaUrl: content.ctaUrl ?? null,
    },
  });
  if (result.count !== 1) throw new TeamFunnelAccessDeniedError("missing_resource");
}

function actionError(error: unknown): TeamTemplateActionState {
  if (error instanceof TeamFunnelAccessDeniedError) {
    return { status: "error", message: "你沒有管理這個團隊模板的權限，或該資源已不存在。" };
  }
  if (error instanceof TeamFunnelConflictError || error instanceof TeamFunnelProductSlotConflictError || error instanceof TeamFunnelShareConflictError) {
    return { status: "error", message: "這項設定與既有資料衝突，請更新頁面後再試一次。" };
  }
  if (error instanceof Error && error.message === "Invalid CSRF token.") {
    return { status: "error", message: "安全驗證已失效，請重新整理頁面後再送出。" };
  }
  return { status: "error", message: "儲存失敗，請檢查資料後再試一次。" };
}

/**
 * This action intentionally delegates all writes to the existing team-funnel
 * services. Those services derive the actor from the current session and apply
 * the vendor/team ownership policy again for every operation.
 */
export async function manageTeamFunnelTemplateAction(
  _previousState: TeamTemplateActionState,
  formData: FormData,
): Promise<TeamTemplateActionState> {
  try {
    await assertServerActionSecurity(formData);
    const operation = value(formData, "operation");
    const teamId = value(formData, "teamId");

    if (operation === "create-share") {
      const pageId = value(formData, "pageId");
      if (!teamId || !pageId) return { status: "error", message: "找不到可分享的原始頁。" };
      const { share, shareCode } = await createTeamFunnelShare({ teamId, pageId });
      revalidatePath("/team-templates");
      return {
        status: "success",
        message: "分享連結已建立。此連結只會在這次操作後顯示，請立即複製保存。",
        // `/team-template` is the authenticated claim route. Keeping this
        // route here prevents a generated URL from landing back on the list.
        shareUrl: `/team-template?share=${encodeURIComponent(shareCode)}`,
        sharePageId: share.pageId,
      };
    }

    if (operation === "disable-share") {
      const pageId = value(formData, "pageId");
      if (!teamId || !pageId) return { status: "error", message: "找不到要停用的分享連結。" };
      await disableTeamFunnelShare({ teamId, pageId });
      revalidatePath("/team-templates");
      return { status: "success", message: "分享連結已停用，夥伴之後無法再使用它。" };
    }

    const content = contentFrom(formData);
    const validationError = validationMessage(formData, content);
    if (validationError) return { status: "error", message: validationError };
    if (!isSlug(value(formData, "slug"))) return { status: "error", message: "原始頁網址只能使用小寫英數與連字號。" };

    const [vendor, auth] = await Promise.all([requireVendor(), requireAuth()]);
    if (!auth.member) return { status: "error", message: "你沒有管理這個團隊模板的權限，或該資源已不存在。" };
    const webinarId = await selectedWebinarId(formData, vendor.id, teamId);

    if (operation === "create") {
      const name = value(formData, "name");
      if (!name) return { status: "error", message: "請填寫模板名稱。" };
      const result = await createTeamFunnelOriginalPage({
        teamId,
        name,
        slug: value(formData, "slug"),
        content,
        lockedFields: lockedFields(formData),
      });
      await addSelectedProductSlots(formData, teamId, result.version.id);
      await updateSourcePage({
        pageId: result.page.id,
        vendorId: vendor.id,
        teamId,
        vendorMemberId: auth.member.id,
        slug: value(formData, "slug"),
        content,
        webinarId,
      });
      revalidatePath("/team-templates");
      return { status: "success", message: "原始頁與第一個模板版本已建立。" };
    }

    if (operation === "publish") {
      const templateId = value(formData, "templateId");
      const sourcePageId = value(formData, "sourcePageId");
      if (!templateId) return { status: "error", message: "找不到要發布的模板。" };
      if (!sourcePageId) return { status: "error", message: "找不到可更新的原始頁，請返回模板列表後重試。" };
      const result = await publishTeamFunnelTemplateVersion({
        teamId,
        templateId,
        content,
        lockedFields: lockedFields(formData),
      });
      await addSelectedProductSlots(formData, teamId, result.version.id);
      await updateSourcePage({
        pageId: sourcePageId,
        vendorId: vendor.id,
        teamId,
        templateId,
        templateVersionId: result.version.id,
        vendorMemberId: auth.member.id,
        slug: value(formData, "slug"),
        content,
        webinarId,
      });
      revalidatePath("/team-templates");
      return { status: "success", message: `版本 v${result.version.version} 已發布。既有夥伴副本不會被覆寫。` };
    }

    return { status: "error", message: "不支援的模板操作。" };
  } catch (error) {
    return actionError(error);
  }
}
