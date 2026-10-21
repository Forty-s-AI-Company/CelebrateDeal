import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Account-level rate limits (F-028 / B02-05).
 *
 * `checkRateLimit` in `@/lib/rate-limit` is the IP layer: it keys on the
 * client address and is skipped entirely when RATE_LIMIT_PROVIDER is
 * `cloudflare_waf`, because the WAF counts per source IP in front of the app.
 * A WAF cannot count per account, so limits that protect one account or one
 * recipient (TOTP guessing, recovery-code regeneration, magic links, member
 * invitations, password reset mail) live here instead: a PostgreSQL counter
 * that ignores RATE_LIMIT_PROVIDER and the caller's IP.
 *
 * Keys are SHA-256 of scope + subject, so e-mail addresses never reach the
 * table in clear. Counting uses the database clock in a single atomic upsert
 * (fixed window). A database error fails closed (503).
 */
export const ACCOUNT_RATE_LIMITS = {
  mfa_verification: { limit: 5, windowMs: 60_000 },
  mfa_recovery_regeneration: { limit: 3, windowMs: 15 * 60_000 },
  payout_account_step_up: { limit: 5, windowMs: 15 * 60_000 },
  student_portal_magic_link: { limit: 3, windowMs: 15 * 60_000 },
  vendor_member_invitation_vendor: { limit: 5, windowMs: 60_000 },
  vendor_member_invitation_recipient: { limit: 3, windowMs: 60 * 60_000 },
  password_reset_request: { limit: 3, windowMs: 15 * 60_000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>;

export type AccountRateLimitScope = keyof typeof ACCOUNT_RATE_LIMITS;

// Buckets idle for a day are deleted a few at a time whenever a new bucket is
// created, so the table cannot grow without bound from random subjects.
const STALE_BUCKET_MS = 24 * 60 * 60_000;
const STALE_BUCKET_SWEEP = 50;

export type AccountRateLimitDecision = { allowed: boolean; count: number; retryAfterSeconds: number };

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export function accountRateLimitKeyHash(scope: AccountRateLimitScope, subject: string) {
  return createHash("sha256").update(`celebratedeal:account-rate-limit:v1\u0000${scope}\u0000${subject}`).digest("hex");
}

/** Counts one attempt for `subject` and reports whether it is within the limit. */
export async function consumeAccountRateLimit(
  scope: AccountRateLimitScope,
  subject: string,
  db: RawClient = getDb(),
): Promise<AccountRateLimitDecision> {
  if (!subject) throw new Error("account rate limit subject is required");
  const { limit, windowMs } = ACCOUNT_RATE_LIMITS[scope];
  const keyHash = accountRateLimitKeyHash(scope, subject);
  // Prisma maps DateTime to timestamp(3) holding UTC, so the database clock is
  // read in UTC. EXCLUDED carries the statement's "now" into the update arm.
  const rows = await db.$queryRaw<Array<{ count: number; retryAfterSeconds: number; created: boolean }>>`
    INSERT INTO "AccountRateLimitBucket" AS bucket ("keyHash", "scope", "windowStartedAt", "count", "updatedAt")
    VALUES (${keyHash}, ${scope}, (now() AT TIME ZONE 'UTC'), 1, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE
        WHEN bucket."windowStartedAt" <= EXCLUDED."windowStartedAt" - (${windowMs}::double precision * interval '1 millisecond')
          THEN 1
        ELSE bucket."count" + 1
      END,
      "windowStartedAt" = CASE
        WHEN bucket."windowStartedAt" <= EXCLUDED."windowStartedAt" - (${windowMs}::double precision * interval '1 millisecond')
          THEN EXCLUDED."windowStartedAt"
        ELSE bucket."windowStartedAt"
      END,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING
      "count",
      EXTRACT(EPOCH FROM ("windowStartedAt" + (${windowMs}::double precision * interval '1 millisecond') - "updatedAt"))::double precision AS "retryAfterSeconds",
      (xmax = 0) AS "created"`;
  const row = rows[0];
  if (!row) throw new Error("account rate limit returned no row");
  const count = Number(row.count);

  if (row.created) {
    try {
      await db.$executeRaw`
        DELETE FROM "AccountRateLimitBucket"
         WHERE "keyHash" IN (
           SELECT "keyHash" FROM "AccountRateLimitBucket"
            WHERE "updatedAt" < (now() AT TIME ZONE 'UTC') - (${STALE_BUCKET_MS}::double precision * interval '1 millisecond')
            ORDER BY "updatedAt"
            LIMIT ${STALE_BUCKET_SWEEP}
         )`;
    } catch {
      // Best effort; a failed sweep never changes the decision.
    }
  }

  return {
    allowed: count <= limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retryAfterSeconds))),
  };
}

/**
 * Same contract as `checkRateLimit`: `null` when allowed, a 429 response when
 * the account is over its limit, and a 503 response when the counter cannot
 * be read (fail closed).
 */
export async function checkAccountRateLimit(scope: AccountRateLimitScope, subject: string, db?: RawClient) {
  let decision: AccountRateLimitDecision;
  try {
    decision = await consumeAccountRateLimit(scope, subject, db);
  } catch {
    return NextResponse.json(
      { error: "Rate limit provider unavailable" },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  if (decision.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
  );
}
