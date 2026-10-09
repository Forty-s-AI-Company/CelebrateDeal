import type { PrismaClient } from "@prisma/client";
import { isStagingDatabaseUrl } from "./database-identity";
import { hashPasswordAsync, verifyPasswordAsync } from "./password";

export const QA_FINANCE_ID = "q1_synthetic_platform_finance_v1";
export const QA_FINANCE_EMAIL = "q1-synthetic-finance-v1@invalid.example";
const NAME = "Q1 Synthetic Sandbox Finance";
const rejected = () => new Error("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");

/** Creates one fixed synthetic account only after the caller's runtime preflight.
 * Never promotes an existing user, resets a password, or removes an MFA factor.
 * All credentials remain inside the approved process; output is a closed enum.
 */
export async function ensureStagingQaFinance(
  db: PrismaClient,
  input: { databaseUrl: string; sourceSha: string; password: string; runtimeReady: boolean; payuniEnv: string },
) {
  if (!isStagingDatabaseUrl(input.databaseUrl) || !/^[a-f0-9]{40}$/.test(input.sourceSha)
    || input.payuniEnv !== "sandbox" || input.runtimeReady !== true || input.password.length < 24
    || input.password.length > 256) throw rejected();
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { OR: [{ id: QA_FINANCE_ID }, { email: QA_FINANCE_EMAIL }] },
        select: { id: true, email: true, name: true, status: true, platformRole: true, passwordHash: true },
      });
      if (existing) {
        if (existing.id !== QA_FINANCE_ID || existing.email !== QA_FINANCE_EMAIL || existing.name !== NAME
          || existing.status !== "active" || existing.platformRole !== "platform_admin"
          || !await verifyPasswordAsync(input.password, existing.passwordHash)) throw rejected();
        return { email: QA_FINANCE_EMAIL, outcome: "EXISTING_VERIFIED" as const };
      }
      await tx.user.create({ data: { id: QA_FINANCE_ID, email: QA_FINANCE_EMAIL, name: NAME,
        status: "active", platformRole: "platform_admin", passwordHash: await hashPasswordAsync(input.password) } });
      await tx.auditLog.create({ data: { actorId: QA_FINANCE_ID, actorLabel: "q1-synthetic-bootstrap",
        action: "staging_qa_finance_created", targetType: "User", targetId: QA_FINANCE_ID,
        after: { synthetic: true, sourceSha: input.sourceSha } } });
      return { email: QA_FINANCE_EMAIL, outcome: "CREATED" as const };
    });
  } catch {
    // No raw Prisma diagnostics or account credentials escape this boundary.
    throw rejected();
  }
}
