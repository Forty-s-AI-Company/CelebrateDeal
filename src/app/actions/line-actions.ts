"use server";

import { revalidatePath } from "next/cache";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  parseLineOfficialAccountCredentials,
  protectLineOfficialAccountCredentials,
} from "@/lib/line-credentials";

const LINE_SETTINGS_PATH = "/settings/line";

export type LineOfficialAccountActionState = {
  status: "idle" | "saved" | "error";
  error: "invalid_credentials" | "save_failed" | null;
};

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
