import type { PrismaClient } from "@prisma/client";
import { PrismaClientInitializationError } from "@prisma/client/runtime/library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ensureStagingQaFinance, qaFinanceDatabaseUrl, qaFinanceFailureCategory, QA_FINANCE_EMAIL, QA_FINANCE_ID, verifyQaFinanceCertificate } from "./staging-qa-finance-bootstrap";
import { hashPasswordAsync, verifyPasswordAsync } from "./password";
import { decryptMfaSecret, encryptMfaSecret, totpCodeForTimestamp, verifyRecoveryCode } from "./mfa";
import { qaFinanceTotpCode } from "../../scripts/qa-finance-totp.mjs";

const input = { databaseUrl: "postgresql://synthetic@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres",
  sourceSha: "a".repeat(40), password: "synthetic-test-password-24-characters", runtimeReady: true, payuniEnv: "sandbox" };
function fixture(existing: unknown = null) {
  const tx = { user: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn() }, auditLog: { create: vi.fn() },
    userMfaFactor: { create: vi.fn() }, userRecoveryCode: { deleteMany: vi.fn(), createMany: vi.fn() } };
  const transaction = vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx));
  return { tx, transaction, db: { $transaction: transaction } as unknown as PrismaClient };
}
describe("fixed staging QA finance account", () => {
  it("trusts only the pinned public Supabase CA and rejects substituted bytes", () => {
    const certificate = readFileSync("prisma/supabase-public-ca-2021.crt");
    expect(() => verifyQaFinanceCertificate(certificate)).not.toThrow();
    expect(() => verifyQaFinanceCertificate(Buffer.concat([certificate, Buffer.from("tampered")]))).toThrow("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");
  });
  it("categorizes actual Prisma initialization failures at transaction startup", async () => {
    for (const [code, category] of [["P1000", "DATABASE_AUTHENTICATION"], ["P1001", "DATABASE_UNREACHABLE"],
      ["P1011", "DATABASE_TLS"]]) {
      const f = fixture();
      f.transaction.mockRejectedValue(new PrismaClientInitializationError("private database details", "6.19.3", code));
      await expect(ensureStagingQaFinance(f.db, input)).rejects.toMatchObject({
        message: "STAGING_QA_FINANCE_BOOTSTRAP_REJECTED", category,
      });
      expect(f.tx.user.create).not.toHaveBeenCalled();
    }
  });
  it("categorizes known database failures without copying diagnostic fields", async () => {
    for (const [code, category] of [["P1000", "DATABASE_AUTHENTICATION"], ["P1001", "DATABASE_UNREACHABLE"],
      ["P1011", "DATABASE_TLS"], ["P2021", "DATABASE_SCHEMA_MISSING"], ["P2002", "ACCOUNT_CONFLICT"]]) {
      const f = fixture();
      f.tx.user.findFirst.mockRejectedValue({ code, message: "private database details", meta: { private: true } });
      try { await ensureStagingQaFinance(f.db, input); throw new Error("must reject"); }
      catch (error) {
        expect(error).toMatchObject({ message: "STAGING_QA_FINANCE_BOOTSTRAP_REJECTED", category });
        expect(JSON.stringify(error)).not.toContain("private");
      }
    }
    expect(qaFinanceFailureCategory({ code: "private-code", message: "private" })).toBe("ACCOUNT_OR_DATABASE_REJECTED");
    expect(qaFinanceFailureCategory({ code: "__proto__" })).toBe("ACCOUNT_OR_DATABASE_REJECTED");
  });
  it("upgrades omitted TLS parameters to encryption and strict certificate verification", () => {
    const url = new URL(qaFinanceDatabaseUrl(input.databaseUrl));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("sslaccept")).toBe("strict");
    expect(url.searchParams.get("sslcert")).toBe("supabase-public-ca-2021.crt");
    expect(qaFinanceDatabaseUrl(url.href)).toBe(url.href);
  });
  for (const query of ["host=127.0.0.1", "%68ost=127.0.0.1", "host=foo&host=bar", "sslmode=disable",
    "sslmode=prefer", "sslaccept=accept_invalid_certs", "sslmode=require&sslmode=disable", "schema=private", "sslrootcert=untrusted",
    "sslcert=/tmp/untrusted.crt", "sslcert=../untrusted.crt", "sslcert=supabase-public-ca-2021.crt&sslcert=other"]) {
    it(`rejects overridden identity or TLS downgrade before DB access: ${query}`, async () => {
      const f = fixture();
      await expect(ensureStagingQaFinance(f.db, { ...input, databaseUrl: `${input.databaseUrl}?${query}` })).rejects.toThrow("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");
      expect(f.transaction).not.toHaveBeenCalled();
    });
  }
  for (const override of [{ databaseUrl: "postgresql://synthetic@db.production.supabase.co/postgres" },
    { sourceSha: "invalid" }, { payuniEnv: "production" }, { runtimeReady: false }, { password: "short" }]) {
    it(`rejects unsafe input before database access: ${Object.keys(override)[0]}`, async () => {
      const f = fixture();
      await expect(ensureStagingQaFinance(f.db, { ...input, ...override })).rejects.toThrow("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");
      expect(f.transaction).not.toHaveBeenCalled();
    });
  }
  it("creates only the fixed account with a verifiable hash and sanitized audit", async () => {
    const f = fixture();
    await expect(ensureStagingQaFinance(f.db, input)).resolves.toEqual({ email: QA_FINANCE_EMAIL, outcome: "CREATED", mfa: "ABSENT" });
    const data = f.tx.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: QA_FINANCE_ID, email: QA_FINANCE_EMAIL, platformRole: "platform_admin" });
    expect(await verifyPasswordAsync(input.password, data.passwordHash)).toBe(true);
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain(input.password);
  });
  it("reuses a matching account without password reset or MFA mutation", async () => {
    const f = fixture({ id: QA_FINANCE_ID, email: QA_FINANCE_EMAIL, name: "Q1 Synthetic Sandbox Finance", status: "active",
      platformRole: "platform_admin", passwordHash: await hashPasswordAsync(input.password) });
    await expect(ensureStagingQaFinance(f.db, input)).resolves.toMatchObject({ outcome: "EXISTING_VERIFIED" });
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  describe("TOTP seed enrollment for WP-10 MFA (F-168)", () => {
    // RFC 6238 appendix B public test seed; never a staging value.
    const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const withSeed = { ...input, totpSeed: seed };
    const matchingUser = async (mfaFactor: unknown) => ({ id: QA_FINANCE_ID, email: QA_FINANCE_EMAIL,
      name: "Q1 Synthetic Sandbox Finance", status: "active", platformRole: "platform_admin",
      passwordHash: await hashPasswordAsync(input.password), mfaFactor });
    beforeEach(() => { vi.stubEnv("CSRF_SECRET", "synthetic-qa-finance-bootstrap-csrf-secret-32-bytes"); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it("enrolls the seed with the app's encryption and hashed recovery codes when creating the account", async () => {
      const f = fixture();
      await expect(ensureStagingQaFinance(f.db, withSeed)).resolves.toEqual({ email: QA_FINANCE_EMAIL, outcome: "CREATED", mfa: "ENROLLED" });
      const factor = f.tx.userMfaFactor.create.mock.calls[0][0].data;
      expect(factor).toMatchObject({ userId: QA_FINANCE_ID, factorType: "totp", label: "CelebrateDeal Authenticator" });
      expect(factor.secretEncrypted).not.toContain(seed);
      expect(decryptMfaSecret(factor.secretEncrypted)).toBe(seed);
      const codes = f.tx.userRecoveryCode.createMany.mock.calls[0][0].data as { userId: string; codeHash: string }[];
      expect(codes).toHaveLength(8);
      expect(codes.every((code) => code.userId === QA_FINANCE_ID && code.codeHash.startsWith("hmac-sha256-v1:"))).toBe(true);
      expect(f.tx.userRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: QA_FINANCE_ID } });
      expect(f.tx.auditLog.create.mock.calls.map(([call]) => call.data.action)).toEqual(["staging_qa_finance_created", "mfa_enabled"]);
      expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain(seed);
      expect(verifyRecoveryCode("not-a-real-code", codes[0]!.codeHash)).toBe(false);
    });
    it("enrolls the seed on an existing verified account that has no factor", async () => {
      const f = fixture(await matchingUser(null));
      await expect(ensureStagingQaFinance(f.db, withSeed)).resolves.toEqual({ email: QA_FINANCE_EMAIL, outcome: "EXISTING_VERIFIED", mfa: "ENROLLED" });
      expect(f.tx.user.create).not.toHaveBeenCalled();
      expect(decryptMfaSecret(f.tx.userMfaFactor.create.mock.calls[0][0].data.secretEncrypted)).toBe(seed);
    });
    it("verifies an existing factor holding the same seed without rewriting it", async () => {
      const f = fixture(await matchingUser({ secretEncrypted: encryptMfaSecret(seed) }));
      await expect(ensureStagingQaFinance(f.db, { ...withSeed, totpSeed: seed.toLowerCase() })).resolves.toEqual({ email: QA_FINANCE_EMAIL, outcome: "EXISTING_VERIFIED", mfa: "VERIFIED" });
      expect(f.tx.userMfaFactor.create).not.toHaveBeenCalled();
      expect(f.tx.userRecoveryCode.createMany).not.toHaveBeenCalled();
      expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    });
    it("never replaces a factor that holds a different seed", async () => {
      const f = fixture(await matchingUser({ secretEncrypted: encryptMfaSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP") }));
      await expect(ensureStagingQaFinance(f.db, withSeed)).rejects.toMatchObject({ category: "MFA_FACTOR_MISMATCH" });
      expect(f.tx.userMfaFactor.create).not.toHaveBeenCalled();
      expect(f.tx.userRecoveryCode.deleteMany).not.toHaveBeenCalled();
    });
    it("reports an existing factor as unchecked when no seed is supplied", async () => {
      const f = fixture(await matchingUser({ secretEncrypted: encryptMfaSecret(seed) }));
      await expect(ensureStagingQaFinance(f.db, input)).resolves.toMatchObject({ mfa: "UNCHECKED" });
      expect(f.tx.userMfaFactor.create).not.toHaveBeenCalled();
    });
    it("rejects a malformed seed or a missing CSRF_SECRET-derived MFA key before database access", async () => {
      for (const totpSeed of ["123456", "GEZDGNBVGY3TQOJQ", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJ1"]) {
        const f = fixture();
        await expect(ensureStagingQaFinance(f.db, { ...input, totpSeed })).rejects.toThrow("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");
        expect(f.transaction).not.toHaveBeenCalled();
      }
      vi.stubEnv("CSRF_SECRET", "");
      const f = fixture();
      await expect(ensureStagingQaFinance(f.db, withSeed)).rejects.toThrow("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");
      expect(f.transaction).not.toHaveBeenCalled();
    });
    it("runners derive the same TOTP code as the application verifier", () => {
      for (const timestamp of [59_000, 1_111_111_109_000, Date.parse("2026-10-19T00:00:00Z")]) {
        expect(qaFinanceTotpCode(seed, timestamp)).toBe(totpCodeForTimestamp(seed, timestamp));
      }
    });
  });
  it("does not promote a conflicting existing account", async () => {
    const f = fixture({ id: "unknown-user", email: QA_FINANCE_EMAIL });
    await expect(ensureStagingQaFinance(f.db, input)).rejects.toThrow("STAGING_QA_FINANCE_BOOTSTRAP_REJECTED");
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });
  it("suppresses raw database errors", async () => {
    const f = fixture();
    f.tx.user.findFirst.mockRejectedValue(new Error("private database details"));
    await expect(ensureStagingQaFinance(f.db, input)).rejects.toThrow(/^STAGING_QA_FINANCE_BOOTSTRAP_REJECTED$/);
  });
});
