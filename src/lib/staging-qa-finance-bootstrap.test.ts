import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ensureStagingQaFinance, qaFinanceDatabaseUrl, QA_FINANCE_EMAIL, QA_FINANCE_ID } from "./staging-qa-finance-bootstrap";
import { hashPasswordAsync, verifyPasswordAsync } from "./password";

const input = { databaseUrl: "postgresql://synthetic@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres",
  sourceSha: "a".repeat(40), password: "synthetic-test-password-24-characters", runtimeReady: true, payuniEnv: "sandbox" };
function fixture(existing: unknown = null) {
  const tx = { user: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn() }, auditLog: { create: vi.fn() } };
  const transaction = vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx));
  return { tx, transaction, db: { $transaction: transaction } as unknown as PrismaClient };
}
describe("fixed staging QA finance account", () => {
  it("upgrades omitted TLS parameters to encryption and strict certificate verification", () => {
    const url = new URL(qaFinanceDatabaseUrl(input.databaseUrl));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("sslaccept")).toBe("strict");
  });
  for (const query of ["host=127.0.0.1", "%68ost=127.0.0.1", "host=foo&host=bar", "sslmode=disable",
    "sslmode=prefer", "sslaccept=accept_invalid_certs", "sslmode=require&sslmode=disable", "schema=private", "sslrootcert=untrusted"]) {
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
    await expect(ensureStagingQaFinance(f.db, input)).resolves.toEqual({ email: QA_FINANCE_EMAIL, outcome: "CREATED" });
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
