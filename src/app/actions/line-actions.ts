"use server";

import { revalidatePath } from "next/cache";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  parseLineOfficialAccountCredentials,
  protectLineOfficialAccountCredentials,
  unprotectLineOfficialAccountCredentials,
} from "@/lib/line-credentials";

const LINE_SETTINGS_PATH = "/settings/line";

export type LineOfficialAccountActionState = {
  status: "idle" | "saved" | "error";
  error: "invalid_credentials" | "save_failed" | null;
};

export type LineConnectionActionState = {
  status: "idle" | "validated" | "error";
  error: "not_configured" | "connection_failed" | null;
  bot: { displayName: string; pictureUrl: string | null } | null;
};

const LINE_BOT_INFO_URL = "https://api.line.me/v2/bot/info";
const LINE_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Call only the non-sensitive LINE bot profile endpoint. The access token is
 * intentionally kept inside this server action and is never returned/logged.
 */
async function fetchLineBotInfo(accessToken: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINE_CONNECTION_TIMEOUT_MS);
  try {
    const response = await fetch(LINE_BOT_INFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("LINE bot info request failed");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("LINE bot info response invalid");
    const record = payload as Record<string, unknown>;
    const displayName = typeof record.displayName === "string" ? record.displayName.trim() : "";
    const rawPictureUrl = typeof record.pictureUrl === "string" ? record.pictureUrl.trim() : "";
    let pictureUrl: string | null = null;
    if (rawPictureUrl) {
      const parsedPictureUrl = new URL(rawPictureUrl);
      if (parsedPictureUrl.protocol !== "https:" || parsedPictureUrl.username || parsedPictureUrl.password) {
        throw new Error("LINE bot info response invalid");
      }
      pictureUrl = parsedPictureUrl.toString();
    }
    if (!displayName || displayName.length > 255 || rawPictureUrl.length > 2_048) {
      throw new Error("LINE bot info response invalid");
    }
    return { displayName, pictureUrl };
  } finally {
    clearTimeout(timeout);
  }
}

function optionalFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Owner-only mutation; no credential value is returned, logged, or written to audit metadata. */
export async function saveLineOfficialAccountAction(
  _previous: LineOfficialAccountActionState,
  formData: FormData,
): Promise<LineOfficialAccountActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const parsed = parseLineOfficialAccountCredentials({
    messagingChannelId: optionalFormText(formData, "messagingChannelId"),
    messagingChannelSecret: optionalFormText(formData, "messagingChannelSecret"),
    messagingAccessToken: optionalFormText(formData, "messagingAccessToken"),
    loginChannelId: optionalFormText(formData, "loginChannelId"),
    loginChannelSecret: optionalFormText(formData, "loginChannelSecret"),
  });
  if (!parsed.success) return { status: "error", error: "invalid_credentials" };

  const protectedCredentials = protectLineOfficialAccountCredentials(auth.vendor.id, parsed.data);
  let account: { id: string; status: string; connectedAt: Date };
  try {
    account = await getDb().lineOfficialAccount.upsert({
      where: { vendorId: auth.vendor.id },
      create: {
        vendorId: auth.vendor.id,
        ...protectedCredentials,
        status: "active",
      },
      update: {
        ...protectedCredentials,
        status: "active",
        connectedAt: new Date(),
        lastValidatedAt: null,
      },
      select: { id: true, status: true, connectedAt: true },
    });
  } catch {
    return { status: "error", error: "save_failed" };
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "save_line_official_account",
    targetType: "LineOfficialAccount",
    targetId: account.id,
    after: auditSnapshot({
      status: account.status,
      connectedAt: account.connectedAt,
      messagingConfigured: true,
      loginConfigured: Boolean(parsed.data.loginChannelId),
    }),
  });
  revalidatePath(LINE_SETTINGS_PATH);
  return { status: "saved", error: null };
}

/** Owner-only, CSRF-protected connection diagnostic for the current vendor. */
export async function testLineOfficialAccountAction(
  _previous: LineConnectionActionState,
  formData: FormData,
): Promise<LineConnectionActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const account = await getDb().lineOfficialAccount.findUnique({
    where: { vendorId: auth.vendor.id },
    select: {
      id: true,
      messagingChannelIdEncrypted: true,
      messagingChannelSecretEncrypted: true,
      messagingAccessTokenEncrypted: true,
      loginChannelIdEncrypted: true,
      loginChannelSecretEncrypted: true,
    },
  });
  if (!account) return { status: "error", error: "not_configured", bot: null };

  try {
    const credentials = unprotectLineOfficialAccountCredentials(auth.vendor.id, account);
    const bot = await fetchLineBotInfo(credentials.messagingAccessToken);
    await getDb().lineOfficialAccount.update({
      where: { vendorId: auth.vendor.id },
      data: { lastValidatedAt: new Date() },
    });
    revalidatePath(LINE_SETTINGS_PATH);
    return { status: "validated", error: null, bot };
  } catch {
    // Provider/network/decryption details must not cross the action boundary.
    return { status: "error", error: "connection_failed", bot: null };
  }
}
