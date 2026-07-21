"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { assertTeamFunnelAccess, requireTeamFunnelActor, TeamFunnelAccessDeniedError, type TeamFunnelField, type TeamFunnelMembership } from "@/lib/team-funnel-access";
import { upsertTeamFunnelPartnerProductSlotOverride, type TeamFunnelProductSlotKey } from "@/lib/team-funnel-product-slots";
import { claimTeamFunnelShare, TeamFunnelShareConflictError, TeamFunnelShareUnavailableError, type TeamFunnelCopyMode } from "@/lib/team-funnel-sharing";

export type PartnerPageActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

type EditableField = "HEADLINE" | "SUBHEADLINE" | "BODY" | "CTA_LABEL" | "CTA_URL";
const slotKeys = ["main_product", "bundle_product", "join_member", "consultation"] as const;

function value(formData: FormData, key: string) {
  const item = formData.get(key);
  return typeof item === "string" ? item.trim() : "";
}

function nullableValue(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function validSlug(slug: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function actionError(error: unknown): PartnerPageActionState {
  if (error instanceof TeamFunnelShareUnavailableError) return { status: "error", message: "此分享連結已過期、已停用，或不屬於你的團隊。" };
  if (error instanceof TeamFunnelShareConflictError) return { status: "error", message: "此模板目前不能以選擇的方式取得。" };
  if (error instanceof TeamFunnelAccessDeniedError) return { status: "error", message: "你沒有存取這個夥伴頁的權限，或它已不再可用。" };
  if (error instanceof Error && error.message === "Invalid CSRF token.") return { status: "error", message: "安全驗證已失效，請重新整理頁面後再送出。" };
  return { status: "error", message: "操作未完成，請檢查資料後再試一次。" };
}

/** Claims through the established share service; it also converges duplicate claims to the existing B page. */
export async function claimTeamTemplateAction(
  _previousState: PartnerPageActionState,
  formData: FormData,
): Promise<PartnerPageActionState> {
  let redirectTo: string;
  try {
    await assertServerActionSecurity(formData);
    const teamId = value(formData, "teamId");
    const shareCode = value(formData, "shareCode");
    const mode = value(formData, "mode") as TeamFunnelCopyMode;
    const slug = value(formData, "slug");
    if (!teamId || !shareCode || !["QUICK_APPLY", "COPY_THEN_EDIT", "BLANK_PAGE_BOUND_TO_A_WEBINAR"].includes(mode) || !validSlug(slug)) {
      return { status: "error", message: "請選擇取得模式，並填入小寫英數與連字號組成的網址。" };
    }
    if (value(formData, "confirmed") !== "yes") return { status: "error", message: "請先確認建立自己的夥伴頁。" };

    const result = await claimTeamFunnelShare({ teamId, shareCode, mode, slug });
    redirectTo = `/partner-pages/${result.page.id}/edit`;
    revalidatePath("/partner-pages");
  } catch (error) {
    return actionError(error);
  }

  redirect(redirectTo);
}

async function accessFacts(actor: TeamFunnelMembership) {
  const db = getDb();
  const [memberships, relationships] = await Promise.all([
    db.teamMembership.findMany({
      where: { vendorId: actor.vendorId, teamId: actor.teamId },
      select: { id: true, vendorId: true, teamId: true, vendorMemberId: true, status: true, leftAt: true, vendorMember: { select: { userId: true, status: true, deactivatedAt: true } } },
    }),
    db.teamMembershipRelationship.findMany({
      where: { teamId: actor.teamId },
      select: { teamId: true, uplineMembershipId: true, downlineMembershipId: true, effectiveAt: true, endedAt: true },
    }),
  ]);
  return {
    memberships: memberships.map((member) => ({ ...member, userId: member.vendorMember.userId, vendorMemberStatus: member.vendorMember.status, vendorMemberDeactivatedAt: member.vendorMember.deactivatedAt })),
    relationships,
  };
}

async function loadOwnedPage(teamId: string, pageId: string) {
  const actor = await requireTeamFunnelActor(teamId);
  const page = await getDb().partnerFunnelPage.findFirst({
    // Do not rely on an editable field to prove ownership: a page with every
    // field locked must still be inaccessible to a different promoter.
    where: { id: pageId, vendorId: actor.vendorId, teamId: actor.teamId, promoterMembershipId: actor.id },
    include: { templateVersion: { include: { fieldLocks: { select: { field: true } }, productSlots: { select: { slotKey: true } } } } },
  });
  if (!page) throw new TeamFunnelAccessDeniedError("missing_resource");
  return { actor, page, facts: await accessFacts(actor) };
}

function assertPageField(
  actor: TeamFunnelMembership,
  page: Awaited<ReturnType<typeof loadOwnedPage>>["page"],
  facts: Awaited<ReturnType<typeof accessFacts>>,
  field: TeamFunnelField,
) {
  assertTeamFunnelAccess({
    action: "edit",
    actor,
    resource: {
      id: page.id, kind: "page", vendorId: page.vendorId, teamId: page.teamId,
      promoterMembershipId: page.promoterMembershipId, contentOwnerMembershipId: page.contentOwnerMembershipId,
      lockedFields: page.templateVersion.fieldLocks.map((lock) => lock.field as TeamFunnelField),
    },
    field,
    ...facts,
  });
}

/** Saves only fields allowed by A's immutable field-lock contract, then delegates slot writes to the existing slot service. */
export async function savePartnerPageAction(
  _previousState: PartnerPageActionState,
  formData: FormData,
): Promise<PartnerPageActionState> {
  try {
    await assertServerActionSecurity(formData);
    const teamId = value(formData, "teamId");
    const pageId = value(formData, "pageId");
    if (!teamId || !pageId) return { status: "error", message: "找不到要儲存的夥伴頁。" };
    const { actor, page, facts } = await loadOwnedPage(teamId, pageId);
    const locked = new Set(page.templateVersion.fieldLocks.map((lock) => lock.field));
    const data: Record<string, string | null> = {};
    const mapping: Array<[EditableField, string]> = [
      ["HEADLINE", "headline"], ["SUBHEADLINE", "subheadline"], ["BODY", "body"], ["CTA_LABEL", "ctaLabel"], ["CTA_URL", "ctaUrl"],
    ];

    for (const [field, input] of mapping) {
      if (locked.has(field)) continue;
      assertPageField(actor, page, facts, field);
      data[input] = field === "HEADLINE" || field === "CTA_LABEL" ? value(formData, input) : nullableValue(formData, input);
    }
    if (("headline" in data && !data.headline) || ("ctaLabel" in data && !data.ctaLabel)) {
      return { status: "error", message: "主標題與 CTA 按鈕文字不可留白。" };
    }
    if (typeof data.ctaUrl === "string") {
      try { new URL(data.ctaUrl); } catch { return { status: "error", message: "CTA 連結必須是有效的完整網址。" }; }
    }

    if (Object.keys(data).length) {
      await getDb().partnerFunnelPage.updateMany({ where: { id: page.id, vendorId: actor.vendorId, teamId: actor.teamId, promoterMembershipId: actor.id }, data });
    }

    if (!locked.has("PRODUCT_SLOTS")) {
      assertPageField(actor, page, facts, "PRODUCT_SLOTS");
      const exposed = new Set(page.templateVersion.productSlots.map((slot) => slot.slotKey));
      for (const slotKey of slotKeys) {
        if (!exposed.has(slotKey)) continue;
        const productId = nullableValue(formData, `product_${slotKey}`);
        const overrideUrl = nullableValue(formData, `url_${slotKey}`);
        // Call the scoped slot service even when both values are empty so an
        // editor can intentionally clear a prior partner override.
        await upsertTeamFunnelPartnerProductSlotOverride({ teamId, pageId: page.id, slotKey: slotKey as TeamFunnelProductSlotKey, productId, overrideUrl });
      }
    }
    revalidatePath("/partner-pages");
    revalidatePath(`/partner-pages/${page.id}/edit`);
    revalidatePath(`/p/${page.slug}`);
    return { status: "success", message: "夥伴頁已儲存。" };
  } catch (error) {
    return actionError(error);
  }
}

/** Public visibility is a scoped page setting. The public renderer remains the final fail-closed validator. */
export async function setPartnerPagePublishAction(
  _previousState: PartnerPageActionState,
  formData: FormData,
): Promise<PartnerPageActionState> {
  try {
    await assertServerActionSecurity(formData);
    const teamId = value(formData, "teamId");
    const pageId = value(formData, "pageId");
    const publish = value(formData, "publish") === "true";
    if (!teamId || !pageId) return { status: "error", message: "找不到要更新的公開狀態。" };
    const { actor, page, facts } = await loadOwnedPage(teamId, pageId);
    assertTeamFunnelAccess({
      action: "share", actor,
      resource: { id: page.id, kind: "page", vendorId: page.vendorId, teamId: page.teamId, promoterMembershipId: page.promoterMembershipId, contentOwnerMembershipId: page.contentOwnerMembershipId },
      ...facts,
    });
    await getDb().partnerFunnelPageShareSetting.upsert({
      where: { pageId: page.id },
      create: { pageId: page.id, accessMode: publish ? "PUBLIC" : "DISABLED", isEnabled: publish },
      update: { accessMode: publish ? "PUBLIC" : "DISABLED", isEnabled: publish },
    });
    revalidatePath("/partner-pages");
    revalidatePath(`/partner-pages/${page.id}/edit`);
    revalidatePath(`/p/${page.slug}`);
    return { status: "success", message: publish ? "夥伴頁已發布。" : "夥伴頁已停止公開。" };
  } catch (error) {
    return actionError(error);
  }
}
