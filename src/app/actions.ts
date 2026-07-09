"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { AUTH_COOKIE, authenticateVendor, requireFinanceAdmin, requireVendor } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { calculateSettlement, invoiceNumber, payoutBatchNumber } from "@/lib/billing";
import { retryWebhookEvent } from "@/lib/webhook-retry";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { toSlug } from "@/lib/format";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function intValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number.parseInt(text(formData, key, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyToCents(formData: FormData, key: string, fallback = 0) {
  const value = text(formData, key);
  if (!value) return fallback;
  const parsed = Number.parseFloat(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : fallback;
}

function secondsValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes(":")) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parts = trimmed.split(":").map((part) => Number.parseInt(part, 10) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

export async function loginAction(formData: FormData) {
  const vendor = await authenticateVendor(text(formData, "email"), text(formData, "password"));
  if (!vendor) {
    redirect("/login?error=1");
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, vendor.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  redirect("/login");
}

export async function saveBrandSettingsAction(formData: FormData) {
  const vendor = await requireVendor();
  await getDb().vendor.update({
    where: { id: vendor.id },
    data: {
      name: text(formData, "name"),
      slug: toSlug(text(formData, "slug")),
      logoUrl: optionalText(formData, "logoUrl"),
      primaryColor: text(formData, "primaryColor", "#2563eb"),
      ctaColor: text(formData, "ctaColor", "#f97316"),
      timezone: text(formData, "timezone", "Asia/Taipei"),
      supportEmail: optionalText(formData, "supportEmail"),
    },
  });
  revalidatePath("/settings/brand");
}

export async function saveTrackingSettingsAction(formData: FormData) {
  const vendor = await requireVendor();
  await getDb().trackingSetting.upsert({
    where: { vendorId: vendor.id },
    create: {
      vendorId: vendor.id,
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
    update: {
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
  });
  revalidatePath("/settings/tracking");
}

export async function updatePasswordAction(formData: FormData) {
  const vendor = await requireVendor();
  const password = text(formData, "password");
  if (password.length < 8) {
    redirect("/settings/security?error=short");
  }
  await getDb().vendor.update({
    where: { id: vendor.id },
    data: { passwordHash: hashPassword(password) },
  });
  redirect("/settings/security?updated=1");
}

export async function upsertVideoAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const data = {
    title: text(formData, "title"),
    description: optionalText(formData, "description"),
    sourceType: text(formData, "sourceType", "url"),
    videoUrl: text(formData, "videoUrl"),
    thumbnailUrl: optionalText(formData, "thumbnailUrl"),
    durationSec: intValue(formData, "durationSec"),
    status: text(formData, "status", "ready"),
    cloudflareStreamUid: optionalText(formData, "cloudflareStreamUid"),
    cloudflareLiveInputUid: optionalText(formData, "cloudflareLiveInputUid"),
    cloudflarePlaybackId: optionalText(formData, "cloudflarePlaybackId"),
    cloudflareReadyToStream: formData.get("cloudflareReadyToStream") === "on",
    liveStreamKey: optionalText(formData, "liveStreamKey"),
    liveInputStatus: optionalText(formData, "liveInputStatus"),
    estimatedMinutes: intValue(formData, "estimatedMinutes"),
  };

  if (id) {
    await getDb().video.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().video.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/videos");
}

export async function upsertProductAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    priceCents: intValue(formData, "priceCents"),
    compareAtCents: optionalText(formData, "compareAtCents") ? intValue(formData, "compareAtCents") : null,
    currency: text(formData, "currency", "TWD"),
    imageUrl: optionalText(formData, "imageUrl"),
    checkoutUrl: optionalText(formData, "checkoutUrl"),
    inventory: intValue(formData, "inventory"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().product.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().product.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/products");
}

export async function upsertFormAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  let fields: Prisma.InputJsonValue = [];
  try {
    fields = JSON.parse(text(formData, "fields", "[]")) as Prisma.InputJsonValue;
  } catch {
    fields = [];
  }

  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    headline: text(formData, "headline"),
    description: optionalText(formData, "description"),
    submitLabel: text(formData, "submitLabel", "送出報名"),
    fields,
    successMessage: text(formData, "successMessage", "已收到你的資料，開播前會再提醒你。"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().registrationForm.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().registrationForm.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/forms");
}

export async function upsertTemplateAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    channel: text(formData, "channel", "email"),
    trigger: text(formData, "trigger", "registration_confirmed"),
    subject: optionalText(formData, "subject"),
    body: text(formData, "body"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().messageTemplate.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().messageTemplate.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/messages/templates");
}

export async function upsertLiveAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const productIds = formData.getAll("productIds").filter((value): value is string => typeof value === "string");
  const scheduledAtValue = text(formData, "scheduledAt");
  const data = {
    title: text(formData, "title"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    scheduledAt: scheduledAtValue ? new Date(scheduledAtValue) : new Date(),
    status: text(formData, "status", "scheduled"),
    videoId: optionalText(formData, "videoId"),
    formId: optionalText(formData, "formId"),
    messageTemplateId: optionalText(formData, "messageTemplateId"),
    interactionScriptId: optionalText(formData, "interactionScriptId"),
    heroImageUrl: optionalText(formData, "heroImageUrl"),
    accentCopy: optionalText(formData, "accentCopy"),
    replayEnabled: formData.get("replayEnabled") !== "off",
    streamMode: text(formData, "streamMode", "vod"),
    cloudflareLiveInputUid: optionalText(formData, "cloudflareLiveInputUid"),
    quotaPolicy: {
      maxConcurrentViewers: intValue(formData, "maxConcurrentViewers", 500),
      stopWhenCreditsBelow: intValue(formData, "stopWhenCreditsBelow", 300),
    } as Prisma.InputJsonValue,
  };

  const db = getDb();
  if (id) {
    await db.$transaction([
      db.live.update({ where: { id, vendorId: vendor.id }, data }),
      db.liveProduct.deleteMany({ where: { liveId: id } }),
      ...productIds.map((productId, index) =>
        db.liveProduct.create({
          data: { liveId: id, productId, sortOrder: index + 1, isPinned: index === 0 },
        }),
      ),
    ]);
    redirect(`/lives/${id}/edit`);
  }

  const live = await db.live.create({
    data: {
      ...data,
      vendorId: vendor.id,
      products: {
        create: productIds.map((productId, index) => ({
          productId,
          sortOrder: index + 1,
          isPinned: index === 0,
        })),
      },
    },
  });

  redirect(`/lives/${live.id}/preview`);
}

export async function upsertInteractionRoleAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    avatarUrl: optionalText(formData, "avatarUrl"),
    label: text(formData, "label", "官方角色"),
    roleType: text(formData, "roleType", "official"),
    tone: optionalText(formData, "tone"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().interactionRole.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().interactionRole.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/interaction-roles");
}

export async function deleteInteractionRoleAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = text(formData, "id");
  await getDb().interactionRole.delete({
    where: { id, vendorId: vendor.id },
  });
  redirect("/interaction-roles/new");
}

function roleAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

const systemRoleLibrary = [
  { name: "開場 AI 主持人", label: "AI 主持人", roleType: "ai_host", tone: "熱情但不吵，負責歡迎、提醒流程與整理重點", avatarUrl: roleAvatar("host-blue") },
  { name: "官方商品顧問", label: "官方角色", roleType: "official", tone: "清楚說明商品差異、價格與適合族群", avatarUrl: roleAvatar("advisor-cyan") },
  { name: "優惠提醒助手", label: "系統助手", roleType: "system_assistant", tone: "在關鍵節點提醒限時優惠與表單，不過度催促", avatarUrl: roleAvatar("reminder-rose") },
  { name: "客服 Q&A 助手", label: "客服助手", roleType: "support", tone: "簡短回答常見問題，引導私訊或表單", avatarUrl: roleAvatar("qa-indigo") },
  { name: "保養知識顧問", label: "官方角色", roleType: "official", tone: "用生活化方式補充使用情境與注意事項", avatarUrl: roleAvatar("care-teal") },
  { name: "成交節奏助手", label: "系統助手", roleType: "system_assistant", tone: "在商品浮出時整理賣點與 CTA", avatarUrl: roleAvatar("sales-amber") },
  { name: "直播小編", label: "官方角色", roleType: "official", tone: "像品牌小編一樣親切補充直播資訊", avatarUrl: roleAvatar("editor-purple") },
  { name: "提醒通知助手", label: "系統助手", roleType: "system_assistant", tone: "提醒報名、優惠到期、庫存與下一段重點", avatarUrl: roleAvatar("assistant-lime") },
  { name: "售後關懷助手", label: "客服助手", roleType: "support", tone: "說明出貨、保固、退換貨與客服入口", avatarUrl: roleAvatar("support-green") },
  { name: "限時活動主持", label: "AI 主持人", roleType: "ai_host", tone: "在促銷段落帶節奏，強調活動時間與組合價值", avatarUrl: roleAvatar("promo-red") },
];

export async function importSystemRolesAction() {
  const vendor = await requireVendor();
  const db = getDb();
  const existing = await db.interactionRole.findMany({
    where: {
      vendorId: vendor.id,
      name: { in: systemRoleLibrary.map((role) => role.name) },
    },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((role) => role.name));

  await db.interactionRole.createMany({
    data: systemRoleLibrary
      .filter((role) => !existingNames.has(role.name))
      .map((role) => ({ ...role, vendorId: vendor.id, isActive: true })),
  });

  revalidatePath("/interaction-roles");
  redirect("/interaction-roles");
}

export async function upsertInteractionScriptAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const db = getDb();
  const roleIds = formData.getAll("roleId").map(String);
  const eventTypes = formData.getAll("eventType").map(String);
  const triggerSecs = formData.getAll("triggerSec").map((value) => secondsValue(String(value)));
  const titles = formData.getAll("eventTitle").map(String);
  const messages = formData.getAll("message").map(String);
  const productIds = formData.getAll("productId").map(String);
  const ctaLabels = formData.getAll("ctaLabel").map(String);
  const ctaUrls = formData.getAll("ctaUrl").map(String);

  const events = eventTypes
    .map((eventType, index) => ({
      eventType,
      triggerSec: triggerSecs[index] ?? 0,
      title: titles[index]?.trim() || `${eventType} ${index + 1}`,
      message: messages[index]?.trim() || null,
      productId: productIds[index]?.trim() || null,
      ctaLabel: ctaLabels[index]?.trim() || null,
      ctaUrl: ctaUrls[index]?.trim() || null,
      roleId: roleIds[index]?.trim() || null,
    }))
    .filter((event) => event.eventType && event.title);

  const data = {
    name: text(formData, "name"),
    description: optionalText(formData, "description"),
    status: text(formData, "status", "draft"),
  };

  if (id) {
    await db.$transaction([
      db.interactionScript.update({ where: { id, vendorId: vendor.id }, data }),
      db.interactionEvent.deleteMany({ where: { scriptId: id } }),
      ...events.map((event) => db.interactionEvent.create({ data: { ...event, scriptId: id } })),
    ]);
  } else {
    await db.interactionScript.create({
      data: {
        ...data,
        vendorId: vendor.id,
        events: { create: events },
      },
    });
  }

  redirect("/interaction-scripts");
}

export async function duplicateInteractionScriptAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = text(formData, "id");
  const script = await getDb().interactionScript.findFirst({
    where: { id, vendorId: vendor.id },
    include: { events: { orderBy: { triggerSec: "asc" } } },
  });
  if (!script) {
    redirect("/interaction-scripts");
  }

  await getDb().interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: `${script.name} 複本`,
      description: script.description,
      status: "draft",
      events: {
        create: script.events.map((event) => ({
          eventType: event.eventType,
          triggerSec: event.triggerSec,
          title: event.title,
          message: event.message,
          productId: event.productId,
          ctaLabel: event.ctaLabel,
          ctaUrl: event.ctaUrl,
          roleId: event.roleId,
          metadata: event.metadata as Prisma.InputJsonValue,
        })),
      },
    },
  });

  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function deleteInteractionScriptAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = text(formData, "id");
  await getDb().interactionScript.delete({
    where: { id, vendorId: vendor.id },
  });
  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function upsertBlacklistAction(formData: FormData) {
  const vendor = await requireVendor();
  await getDb().blacklist.create({
    data: {
      vendorId: vendor.id,
      identifier: text(formData, "identifier"),
      identifierType: text(formData, "identifierType", "email"),
      reason: text(formData, "reason"),
      notes: optionalText(formData, "notes"),
    },
  });
  revalidatePath("/blacklists");
}

export async function unblockBlacklistAction(formData: FormData) {
  const vendor = await requireVendor();
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

export async function upsertAffiliateAction(formData: FormData) {
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    code: text(formData, "code").toUpperCase(),
    source: optionalText(formData, "source"),
    contactEmail: optionalText(formData, "contactEmail"),
    commissionRateBps: intValue(formData, "commissionRateBps"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().affiliate.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().affiliate.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/affiliates");
}

export async function generateSettlementAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const db = getDb();
  const vendorId = text(formData, "vendorId");
  const monthKey = text(formData, "monthKey");
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || !monthKey) {
    redirect("/admin/billing/settlements?error=missing");
  }

  const existing = await db.settlement.findUnique({ where: { vendorId_monthKey: { vendorId, monthKey } } });
  if (existing?.lockedAt) {
    redirect("/admin/billing/settlements?error=locked");
  }

  const calculation = await calculateSettlement(vendorId, monthKey);
  const adjustmentAmountCents = existing?.adjustmentAmountCents ?? 0;
  const adjustmentReason = existing?.adjustmentReason ?? null;
  const finalPayoutAmountCents = calculation.payoutableAmountCents + adjustmentAmountCents;

  const settlement = await db.$transaction(async (tx) => {
    const savedSettlement = await tx.settlement.upsert({
      where: { vendorId_monthKey: { vendorId, monthKey } },
      create: {
        vendorId,
        monthKey,
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        adjustmentAmountCents,
        adjustmentReason,
        finalPayoutAmountCents,
        status: "draft",
      },
      update: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        finalPayoutAmountCents,
        status: "draft",
      },
    });

    const subtotalCents =
      calculation.monthlyFeeCents +
      calculation.overflowFeeCents +
      calculation.paymentServiceFeeCents +
      calculation.transactionServiceFeeCents +
      calculation.affiliateManagementFeeCents;

    await tx.invoice.upsert({
      where: { invoiceNumber: invoiceNumber(vendor.slug, monthKey) },
      create: {
        vendorId,
        monthKey,
        invoiceNumber: invoiceNumber(vendor.slug, monthKey),
        invoiceType: "monthly",
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
        status: "issued",
      },
      update: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
        status: "issued",
      },
    });

    return savedSettlement;
  });

  await writeAuditLog({
    vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "generate_settlement",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(existing),
    after: auditSnapshot({ settlement, calculation }),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  revalidatePath("/billing/invoices");
  redirect("/admin/billing/settlements");
}

export async function updateSettlementAdjustmentAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const adjustmentAmountCents = moneyToCents(formData, "adjustmentAmount");
  const adjustmentReason = optionalText(formData, "adjustmentReason");
  const settlement = await getDb().settlement.findUnique({ where: { id } });
  if (!settlement || settlement.lockedAt) {
    redirect("/admin/billing/settlements?error=locked");
  }

  const updated = await getDb().settlement.update({
    where: { id },
    data: {
      adjustmentAmountCents,
      adjustmentReason,
      reviewedBy: member.id,
      finalPayoutAmountCents: settlement.payoutableAmountCents + adjustmentAmountCents,
    },
  });

  await writeAuditLog({
    vendorId: settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "update_settlement_adjustment",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(settlement),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function lockSettlementAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const settlement = await getDb().settlement.findUnique({ where: { id } });
  if (!settlement || settlement.lockedAt) {
    redirect("/admin/billing/settlements");
  }

  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    const locked = await tx.settlement.update({
      where: { id },
      data: {
        status: "locked",
        lockedAt: new Date(),
        lockedBy: member.id,
        reviewedBy: member.id,
      },
    });
    await tx.affiliateCommission.updateMany({
      where: { vendorId: settlement.vendorId, monthKey: settlement.monthKey, status: { in: ["pending", "approved"] } },
      data: { status: "locked", settledAt: new Date() },
    });
    return locked;
  });

  await writeAuditLog({
    vendorId: settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "lock_settlement",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(settlement),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function createPayoutBatchAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const settlementIds = formData.getAll("settlementIds").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (settlementIds.length === 0) {
    redirect("/admin/billing/payouts?error=empty");
  }

  const db = getDb();
  const settlements = await db.settlement.findMany({
    where: {
      id: { in: settlementIds },
      lockedAt: { not: null },
      payoutBatchId: null,
      finalPayoutAmountCents: { gt: 0 },
    },
    include: { vendor: { include: { paymentAccounts: true } } },
  });

  if (settlements.length === 0) {
    redirect("/admin/billing/payouts?error=no_locked");
  }

  const now = new Date();
  const batchNumber = payoutBatchNumber(now);
  const totalAmountCents = settlements.reduce((sum, settlement) => sum + settlement.finalPayoutAmountCents, 0);

  const batch = await db.$transaction(async (tx) => {
    const batch = await tx.payoutBatch.create({
      data: {
        batchNumber,
        batchDate: now,
        totalAmountCents,
        totalCount: settlements.length,
        status: "draft",
        exportedFilePath: `/admin/billing/payouts/${batchNumber}/csv`,
      },
    });

    for (const settlement of settlements) {
      const account = settlement.vendor.paymentAccounts.find((item) => item.mode === "platform" && item.bankAccountNumber) ?? settlement.vendor.paymentAccounts[0];
      await tx.payoutItem.create({
        data: {
          payoutBatchId: batch.id,
          vendorId: settlement.vendorId,
          settlementId: settlement.id,
          bankAccountName: account?.bankAccountName ?? settlement.vendor.name,
          bankCode: account?.bankCode ?? "000",
          bankAccountNumber: account?.bankAccountNumber ?? "未設定",
          payoutAmountCents: settlement.finalPayoutAmountCents,
          status: "pending",
        },
      });
      await tx.settlement.update({
        where: { id: settlement.id },
        data: {
          payoutBatchId: batch.id,
          batchNumber,
          status: "ready_for_payout",
          payoutDate: now,
        },
      });
    }

    return batch;
  });

  await writeAuditLog({
    vendorId: settlements[0]?.vendorId ?? null,
    actorId: member.id,
    actorLabel: member.role,
    action: "create_payout_batch",
    targetType: "PayoutBatch",
    targetId: batch.id,
    before: auditSnapshot({ settlementIds }),
    after: auditSnapshot({ batch, settlements: settlements.map((settlement) => settlement.id) }),
  });

  revalidatePath("/admin/billing/payouts");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/payouts");
}

export async function updatePayoutItemStatusAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const status = text(formData, "status", "pending");
  const failReason = optionalText(formData, "failReason");
  const item = await getDb().payoutItem.findUnique({ where: { id }, include: { payoutBatch: true } });
  if (!item) {
    redirect("/admin/billing/payouts");
  }

  const data: Prisma.PayoutItemUpdateInput = {
    status,
    failReason: status === "failed" ? failReason : null,
  };

  if (status === "paid") {
    data.paidAt = new Date();
  }

  if (status === "retrying") {
    data.retriedAt = new Date();
    data.retryCount = { increment: 1 };
  }

  const updated = await getDb().$transaction(async (tx) => {
    const savedItem = await tx.payoutItem.update({ where: { id }, data });
    const items = await tx.payoutItem.findMany({ where: { payoutBatchId: item.payoutBatchId } });
    const paidItems = items.filter((batchItem) => batchItem.status === "paid" || batchItem.id === id && status === "paid");
    const failedItems = items.filter((batchItem) => batchItem.status === "failed" || batchItem.id === id && status === "failed");
    const batchStatus = paidItems.length === items.length ? "completed" : failedItems.length > 0 ? "failed" : item.payoutBatch.status;

    await tx.payoutBatch.update({
      where: { id: item.payoutBatchId },
      data: {
        status: batchStatus,
        executedAt: batchStatus === "completed" ? new Date() : item.payoutBatch.executedAt,
      },
    });

    if (item.settlementId && status === "paid") {
      await tx.settlement.update({
        where: { id: item.settlementId },
        data: { status: "paid", paidAt: new Date() },
      });
    }

    return savedItem;
  });

  await writeAuditLog({
    vendorId: item.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: `mark_payout_${status}`,
    targetType: "PayoutItem",
    targetId: item.id,
    before: auditSnapshot(item),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/payouts");
  revalidatePath("/billing/payouts");
  redirect("/admin/billing/payouts");
}

export async function markPayoutBatchExportedAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const before = await getDb().payoutBatch.findUnique({ where: { id } });
  const updated = await getDb().payoutBatch.update({
    where: { id },
    data: {
      status: "exported",
      exportedAt: new Date(),
    },
  });
  await writeAuditLog({
    actorId: member.id,
    actorLabel: member.role,
    action: "export_payout_batch",
    targetType: "PayoutBatch",
    targetId: id,
    before: auditSnapshot(before),
    after: auditSnapshot(updated),
  });
  revalidatePath("/admin/billing/payouts");
  redirect("/admin/billing/payouts");
}

export async function refundPaymentTransactionAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const refundAmountCents = moneyToCents(formData, "refundAmount");
  const gatewayFeeRefundCents = moneyToCents(formData, "gatewayFeeRefund");
  const platformFeeRefundCents = moneyToCents(formData, "platformFeeRefund");
  const reason = optionalText(formData, "reason");
  const monthKey = text(formData, "monthKey", new Date().toISOString().slice(0, 7));
  const db = getDb();
  const transaction = await db.paymentTransaction.findUnique({ where: { id } });
  if (!transaction || refundAmountCents <= 0) {
    redirect("/admin/billing/dashboard?error=refund");
  }

  const refundedAmountCents = Math.min(transaction.grossAmountCents, transaction.refundedAmountCents + refundAmountCents);
  const status = refundedAmountCents >= transaction.grossAmountCents ? "refunded" : "partially_refunded";

  const updated = await db.$transaction(async (tx) => {
    await tx.refundRecord.create({
      data: {
        vendorId: transaction.vendorId,
        paymentTransactionId: transaction.id,
        monthKey,
        refundAmountCents,
        gatewayFeeRefundCents,
        platformFeeRefundCents,
        reason,
      },
    });
    return tx.paymentTransaction.update({
      where: { id },
      data: {
        status,
        refundedAmountCents,
        refundReason: reason,
        refundedAt: new Date(),
      },
    });
  });

  await writeAuditLog({
    vendorId: transaction.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "refund_payment_transaction",
    targetType: "PaymentTransaction",
    targetId: transaction.id,
    before: auditSnapshot(transaction),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/dashboard");
}

export async function voidAffiliateCommissionAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const reason = optionalText(formData, "reason");
  const commission = await getDb().affiliateCommission.findUnique({ where: { id } });
  if (!commission || commission.status === "paid") {
    redirect("/admin/billing/dashboard?error=commission");
  }

  const updated = await getDb().affiliateCommission.update({
    where: { id },
    data: {
      status: "void",
      commissionAmountCents: 0,
      settledAt: new Date(),
      sourceType: reason ? `${commission.sourceType}: ${reason}` : commission.sourceType,
    },
  });

  await writeAuditLog({
    vendorId: commission.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "void_affiliate_commission",
    targetType: "AffiliateCommission",
    targetId: commission.id,
    before: auditSnapshot(commission),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/affiliates/commissions");
  redirect("/admin/billing/dashboard");
}

export async function retryWebhookEventAction(formData: FormData) {
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const event = await getDb().webhookEvent.findUnique({ where: { id } });
  if (!event) {
    redirect("/admin/billing/dashboard?error=webhook");
  }
  if (event.retryCount >= event.maxRetries) {
    redirect("/admin/billing/dashboard?error=max_retries");
  }
  await retryWebhookEvent(id, member.role);

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/webhooks");
  revalidatePath(`/admin/billing/webhooks/${id}`);
  redirect("/admin/billing/dashboard");
}
