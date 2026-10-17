import { createHash } from "node:crypto";
import type { LineOfficialAccount, PrismaClient } from "@prisma/client";

export type LineAccountRoutingDatabase = Pick<PrismaClient, "lineOfficialAccount" | "salesProject" | "formSubmission" | "commerceOrder">;

/** An explicit account never falls back to another account or another tenant. */
export function findLineAccount(db: Pick<PrismaClient, "lineOfficialAccount">, vendorId: string, accountId?: string) {
  return db.lineOfficialAccount.findFirst({ where: { vendorId, ...(accountId ? { id: accountId } : { isDefault: true }) } });
}

/** Resolve from authoritative domain records, never a posted project/account ID. */
export async function resolveSubjectLineAccount(db: LineAccountRoutingDatabase, vendorId: string, subjectType: string, subjectId: string) {
  let projectId: string | null = null;
  if (subjectType === "buyer_registration") {
    const row = await db.formSubmission.findFirst({ where: { id: subjectId, form: { vendorId } }, select: { form: {select:{projectId:true}}, live:{select:{vendorId:true,projectId:true}} } });
    if (!row) return null;
    if (row.live && (row.live.vendorId !== vendorId || (row.form.projectId && row.live.projectId && row.form.projectId !== row.live.projectId))) return null;
    projectId = row.live?.projectId ?? row.form.projectId;
  } else if (subjectType === "buyer_order") {
    const row = await db.commerceOrder.findFirst({ where: { id: subjectId, vendorId }, select: { projectId: true } });
    if (!row) return null;
    projectId = row.projectId;
  } else if (!["user", "promoter", "login"].includes(subjectType)) return null;
  if (!projectId) return findLineAccount(db, vendorId);
  const project = await db.salesProject.findFirst({ where: { id: projectId, vendorId }, select: { lineOfficialAccountId: true } });
  // A new/unconfigured project must not silently send through the default account.
  return project?.lineOfficialAccountId ? findLineAccount(db, vendorId, project.lineOfficialAccountId) : null;
}

/** Pins pending OAuth to the exact encrypted credentials; rotation requires restart. */
export function lineLoginAccountVersion(account: Pick<LineOfficialAccount, "id" | "loginChannelIdEncrypted" | "loginChannelSecretEncrypted">) {
  return createHash("sha256").update(JSON.stringify([account.id, account.loginChannelIdEncrypted, account.loginChannelSecretEncrypted])).digest("hex");
}
