"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { requireVendorOwner } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { unprotectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import {
  LineRichMenuSchema,
  createLineRichMenu,
  clearDefaultLineRichMenu,
  deleteLineRichMenu,
  generateRichMenuSvg,
  replaceRichMenuPlaceholders,
  setDefaultLineRichMenu,
  uploadLineRichMenuImage,
  type LineRichMenu,
  type LineRichMenuTemplateType,
} from "@/lib/line-rich-menu";

const SETTINGS_PATH = "/settings/line";
const MAX_CUSTOM_IMAGE_BYTES = 10 * 1024 * 1024;

export type RichMenuActionState = {
  status: "idle" | "saved" | "published" | "deleted" | "error";
  error: "invalid_input" | "not_configured" | "not_found" | "provider_failed" | "save_failed" | null;
};

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseDraft(formData: FormData): { id?: string; templateType: LineRichMenuTemplateType; menu: LineRichMenu } | null {
  try {
    const templateType = text(formData, "templateType");
    if (templateType !== "golden-6" && templateType !== "minimal-4") return null;
    const parsed = LineRichMenuSchema.safeParse(JSON.parse(text(formData, "menu")));
    if (!parsed.success) return null;
    const id = text(formData, "id");
    return { ...(id ? { id } : {}), templateType, menu: parsed.data };
  } catch {
    return null;
  }
}

async function resolveMenu(auth: Awaited<ReturnType<typeof requireVendorOwner>>, draft: ReturnType<typeof parseDraft>) {
  if (!draft) return null;
  const base = getCanonicalAppUrl();
  const db = getDb();
  const latestLive = await db.live.findFirst({
    where: { vendorId: auth.vendor.id },
    orderBy: [{ isEvergreen: "desc" }, { scheduledAt: "desc" }],
    select: { slug: true },
  });
  const portal = new URL(`/portal/${encodeURIComponent(auth.vendor.slug)}`, base);
  const live = latestLive ? new URL(`/live/${encodeURIComponent(latestLive.slug)}`, base) : portal;
  return replaceRichMenuPlaceholders(draft.menu, {
    live_url: live.toString(),
    consultation_url: `${portal.toString()}#consultations`,
    portal_url: portal.toString(),
    voucher_url: `${portal.toString()}#vouchers`,
  });
}

export async function saveRichMenuDraftAction(_previous: RichMenuActionState, formData: FormData): Promise<RichMenuActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const draft = parseDraft(formData);
  if (!draft) return { status: "error", error: "invalid_input" };
  try {
    const configuration = { name: draft.menu.name, templateType: draft.templateType, chatBarText: draft.menu.chatBarText, areas: draft.menu.areas };
    if (draft.id) {
      // Preserve provider/default state until a replacement has fully published.
      const result = await getDb().lineRichMenu.updateMany({ where: { id: draft.id, vendorId: auth.vendor.id }, data: configuration });
      if (result.count !== 1) return { status: "error", error: "not_found" };
    } else {
      await getDb().lineRichMenu.create({ data: { vendorId: auth.vendor.id, ...configuration, status: "draft", isDefault: false } });
    }
    revalidatePath(SETTINGS_PATH);
    return { status: "saved", error: null };
  } catch {
    return { status: "error", error: "save_failed" };
  }
}

export async function publishRichMenuToLineAction(_previous: RichMenuActionState, formData: FormData): Promise<RichMenuActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const draft = parseDraft(formData);
  const menu = await resolveMenu(auth, draft);
  if (!draft || !menu) return { status: "error", error: "invalid_input" };
  const account = await getDb().lineOfficialAccount.findUnique({ where: { vendorId: auth.vendor.id } });
  if (!account) return { status: "error", error: "not_configured" };

  const previous = draft.id ? await getDb().lineRichMenu.findFirst({ where: { id: draft.id, vendorId: auth.vendor.id }, select: { providerRichMenuId: true, isDefault: true } }) : null;
  let providerRichMenuId: string | null = null;
  let token = "";
  try {
    token = unprotectLineOfficialAccountCredentials(auth.vendor.id, account).messagingAccessToken;
    const uploaded = formData.get("image");
    let source: Buffer;
    if (uploaded instanceof File && uploaded.size > 0) {
      if (uploaded.size > MAX_CUSTOM_IMAGE_BYTES || !["image/png", "image/jpeg"].includes(uploaded.type)) return { status: "error", error: "invalid_input" };
      source = Buffer.from(await uploaded.arrayBuffer());
    } else {
      source = generateRichMenuSvg(menu);
    }
    const png = await sharp(source).resize(menu.size.width, menu.size.height, { fit: "fill" }).png({ compressionLevel: 9, palette: true }).toBuffer();
    if (png.byteLength > 1024 * 1024) return { status: "error", error: "invalid_input" };
    providerRichMenuId = (await createLineRichMenu(token, menu)).richMenuId;
    await uploadLineRichMenuImage(token, providerRichMenuId, png, "image/png");
    await setDefaultLineRichMenu(token, providerRichMenuId);

    await getDb().$transaction(async (tx) => {
      await tx.lineRichMenu.updateMany({ where: { vendorId: auth.vendor.id, isDefault: true }, data: { isDefault: false } });
      const data = { name: menu.name, templateType: draft.templateType, chatBarText: menu.chatBarText, areas: menu.areas, providerRichMenuId, isDefault: true, status: "published", syncedAt: new Date() };
      if (draft.id) {
        const result = await tx.lineRichMenu.updateMany({ where: { id: draft.id, vendorId: auth.vendor.id }, data });
        if (result.count !== 1) throw new Error("not_found");
      } else await tx.lineRichMenu.create({ data: { vendorId: auth.vendor.id, ...data } });
    });
    if (previous?.providerRichMenuId && previous.providerRichMenuId !== providerRichMenuId) {
      // Old non-default provider menus are best-effort cleanup; the new state is already durable.
      await deleteLineRichMenu(token, previous.providerRichMenuId).catch(() => undefined);
    }
    revalidatePath(SETTINGS_PATH);
    return { status: "published", error: null };
  } catch {
    if (providerRichMenuId && token) {
      if (previous?.isDefault && previous.providerRichMenuId) await setDefaultLineRichMenu(token, previous.providerRichMenuId).catch(() => undefined);
      await deleteLineRichMenu(token, providerRichMenuId).catch(() => undefined);
    }
    return { status: "error", error: "provider_failed" };
  }
}

export async function deleteRichMenuAction(_previous: RichMenuActionState, formData: FormData): Promise<RichMenuActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "id");
  if (!id) return { status: "error", error: "invalid_input" };
  const menu = await getDb().lineRichMenu.findFirst({ where: { id, vendorId: auth.vendor.id } });
  if (!menu) return { status: "error", error: "not_found" };
  try {
    if (menu.providerRichMenuId) {
      const account = await getDb().lineOfficialAccount.findUnique({ where: { vendorId: auth.vendor.id } });
      if (!account) return { status: "error", error: "not_configured" };
      const token = unprotectLineOfficialAccountCredentials(auth.vendor.id, account).messagingAccessToken;
      if (menu.isDefault) await clearDefaultLineRichMenu(token);
      await deleteLineRichMenu(token, menu.providerRichMenuId);
    }
    const result = await getDb().lineRichMenu.deleteMany({ where: { id, vendorId: auth.vendor.id } });
    if (result.count !== 1) return { status: "error", error: "not_found" };
    revalidatePath(SETTINGS_PATH);
    return { status: "deleted", error: null };
  } catch {
    return { status: "error", error: "provider_failed" };
  }
}
