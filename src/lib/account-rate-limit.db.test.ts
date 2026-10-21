import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  ACCOUNT_LOCKS,
  ACCOUNT_RATE_LIMITS,
  accountLockRemainingSeconds,
  accountRateLimitKeyHash,
  lockAccount,
  checkAccountRateLimit,
  consumeAccountRateLimit,
} from "@/lib/account-rate-limit";
import { checkRateLimit } from "@/lib/rate-limit";

// F-028 / B02-05: account limits count in PostgreSQL and ignore
// RATE_LIMIT_PROVIDER and the caller's IP.
const keys: string[] = [];

function subject(label: string) {
  const value = `${label}-${randomUUID()}`;
  return value;
}

function track(scope: keyof typeof ACCOUNT_RATE_LIMITS | keyof typeof ACCOUNT_LOCKS, value: string) {
  keys.push(accountRateLimitKeyHash(scope, value));
  return value;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await getDb().accountRateLimitBucket.deleteMany({ where: { keyHash: { in: keys.splice(0) } } });
});

describe("account rate limit (PostgreSQL)", () => {
  it("allows exactly the configured attempts per window, then blocks with a retry hint", async () => {
    const user = track("mfa_verification", subject("user"));
    const decisions = [];
    for (let attempt = 0; attempt < 7; attempt += 1) decisions.push(await consumeAccountRateLimit("mfa_verification", user));

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, true, true, false, false]);
    expect(decisions.map((decision) => decision.count)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(decisions[6]!.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(decisions[6]!.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("still blocks per account when the IP layer is delegated to Cloudflare WAF", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
    const user = track("mfa_verification", subject("waf"));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Each attempt from a different source IP passes the IP layer.
      const request = new Request("https://app.example.test", { headers: { "cf-connecting-ip": `198.51.100.${attempt}` } });
      expect(await checkRateLimit(request, `mfa-verification:${user}`, 5, 60_000)).toBeNull();
      expect(await checkAccountRateLimit("mfa_verification", user)).toBeNull();
    }

    const blocked = await checkAccountRateLimit("mfa_verification", user);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("starts a new window once the previous one has elapsed", async () => {
    const user = track("mfa_recovery_regeneration", subject("window"));
    for (let attempt = 0; attempt < 4; attempt += 1) await consumeAccountRateLimit("mfa_recovery_regeneration", user);
    expect((await consumeAccountRateLimit("mfa_recovery_regeneration", user)).allowed).toBe(false);

    await getDb().accountRateLimitBucket.update({
      where: { keyHash: accountRateLimitKeyHash("mfa_recovery_regeneration", user) },
      data: { windowStartedAt: new Date(Date.now() - ACCOUNT_RATE_LIMITS.mfa_recovery_regeneration.windowMs - 1_000) },
    });

    expect(await consumeAccountRateLimit("mfa_recovery_regeneration", user)).toMatchObject({ allowed: true, count: 1 });
  });

  it("keeps scopes and subjects independent", async () => {
    const user = track("mfa_verification", subject("independent"));
    track("payout_account_step_up", user);
    const other = track("mfa_verification", subject("other"));
    for (let attempt = 0; attempt < 6; attempt += 1) await consumeAccountRateLimit("mfa_verification", user);

    expect((await consumeAccountRateLimit("mfa_verification", user)).allowed).toBe(false);
    expect((await consumeAccountRateLimit("payout_account_step_up", user)).allowed).toBe(true);
    expect((await consumeAccountRateLimit("mfa_verification", other)).allowed).toBe(true);
  });

  it("counts concurrent attempts atomically", async () => {
    const user = track("mfa_verification", subject("concurrent"));
    const decisions = await Promise.all(Array.from({ length: 12 }, () => consumeAccountRateLimit("mfa_verification", user)));

    expect(decisions.map((decision) => decision.count).sort((left, right) => left - right)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });

  it("stores only a hash of the subject, never an e-mail address", async () => {
    const email = track("password_reset_request", `${subject("reset")}@example.test`);
    await consumeAccountRateLimit("password_reset_request", email);

    const rows = await getDb().$queryRaw<Array<{ row: string }>>`
      SELECT row_to_json(bucket)::text AS row FROM "AccountRateLimitBucket" AS bucket
       WHERE "keyHash" = ${accountRateLimitKeyHash("password_reset_request", email)}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.row).not.toContain(email);
    expect(rows[0]!.row).not.toContain("@example.test");
  });

  it("sweeps buckets idle for more than a day when a new bucket is created", async () => {
    const stale = track("password_reset_request", subject("stale"));
    await consumeAccountRateLimit("password_reset_request", stale);
    await getDb().accountRateLimitBucket.update({
      where: { keyHash: accountRateLimitKeyHash("password_reset_request", stale) },
      data: { updatedAt: new Date(Date.now() - 25 * 60 * 60_000), windowStartedAt: new Date(Date.now() - 25 * 60 * 60_000) },
    });

    await consumeAccountRateLimit("password_reset_request", track("password_reset_request", subject("fresh")));

    expect(await getDb().accountRateLimitBucket.count({ where: { keyHash: accountRateLimitKeyHash("password_reset_request", stale) } })).toBe(0);
  });

  it("caps login attempts per address at 10 per 15 minutes (#462 m4)", async () => {
    const email = track("login_account", `${subject("login")}@example.test`);
    const decisions = [];
    for (let attempt = 0; attempt < 11; attempt += 1) decisions.push(await consumeAccountRateLimit("login_account", email));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(10);
    expect(decisions.at(-1)?.allowed).toBe(false);
  });

  it("allows 50 failed MFA verifications a day, then a lock holds for one hour (#462 m3)", async () => {
    const user = track("mfa_verification_failures", subject("totp"));
    track("mfa_verification_lock", user);
    for (let attempt = 0; attempt < 50; attempt += 1) expect((await consumeAccountRateLimit("mfa_verification_failures", user)).allowed).toBe(true);
    expect((await consumeAccountRateLimit("mfa_verification_failures", user)).allowed).toBe(false);

    expect(await accountLockRemainingSeconds("mfa_verification_lock", user)).toBe(0);
    await lockAccount("mfa_verification_lock", user);
    const remaining = await accountLockRemainingSeconds("mfa_verification_lock", user);
    expect(remaining).toBeGreaterThan(3590);
    expect(remaining).toBeLessThanOrEqual(3600);

    // An expired lock no longer applies.
    await getDb().accountRateLimitBucket.update({
      where: { keyHash: accountRateLimitKeyHash("mfa_verification_lock", user) },
      data: { windowStartedAt: new Date(Date.now() - ACCOUNT_LOCKS.mfa_verification_lock.durationMs - 1_000) },
    });
    expect(await accountLockRemainingSeconds("mfa_verification_lock", user)).toBe(0);
  });

  it("fails closed with 503 when the counter cannot be written", async () => {
    const broken = {
      $queryRaw: () => Promise.reject(new Error("synthetic database outage")),
      $executeRaw: () => Promise.reject(new Error("synthetic database outage")),
    } as unknown as Parameters<typeof checkAccountRateLimit>[2];

    const response = await checkAccountRateLimit("mfa_verification", subject("outage"), broken);
    expect(response?.status).toBe(503);
  });

  it("rejects writes that bypass the module's invariants", async () => {
    await expect(getDb().$executeRaw`
      INSERT INTO "AccountRateLimitBucket" ("keyHash", "scope", "windowStartedAt", "count", "updatedAt")
      VALUES ('not-a-hash', 'mfa_verification', now(), 1, now())`).rejects.toThrow();
    const keyHash = accountRateLimitKeyHash("mfa_verification", subject("zero"));
    await expect(getDb().$executeRaw`
      INSERT INTO "AccountRateLimitBucket" ("keyHash", "scope", "windowStartedAt", "count", "updatedAt")
      VALUES (${keyHash}, 'mfa_verification', now(), 0, now())`).rejects.toThrow();
  });
});
