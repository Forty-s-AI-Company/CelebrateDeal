import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { isStagingDatabaseUrl } from "./database-identity";
import { hashPasswordAsync, verifyPasswordAsync } from "./password";

export const QA_FINANCE_ID = "q1_synthetic_platform_finance_v1";
export const QA_FINANCE_EMAIL = "q1-synthetic-finance-v1@invalid.example";
const NAME = "Q1 Synthetic Sandbox Finance";
export const QA_FINANCE_CA_FILE = "supabase-public-ca-2021.crt";
// Public root published by Supabase Studio's ssl:certificate_url configuration.
// https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json
// https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
// Pin the reviewed bytes so CI cannot silently trust a substituted certificate.
const CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
const rejected = () => new Error("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");

export function verifyQaFinanceCertificate(bytes: Uint8Array) {
  if (createHash("sha256").update(bytes).digest("hex") !== CA_SHA256) throw rejected();
}

/** Closed categories only: never expose a database message, URL or error metadata. */
export function qaFinanceFailureCategory(error: unknown) {
  if (!error || typeof error !== "object") return "ACCOUNT_OR_DATABASE_REJECTED";
  const categories: Record<string, string> = {
    P1000: "DATABASE_AUTHENTICATION", P1001: "DATABASE_UNREACHABLE", P1002: "DATABASE_TIMEOUT",
    P1011: "DATABASE_TLS", P2024: "DATABASE_POOL_TIMEOUT", P2021: "DATABASE_SCHEMA_MISSING",
    P2022: "DATABASE_SCHEMA_MISSING", P2002: "ACCOUNT_CONFLICT",
  };
  const code = "code" in error && typeof error.code === "string" ? error.code
    : "errorCode" in error && typeof error.errorCode === "string" ? error.errorCode : undefined;
  return code && Object.hasOwn(categories, code)
    ? categories[code] ?? "ACCOUNT_OR_DATABASE_REJECTED" : "ACCOUNT_OR_DATABASE_REJECTED";
}

export class QaFinanceBootstrapFailure extends Error {
  constructor(public readonly category: string) { super("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED"); }
}

/** Prisma honors query host overrides. Permit only bounded operational options,
 * and force encrypted, certificate-verified transport without logging the URL.
 */
export function qaFinanceDatabaseUrl(value: string) {
  try {
    if (!isStagingDatabaseUrl(value)) throw rejected();
    const url = new URL(value);
    if (url.pathname !== "/postgres" || url.hash || !["", "5432", "6543"].includes(url.port)) throw rejected();
    const allowed = new Set(["schema", "pgbouncer", "connection_limit", "pool_timeout", "connect_timeout",
      "socket_timeout", "statement_cache_size", "sslmode", "sslaccept", "sslcert"]);
    const seen = new Set<string>();
    for (const [key, option] of url.searchParams) {
      if (!allowed.has(key) || seen.has(key)) throw rejected();
      seen.add(key);
      if (key === "sslmode" && option !== "require") throw rejected();
      if (key === "sslaccept" && option !== "strict") throw rejected();
      if (key === "sslcert" && option !== QA_FINANCE_CA_FILE) throw rejected();
      if (key === "schema" && option !== "public") throw rejected();
      if (key === "pgbouncer" && !["true", "false"].includes(option)) throw rejected();
      if (!["schema", "pgbouncer", "sslmode", "sslaccept", "sslcert"].includes(key) && !/^\d{1,5}$/.test(option)) throw rejected();
    }
    url.searchParams.set("sslmode", "require");
    url.searchParams.set("sslaccept", "strict");
    url.searchParams.set("sslcert", QA_FINANCE_CA_FILE);
    return url.href;
  } catch { throw rejected(); }
}

/** Creates one fixed synthetic account only after the caller's runtime preflight.
 * Never promotes an existing user, resets a password, or removes an MFA factor.
 * All credentials remain inside the approved process; output is a closed enum.
 */
export async function ensureStagingQaFinance(
  db: PrismaClient,
  input: { databaseUrl: string; sourceSha: string; password: string; runtimeReady: boolean; payuniEnv: string },
) {
  qaFinanceDatabaseUrl(input.databaseUrl);
  if (!/^[a-f0-9]{40}$/.test(input.sourceSha)
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
  } catch (error) {
    // No raw Prisma diagnostics or account credentials escape this boundary.
    throw new QaFinanceBootstrapFailure(qaFinanceFailureCategory(error));
  }
}
