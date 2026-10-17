"use server";

import { revalidatePath } from "next/cache";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { parseRichMenuDraftContent } from "@/lib/line-rich-menu-draft-content";
import { richMenuAccountVersion } from "@/lib/line-rich-menu-sync";
import { findLineAccount } from "@/lib/line-account-routing";
import {
  parseLineOfficialAccountCredentials,
  protectLineOfficialAccountCredentials,
  unprotectLineOfficialAccountCredentials,
} from "@/lib/line-credentials";

const LINE_SETTINGS_PATH = "/settings/line";

export type LineOfficialAccountActionState = {
  status: "idle" | "saved" | "error";
  error: "invalid_credentials" | "save_failed" | "sync_pending" | null;
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

async function ownedAccountsForSave(tx:Prisma.TransactionClient,vendorId:string,accountId:string,credentials:Parameters<typeof protectLineOfficialAccountCredentials>[1]) {
      const existing = accountId ? await findLineAccount(tx, vendorId, accountId) : null;
      if (accountId && !existing) throw new Error("invalid_account");
      const accounts = await tx.lineOfficialAccount.findMany({ where: { vendorId: vendorId } });
      for (const candidate of accounts) {
        const old = unprotectLineOfficialAccountCredentials(vendorId, candidate);
        // Updating credentials may rotate a secret, but cannot change channel identity.
        if (candidate.id === accountId) {
          if (old.messagingChannelId !== credentials.messagingChannelId || (old.loginChannelId && old.loginChannelId !== credentials.loginChannelId)) throw new Error("invalid_account");
        } else if (old.messagingChannelId === credentials.messagingChannelId || (old.loginChannelId && old.loginChannelId === credentials.loginChannelId)) throw new Error("duplicate_channel");
      }
  return {existing,accounts};
}

/** Owner-only mutation; no credential value is returned, logged, or written to audit metadata. */
export async function saveLineOfficialAccountAction(
  _previous: LineOfficialAccountActionState,
  formData: FormData,
): Promise<LineOfficialAccountActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const accountId = optionalFormText(formData, "accountId");
  const displayName = optionalFormText(formData, "displayName");
  if (accountId.length > 128 || !displayName || displayName.length > 100) return { status: "error", error: "invalid_credentials" };
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
    account = await getDb().$transaction(async tx=>{
      const {existing,accounts} = await ownedAccountsForSave(tx,auth.vendor.id,accountId,parsed.data);
      const draft = existing ? await tx.lineRichMenuDraft.findFirst({where:{vendorId:auth.vendor.id,lineOfficialAccountId:existing.id}}) : null;
      const content=draft&&parseRichMenuDraftContent(draft.menu);
      if(draft&&!content)throw new Error("line_sync_pending");
      const publication=content?.publication;
      if(publication?.status==="syncing")throw new Error("line_sync_pending");
      if(publication?.status==="uncertain") {
        // An expired provider value may be rotated for the SAME channel so an
        // unknown result can be reconciled. A channel switch stays blocked.
        const old=existing;
        if(!old||unprotectLineOfficialAccountCredentials(auth.vendor.id,old).messagingChannelId!==parsed.data.messagingChannelId)throw new Error("line_sync_pending");
      }
      const data = { ...protectedCredentials, displayName, status: "active", connectedAt: new Date(), lastValidatedAt: null };
      const select = { id: true, status: true, connectedAt: true } as const;
      const saved = existing
        ? await tx.lineOfficialAccount.update({ where: { vendorId_id: { vendorId: auth.vendor.id, id: existing.id } }, data, select })
        : await tx.lineOfficialAccount.create({ data: { vendorId: auth.vendor.id, ...data, isDefault: accounts.length === 0 }, select });
      // Preserve a pre-integration draft when the merchant adds their first account.
      if (!existing && accounts.length === 0) await tx.lineRichMenuDraft.updateMany({ where: { vendorId: auth.vendor.id, lineOfficialAccountId: null }, data: { lineOfficialAccountId: saved.id } });
      if(draft&&content&&publication) {
        const next={...publication,status:publication.status==="uncertain"?"uncertain" as const:"outdated" as const,accountVersion:richMenuAccountVersion({id:saved.id,...protectedCredentials})};
        const changed=await tx.lineRichMenuDraft.updateMany({where:{id:draft.id,vendorId:auth.vendor.id,revision:draft.revision,menu:{equals:draft.menu as Prisma.InputJsonValue}},data:{revision:{increment:1},menu:{...content,publication:next} as Prisma.InputJsonValue}});
        if(changed.count!==1)throw new Error("line_sync_pending");
      }
      return saved;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  } catch(error) {
    return { status: "error", error: error instanceof Error&&error.message==="line_sync_pending"?"sync_pending":"save_failed" };
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
  const accountId = optionalFormText(formData, "accountId");
  if (!accountId || accountId.length > 128) return { status: "error", error: "not_configured", bot: null };
  const account = await getDb().lineOfficialAccount.findUnique({
    where: { vendorId_id: { vendorId: auth.vendor.id, id: accountId } },
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
    const validated = await getDb().lineOfficialAccount.updateMany({
      where: { vendorId: auth.vendor.id, id: account.id, messagingChannelIdEncrypted:account.messagingChannelIdEncrypted, messagingChannelSecretEncrypted:account.messagingChannelSecretEncrypted, messagingAccessTokenEncrypted:account.messagingAccessTokenEncrypted, loginChannelIdEncrypted:account.loginChannelIdEncrypted, loginChannelSecretEncrypted:account.loginChannelSecretEncrypted },
      data: { lastValidatedAt: new Date() },
    });
    if(validated.count !== 1) return {status:"error",error:"connection_failed",bot:null};
    revalidatePath(LINE_SETTINGS_PATH);
    return { status: "validated", error: null, bot };
  } catch {
    // Provider/network/decryption details must not cross the action boundary.
    return { status: "error", error: "connection_failed", bot: null };
  }
}
