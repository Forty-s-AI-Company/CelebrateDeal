"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { BlacklistIdentifierType, normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import { normalizeInteractionEventDraft } from "@/lib/interaction-event";
import {
  INTERACTION_ROLE_AVATAR_MODES,
  isCanonicalInteractionRolePresetUrl,
  normalizeInteractionRoleDraft,
  parseInteractionRoleBoolean,
  type InteractionRoleAvatarMode,
  type NormalizedInteractionRole,
} from "@/lib/interaction-role";
import type { InteractionRoleActionState, InteractionRoleFormValues } from "@/lib/interaction-role-action-state";
import { parseInteractionTriggerSeconds } from "@/lib/interaction-timeline";
import { isEligibleScheduledRole } from "@/lib/live-chat-contract";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function managerAuditIdentity(auth: Awaited<ReturnType<typeof requireVendorManagerContext>>["auth"]) {
  return {
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? "vendor_manager",
  };
}

function isRecordNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

class InteractionScriptInvalidEventError extends Error {}
class InteractionScriptReferenceError extends Error {}
class InteractionScriptMissingError extends Error {}
class InteractionScriptDuplicateSourceMissingError extends Error {}

function isInteractionScriptWriteConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2002" || error.code === "P2034");
}

class InteractionRoleInputError extends Error {}
class InteractionRoleMissingError extends Error {}

function boundedInteractionRoleValue(formData: FormData, key: string, maximum: number) {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function submittedInteractionRoleMode(formData: FormData): string {
  const avatarMode = text(formData, "avatarMode");
  const legacyMode = text(formData, "mode");
  if (avatarMode && legacyMode && avatarMode !== legacyMode) {
    throw new InteractionRoleInputError("頭像模式無效。");
  }
  return avatarMode || legacyMode;
}

function submittedInteractionRoleUploadPhase(formData: FormData) {
  const value = formData.get("avatarUploadPhase");
  return value === null ? "" : typeof value === "string" ? value.trim() : "__invalid__";
}

function submittedInteractionRoleValues(formData: FormData): InteractionRoleFormValues {
  const rawAvatarUrl = boundedInteractionRoleValue(formData, "avatarUrl", 2_048).trim();
  const avatarUrl = parseSafeExternalHttpUrl(rawAvatarUrl) ?? "";
  const avatarMode = text(formData, "avatarMode");
  const legacyMode = text(formData, "mode");
  const mode = avatarMode && legacyMode && avatarMode !== legacyMode ? "" : avatarMode || legacyMode;
  return {
    id: boundedInteractionRoleValue(formData, "id", 128),
    name: boundedInteractionRoleValue(formData, "name", 160),
    avatarUrl,
    avatarAssetId: boundedInteractionRoleValue(formData, "avatarAssetId", 128),
    avatarMode: (INTERACTION_ROLE_AVATAR_MODES as readonly string[]).includes(mode)
      ? mode as InteractionRoleAvatarMode
      : "",
    avatarUploadPhase: boundedInteractionRoleValue(formData, "avatarUploadPhase", 32),
    label: boundedInteractionRoleValue(formData, "label", 80),
    roleType: boundedInteractionRoleValue(formData, "roleType", 64),
    tone: boundedInteractionRoleValue(formData, "tone", 500),
    isActive: parseInteractionRoleBoolean(formData.get("isActive")),
    isScheduled: parseInteractionRoleBoolean(formData.get("isScheduled")),
  };
}

async function resolveInteractionRoleAvatar(vendorId: string, formData: FormData) {
  const rawAvatarUrl = optionalText(formData, "avatarUrl") ?? "";
  const avatarModeValue = submittedInteractionRoleMode(formData);
  const avatarUploadPhase = submittedInteractionRoleUploadPhase(formData);
  const hasExplicitMode = avatarModeValue !== "";
  const avatarAssetIdValue = formData.get("avatarAssetId");
  if (avatarAssetIdValue !== null && typeof avatarAssetIdValue !== "string") {
    throw new InteractionRoleInputError("角色頭像圖片資產無效，請重新上傳。");
  }
  const avatarAssetId = typeof avatarAssetIdValue === "string" ? avatarAssetIdValue.trim() || null : null;

  if (hasExplicitMode && !(INTERACTION_ROLE_AVATAR_MODES as readonly string[]).includes(avatarModeValue)) {
    throw new InteractionRoleInputError("頭像模式無效。");
  }
  const avatarMode = hasExplicitMode ? avatarModeValue as InteractionRoleAvatarMode : null;

  if (avatarMode === "preset") {
    if (avatarAssetId || (avatarUploadPhase && avatarUploadPhase !== "idle")) {
      throw new InteractionRoleInputError("預設頭像模式無效。");
    }
    if (!isCanonicalInteractionRolePresetUrl(rawAvatarUrl)) {
      throw new InteractionRoleInputError("預設頭像不受支援。");
    }
    return rawAvatarUrl;
  }

  if (avatarMode === "custom" || avatarAssetId) {
    if (!(["", "idle", "success"] as const).includes(avatarUploadPhase as "" | "idle" | "success")) {
      throw new InteractionRoleInputError("自訂頭像上傳狀態無效。");
    }
    if (avatarAssetId) {
      if (avatarUploadPhase !== "success") {
        throw new InteractionRoleInputError("自訂頭像上傳尚未完成。");
      }
      let asset;
      try {
        asset = await resolveReadyImageAsset(getDb(), { vendorId, assetId: avatarAssetId });
      } catch (error) {
        if (error instanceof ImageAssetReferenceError) {
          throw new InteractionRoleInputError("角色頭像圖片資產無效，請重新上傳。");
        }
        throw error;
      }
      return asset?.publicUrl ?? null;
    }
    if (avatarUploadPhase === "success") {
      throw new InteractionRoleInputError("自訂頭像上傳尚未完成。");
    }
  }

  const safeAvatarUrl = rawAvatarUrl ? parseSafeExternalHttpUrl(rawAvatarUrl) : null;
  if (rawAvatarUrl && !safeAvatarUrl) throw new InteractionRoleInputError("角色頭像必須是安全的 HTTP 或 HTTPS 完整網址。");
  return safeAvatarUrl;
}

async function persistInteractionRole(input: {
  vendorId: string;
  id: string | null;
  data: NormalizedInteractionRole;
}) {
  try {
    return input.id
      ? await getDb().interactionRole.update({ where: { id: input.id, vendorId: input.vendorId }, data: input.data })
      : await getDb().interactionRole.create({ data: { ...input.data, vendorId: input.vendorId } });
  } catch (error) {
    if (isRecordNotFoundError(error)) throw new InteractionRoleMissingError();
    throw error;
  }
}

function interactionRoleAuditData(data: {
  roleType: string;
  isActive: boolean;
  isScheduled: boolean;
  avatarUrl: string | null;
}) {
  return auditSnapshot({
    roleType: data.roleType,
    isActive: data.isActive,
    isScheduled: data.isScheduled,
    hasAvatar: Boolean(data.avatarUrl),
  });
}

async function persistAndAuditInteractionRole(input: {
  vendorId: string;
  auth: Awaited<ReturnType<typeof requireVendorManagerContext>>["auth"];
  id: string | null;
  data: NormalizedInteractionRole;
}) {
  const role = await persistInteractionRole(input);
  await writeAuditLog({
    vendorId: input.vendorId,
    ...managerAuditIdentity(input.auth),
    action: input.id ? "interaction_role_updated" : "interaction_role_created",
    targetType: "InteractionRole",
    targetId: role.id,
    after: interactionRoleAuditData(input.data),
  });
  return role;
}

async function normalizedInteractionRoleData(vendorId: string, formData: FormData) {
  const id = optionalText(formData, "id");
  if (id && id.length > 128) throw new InteractionRoleInputError("角色識別碼無效。");
  const avatarUrl = await resolveInteractionRoleAvatar(vendorId, formData);
  const avatarModeValue = submittedInteractionRoleMode(formData);
  const validation = normalizeInteractionRoleDraft({
    name: text(formData, "name"),
    avatarUrl,
    avatarMode: avatarModeValue === "preset" ? "preset" : null,
    label: optionalText(formData, "label"),
    roleType: text(formData, "roleType", "official"),
    tone: optionalText(formData, "tone"),
    isActive: parseInteractionRoleBoolean(formData.get("isActive")),
    isScheduled: parseInteractionRoleBoolean(formData.get("isScheduled")),
  });
  if (!validation.success) throw new InteractionRoleInputError(validation.error);
  return validation.data;
}

export async function upsertInteractionRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const id = optionalText(formData, "id");
  const invalidRolePath = id
    ? `/interaction-roles/${encodeURIComponent(id)}/edit?error=invalid_role`
    : "/interaction-roles/new?error=invalid_role";
  if (id && id.length > 128) redirect("/interaction-roles/new?error=invalid_role");

  let data;
  try {
    data = await normalizedInteractionRoleData(vendor.id, formData);
    await persistAndAuditInteractionRole({ vendorId: vendor.id, auth, id, data });
  } catch (error) {
    if (error instanceof InteractionRoleInputError) redirect(invalidRolePath);
    if (error instanceof ImageAssetReferenceError) redirect(invalidRolePath);
    if (error instanceof InteractionRoleMissingError) redirect("/interaction-roles/new?error=missing_role");
    throw error;
  }

  redirect("/interaction-roles");
}

export async function upsertInteractionRoleActionState(
  _previousState: InteractionRoleActionState,
  formData: FormData,
): Promise<InteractionRoleActionState> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const values = submittedInteractionRoleValues(formData);
  try {
    const data = await normalizedInteractionRoleData(vendor.id, formData);
    await persistAndAuditInteractionRole({ vendorId: vendor.id, auth, id: optionalText(formData, "id"), data });
  } catch (error) {
    if (error instanceof InteractionRoleInputError) {
      return { status: "error", message: error.message, values };
    }
    if (error instanceof ImageAssetReferenceError) {
      return {
        status: "error",
        message: "角色頭像圖片資產無效，請重新上傳。",
        values,
      };
    }
    if (error instanceof InteractionRoleMissingError) {
      return { status: "error", message: "這個角色已不存在或不屬於目前商店。", values };
    }
    throw error;
  }

  redirect("/interaction-roles");
}

export async function deleteInteractionRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = text(formData, "id");
  if (!id || id.length > 128) redirect("/interaction-roles/new?error=invalid_role");
  const role = await (async () => {
    try {
      return await getDb().interactionRole.delete({
        where: { id, vendorId: vendor.id },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        redirect("/interaction-roles/new?error=missing_role");
      }
      throw error;
    }
  })();
  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_role_deleted",
    targetType: "InteractionRole",
    targetId: role.id,
    before: auditSnapshot({
      name: role.name,
      label: role.label,
      roleType: role.roleType,
      isActive: role.isActive,
    }),
  });
  redirect("/interaction-roles/new");
}

function roleAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

const systemRoleLibrary = [
  { name: "開場 AI 主持人", label: "官方角色", roleType: "official", tone: "熱情但不吵，負責歡迎、提醒流程與整理重點", avatarUrl: roleAvatar("host-blue"), isScheduled: true },
  { name: "官方商品顧問", label: "官方角色", roleType: "official", tone: "清楚說明商品差異、價格與適合族群", avatarUrl: roleAvatar("advisor-cyan"), isScheduled: true },
  { name: "優惠提醒助手", label: "官方角色", roleType: "official", tone: "在關鍵節點提醒限時優惠與表單，不過度催促", avatarUrl: roleAvatar("reminder-rose"), isScheduled: true },
  { name: "客服 Q&A 助手", label: "官方角色", roleType: "official", tone: "簡短回答常見問題，引導私訊或表單", avatarUrl: roleAvatar("qa-indigo"), isScheduled: true },
  { name: "保養知識顧問", label: "官方角色", roleType: "official", tone: "用生活化方式補充使用情境與注意事項", avatarUrl: roleAvatar("care-teal"), isScheduled: true },
  { name: "成交節奏助手", label: "官方角色", roleType: "official", tone: "在商品浮出時整理賣點與 CTA", avatarUrl: roleAvatar("sales-amber"), isScheduled: true },
  { name: "直播小編", label: "官方角色", roleType: "official", tone: "像品牌小編一樣親切補充直播資訊", avatarUrl: roleAvatar("editor-purple"), isScheduled: true },
  { name: "提醒通知助手", label: "官方角色", roleType: "official", tone: "提醒報名、優惠到期、庫存與下一段重點", avatarUrl: roleAvatar("assistant-lime"), isScheduled: true },
  { name: "售後關懷助手", label: "官方角色", roleType: "official", tone: "說明出貨、保固、退換貨與客服入口", avatarUrl: roleAvatar("support-green"), isScheduled: true },
  { name: "限時活動主持", label: "官方角色", roleType: "official", tone: "在促銷段落帶節奏，強調活動時間與組合價值", avatarUrl: roleAvatar("promo-red"), isScheduled: true },
];

export async function importSystemRolesAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const db = getDb();
  const existing = await db.interactionRole.findMany({
    where: {
      vendorId: vendor.id,
      name: { in: systemRoleLibrary.map((role) => role.name) },
    },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((role) => role.name));

  const imported = await db.interactionRole.createMany({
    data: systemRoleLibrary
      .filter((role) => !existingNames.has(role.name))
      .map((role) => ({ ...role, vendorId: vendor.id, isActive: true, isScheduled: true })),
  });

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_role_library_imported",
    targetType: "InteractionRole",
    targetId: vendor.id,
    after: auditSnapshot({ requestedCount: systemRoleLibrary.length, importedCount: imported.count }),
  });

  revalidatePath("/interaction-roles");
  redirect("/interaction-roles");
}

/**
 * Performs the interaction-script write independently from its navigation
 * transport. Both the legacy Server Action and the native same-origin POST
 * route therefore retain the exact CSRF, authorization, tenant, transaction
 * and audit boundary.
 */
export async function saveInteractionScript(formData: FormData): Promise<string> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = optionalText(formData, "id");
  const db = getDb();
  const roleIds = formData.getAll("roleId").map(String);
  const eventTypes = formData.getAll("eventType").map(String);
  const parsedTriggerSecs = formData.getAll("triggerSec").map((value) => parseInteractionTriggerSeconds(String(value)));
  const titles = formData.getAll("eventTitle").map(String);
  const messages = formData.getAll("message").map(String);
  const productIds = formData.getAll("productId").map(String);
  const ctaLabels = formData.getAll("ctaLabel").map(String);
  const ctaUrls = formData.getAll("ctaUrl").map(String);
  const invalidEventPath = id
    ? `/interaction-scripts/${encodeURIComponent(id)}/edit?error=invalid_event`
    : "/interaction-scripts/new?error=invalid_event";

  if (eventTypes.length > 200) return invalidEventPath;
  if (eventTypes.length === 0 || [roleIds, titles, messages, productIds, ctaLabels, ctaUrls]
    .some((column) => column.length !== eventTypes.length)) {
    return invalidEventPath;
  }
  if (parsedTriggerSecs.length !== eventTypes.length || parsedTriggerSecs.some((triggerSec) => triggerSec === null)) {
    return invalidEventPath;
  }
  const triggerSecs = parsedTriggerSecs.map((triggerSec) => {
    if (triggerSec === null) return null;
    return triggerSec;
  });
  if (triggerSecs.some((triggerSec) => triggerSec === null)) return invalidEventPath;

  const eventResults = eventTypes.map((eventType, index) => {
    const triggerSec = triggerSecs[index];
    if (triggerSec === undefined || triggerSec === null) return { success: false as const };

    return normalizeInteractionEventDraft({
      eventType,
      triggerSec,
      title: titles[index],
      message: messages[index],
      productId: productIds[index],
      ctaLabel: ctaLabels[index],
      ctaUrl: ctaUrls[index],
      roleId: roleIds[index],
    }, index);
  });
  if (eventResults.some((result) => !result.success)) return invalidEventPath;
  const events = eventResults.flatMap((result) => result.success ? [result.data] : []);

  const referencedRoleIds = [...new Set(events.flatMap((event) => event.roleId ? [event.roleId] : []))];
  const referencedProductIds = [...new Set(events.flatMap((event) => event.productId ? [event.productId] : []))];
  const invalidReferencePath = id
    ? `/interaction-scripts/${encodeURIComponent(id)}/edit?error=invalid_reference`
    : "/interaction-scripts/new?error=invalid_reference";
  if ([id, ...referencedRoleIds, ...referencedProductIds].some((value) => value && value.length > 128)) {
    return invalidReferencePath;
  }

  const name = text(formData, "name");
  const description = optionalText(formData, "description");
  const status = text(formData, "status", "draft");
  if (!name || name.length > 160 || (description?.length ?? 0) > 1_000 || (status !== "draft" && status !== "published")) {
    return invalidEventPath;
  }
  const data = { name, description, status };

  let scriptId: string;
  if (id) {
    scriptId = id;
  }

  try {
    scriptId = await db.$transaction(async (tx) => {
      // Read all tenant and lifecycle references again inside the same
      // Serializable transaction as the script/event writes. The values read
      // before this boundary are form-derived only and are never trusted as a
      // reference authorization decision.
      const [referencedRoles, referencedProducts] = await Promise.all([
        referencedRoleIds.length > 0
          ? tx.interactionRole.findMany({
              where: { vendorId: vendor.id, id: { in: referencedRoleIds }, isActive: true, isScheduled: true },
              select: {
                id: true,
                vendorId: true,
                name: true,
                avatarUrl: true,
                label: true,
                roleType: true,
                isActive: true,
                isScheduled: true,
              },
            })
          : Promise.resolve([]),
        referencedProductIds.length > 0
          ? tx.product.findMany({
              where: { vendorId: vendor.id, id: { in: referencedProductIds }, isActive: true, fulfillmentTypeConfirmed: true },
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);
      if (
        referencedRoles.length !== referencedRoleIds.length
        || referencedRoles.some((role) => !isEligibleScheduledRole(role, vendor.id))
        || referencedProducts.length !== referencedProductIds.length
      ) {
        throw new InteractionScriptReferenceError();
      }

      if (id) {
        try {
          await tx.interactionScript.update({ where: { id, vendorId: vendor.id }, data });
          await tx.interactionEvent.deleteMany({ where: { scriptId: id } });
          for (const event of events) {
            await tx.interactionEvent.create({ data: { ...event, scriptId: id } });
          }
        } catch (error) {
          if (isRecordNotFoundError(error)) throw new InteractionScriptMissingError();
          throw error;
        }
        return id;
      }

      const script = await tx.interactionScript.create({
        data: {
          ...data,
          vendorId: vendor.id,
          events: { create: events },
        },
      });
      return script.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof InteractionScriptMissingError || isRecordNotFoundError(error)) {
      return "/interaction-scripts?error=missing_script";
    }
    if (error instanceof InteractionScriptReferenceError) {
      return invalidReferencePath;
    }
    if (isInteractionScriptWriteConflict(error)) {
      return "/interaction-scripts?error=conflict";
    }
    throw error;
  }

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: id ? "interaction_script_updated" : "interaction_script_created",
    targetType: "InteractionScript",
    targetId: scriptId,
    after: auditSnapshot({ name, status, eventCount: events.length }),
  });

  return "/interaction-scripts";
}

export async function upsertInteractionScriptAction(formData: FormData) {
  redirect(await saveInteractionScript(formData));
}

export async function unbindInteractionScriptFromLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const scriptId = text(formData, "id");
  const liveId = text(formData, "liveId");

  if (!scriptId || !liveId || scriptId.length > 128 || liveId.length > 128) {
    throw new Error("直播不存在或未綁定此互動腳本。");
  }

  const updateResult = await getDb().live.updateMany({
    where: {
      id: liveId,
      vendorId: vendor.id,
      interactionScriptId: scriptId,
      interactionScript: { is: { id: scriptId, vendorId: vendor.id } },
    },
    data: { interactionScriptId: null },
  });

  if (updateResult.count !== 1) {
    throw new Error("直播不存在或未綁定此互動腳本。");
  }

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_script_unbound_from_live",
    targetType: "Live",
    targetId: liveId,
    before: auditSnapshot({ interactionScriptId: scriptId }),
    after: auditSnapshot({ interactionScriptId: null }),
  });

  revalidatePath("/interaction-scripts");
  revalidatePath(`/interaction-scripts/${scriptId}/edit`);
  revalidatePath("/lives");
  revalidatePath(`/lives/${liveId}/edit`);
}

export async function duplicateInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = text(formData, "id");
  if (!id || id.length > 128) redirect("/interaction-scripts");
  const db = getDb();
  let duplicateResult: {
    duplicateId: string;
    sourceScriptId: string;
    duplicateName: string;
    eventCount: number;
  };

  try {
    duplicateResult = await db.$transaction(async (tx) => {
      // The source, its events, all references, and the duplicate are read or
      // written through this one transaction. No source snapshot from outside
      // the transaction can authorize a duplicate.
      const script = await tx.interactionScript.findFirst({
        where: { id, vendorId: vendor.id },
        include: { events: { orderBy: { triggerSec: "asc" } } },
      });
      if (!script) throw new InteractionScriptDuplicateSourceMissingError();

      const eventResults = script.events.map((event, index) => normalizeInteractionEventDraft({
        eventType: event.eventType,
        triggerSec: event.triggerSec,
        title: event.title,
        message: event.message,
        productId: event.productId,
        ctaLabel: event.ctaLabel,
        ctaUrl: event.ctaUrl,
        roleId: event.roleId,
      }, index));
      if (eventResults.some((result) => !result.success)) {
        throw new InteractionScriptInvalidEventError();
      }
      const normalizedEvents = eventResults.flatMap((result) => result.success ? [result.data] : []);
      const referencedRoleIds = [...new Set(normalizedEvents.flatMap((event) => event.roleId ? [event.roleId] : []))];
      const referencedProductIds = [...new Set(normalizedEvents.flatMap((event) => event.productId ? [event.productId] : []))];
      const [referencedRoles, referencedProducts] = await Promise.all([
        referencedRoleIds.length > 0
          ? tx.interactionRole.findMany({
              where: { vendorId: vendor.id, id: { in: referencedRoleIds }, isActive: true, isScheduled: true },
              select: {
                id: true,
                vendorId: true,
                name: true,
                avatarUrl: true,
                label: true,
                roleType: true,
                isActive: true,
                isScheduled: true,
              },
            })
          : Promise.resolve([]),
        referencedProductIds.length > 0
          ? tx.product.findMany({
              where: { vendorId: vendor.id, id: { in: referencedProductIds }, isActive: true },
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);
      if (
        referencedRoles.length !== referencedRoleIds.length
        || referencedRoles.some((role) => !isEligibleScheduledRole(role, vendor.id))
        || referencedProducts.length !== referencedProductIds.length
      ) {
        throw new InteractionScriptReferenceError();
      }
      const duplicateNameSuffix = " 複本";
      const duplicateName = `${script.name.slice(0, 160 - duplicateNameSuffix.length)}${duplicateNameSuffix}`;
      const duplicate = await tx.interactionScript.create({
        data: {
          vendorId: vendor.id,
          name: duplicateName,
          description: script.description,
          status: "draft",
          events: {
            create: normalizedEvents.map((event, index) => ({
              eventType: event.eventType,
              triggerSec: event.triggerSec,
              title: event.title,
              message: event.message,
              productId: event.productId,
              ctaLabel: event.ctaLabel,
              ctaUrl: event.ctaUrl,
              roleId: event.roleId,
              metadata: script.events[index]?.metadata as Prisma.InputJsonValue,
            })),
          },
        },
      });
      return {
        duplicateId: duplicate.id,
        sourceScriptId: script.id,
        duplicateName,
        eventCount: normalizedEvents.length,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof InteractionScriptInvalidEventError) {
      redirect("/interaction-scripts?error=invalid_event");
    }
    if (error instanceof InteractionScriptDuplicateSourceMissingError) {
      redirect("/interaction-scripts");
    }
    if (isRecordNotFoundError(error)) {
      redirect("/interaction-scripts?error=missing_script");
    }
    if (error instanceof InteractionScriptReferenceError) {
      redirect("/interaction-scripts?error=invalid_reference");
    }
    if (isInteractionScriptWriteConflict(error)) {
      redirect("/interaction-scripts?error=conflict");
    }
    throw error;
  }

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_script_duplicated",
    targetType: "InteractionScript",
    targetId: duplicateResult.duplicateId,
    after: auditSnapshot({ sourceScriptId: duplicateResult.sourceScriptId, name: duplicateResult.duplicateName, status: "draft", eventCount: duplicateResult.eventCount }),
  });

  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function deleteInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = text(formData, "id");
  if (!id || id.length > 128) redirect("/interaction-scripts");
  const script = await (async () => {
    try {
      return await getDb().interactionScript.delete({
        where: { id, vendorId: vendor.id },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        redirect("/interaction-scripts?error=missing_script");
      }
      throw error;
    }
  })();
  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_script_deleted",
    targetType: "InteractionScript",
    targetId: script.id,
    before: auditSnapshot({ name: script.name, status: script.status }),
  });
  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function upsertBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const identifierType = BlacklistIdentifierType.safeParse(text(formData, "identifierType", "email"));
  const identifier = identifierType.success
    ? normalizeBlacklistIdentifier(identifierType.data, text(formData, "identifier"))
    : null;
  if (!identifierType.success || !identifier) {
    redirect("/blacklists?error=invalid_identifier");
  }
  await getDb().blacklist.create({
    data: {
      vendorId: vendor.id,
      identifier,
      identifierType: identifierType.data,
      reason: text(formData, "reason"),
      notes: optionalText(formData, "notes"),
    },
  });
  await writeAuditLog({
    vendorId: vendor.id,
    action: "blacklist_created",
    targetType: "Blacklist",
    after: auditSnapshot({ identifierType: identifierType.data, isActive: true }),
  });
  revalidatePath("/blacklists");
}

export async function unblockBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = text(formData, "id");
  await getDb().blacklist.update({
    where: { id, vendorId: vendor.id },
    data: {
      isActive: false,
      unblockedAt: new Date(),
    },
  });
  revalidatePath("/blacklists");
}
