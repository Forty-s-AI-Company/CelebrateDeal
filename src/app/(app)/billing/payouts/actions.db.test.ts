import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptBankAccount, loadRuntimeBankAccountKeyring } from "@/lib/bank-account";
import { getDb } from "@/lib/db";
import { encryptMfaSecret, generateTotpSecret, totpCodeForTimestamp } from "@/lib/mfa";
import { PAYOUT_ACCOUNT_COOLDOWN_MS, PayoutAccountSelectionError, selectPayoutAccount } from "@/lib/payout-account";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorOwnerFinance: vi.fn(),
  revalidatePath: vi.fn(),
  checkRateLimit: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorOwnerFinance: mocks.requireVendorOwnerFinance }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/email", () => ({ sendTransactionalEmail: mocks.sendTransactionalEmail }));

import { saveVendorPayoutAccountAction } from "./actions";

type Tenant = { vendorId: string; userId: string; email: string; totpSecret: string };
const tenants: Tenant[] = [];

async function createTenant(label: string): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: {
      name: `Synthetic payout ${label}`,
      slug: `payout-${label}-${suffix}`,
      email: `payout-${suffix}@example.test`,
      passwordHash: "synthetic-only",
    },
  });
  const email = `owner-${suffix}@example.test`;
  const user = await db.user.create({
    data: { name: `Synthetic owner ${label}`, email, passwordHash: "synthetic-only" },
  });
  await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner" } });
  const tenant = { vendorId: vendor.id, userId: user.id, email, totpSecret: generateTotpSecret() };
  tenants.push(tenant);
  return tenant;
}

function actAs(tenant: Tenant, options: { mfa?: boolean } = {}) {
  mocks.requireVendorOwnerFinance.mockResolvedValue({
    user: {
      id: tenant.userId,
      email: tenant.email,
      mfaFactor: options.mfa === false ? null : { id: "factor", secretEncrypted: encryptMfaSecret(tenant.totpSecret) },
    },
    vendor: { id: tenant.vendorId, name: "Synthetic vendor" },
    member: { role: "owner" },
  });
}

function form(tenant: Tenant | null, values: Record<string, string>) {
  const data = new FormData();
  if (tenant) data.set("totpCode", totpCodeForTimestamp(tenant.totpSecret));
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const validForm = { accountName: "王小明", bankCode: "812", accountNumber: "0012-3456-7890" };

async function expectRedirect(promise: Promise<unknown>, path: string) {
  await expect(promise).rejects.toThrow(`redirect:${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.sendTransactionalEmail.mockResolvedValue({ id: "synthetic-email" });
});

afterEach(async () => {
  const db = getDb();
  for (const tenant of tenants.splice(0)) {
    await db.auditLog.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.paymentAccount.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.vendorMember.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.user.deleteMany({ where: { id: tenant.userId } });
    await db.vendor.deleteMany({ where: { id: tenant.vendorId } });
  }
});

describe("saveVendorPayoutAccountAction (PostgreSQL)", () => {
  it("stores only an envelope and masked values, waits 24 hours and e-mails the owners", async () => {
    const tenant = await createTenant("a");
    actAs(tenant);
    const before = Date.now();

    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/billing/payouts?payoutAccount=saved");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledTimes(1);
    expect(mocks.requireVendorOwnerFinance).toHaveBeenCalledWith("/billing/payouts");
    const accounts = await getDb().paymentAccount.findMany({ where: { vendorId: tenant.vendorId } });
    expect(accounts).toHaveLength(1);
    const account = accounts[0]!;
    expect(account).toMatchObject({
      mode: "platform",
      status: "pending_verification",
      bankAccountLegacyName: "王＊＊",
      bankCodeLegacy: "812",
      bankAccountLegacyNumber: "****7890",
    });
    expect(account.payoutEligibleAt!.getTime()).toBeGreaterThanOrEqual(before + PAYOUT_ACCOUNT_COOLDOWN_MS);
    expect(account.bankAccountChangedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(account)).not.toContain("001234567890");
    expect(decryptBankAccount(account.bankAccountEncrypted!, tenant.vendorId, loadRuntimeBankAccountKeyring())).toEqual({
      accountName: "王小明",
      bankCode: "812",
      accountNumber: "001234567890",
    });

    // Not payable now; payable once the cooldown has passed.
    expect(() => selectPayoutAccount(accounts)).toThrow(PayoutAccountSelectionError);
    expect(selectPayoutAccount(accounts, new Date(account.payoutEligibleAt!.getTime() + 1)).id).toBe(account.id);

    expect(mocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const mail = mocks.sendTransactionalEmail.mock.calls[0]![0] as { to: string; text: string; html: string };
    expect(mail.to).toBe(tenant.email);
    expect(mail.text).toContain("7890");
    expect(`${mail.text}${mail.html}`).not.toContain("001234567890");

    const audit = await getDb().auditLog.findMany({ where: { vendorId: tenant.vendorId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "vendor_payout_account_saved", targetId: account.id, actorId: tenant.userId });
    expect(JSON.stringify(audit[0])).not.toContain("001234567890");
    expect(JSON.stringify(audit[0])).not.toContain("王小明");
  });

  it("a stolen session without the owner's current TOTP code cannot change the account", async () => {
    const tenant = await createTenant("stolen");
    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/billing/payouts?payoutAccount=saved");
    const original = await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenant.vendorId } });
    mocks.sendTransactionalEmail.mockClear();

    const attacker = { accountName: "攻擊者", bankCode: "700", accountNumber: "99999999999" };
    const current = totpCodeForTimestamp(tenant.totpSecret);
    const wrong = current.replace(/\d/g, (digit) => String((Number(digit) + 5) % 10));
    for (const totpCode of [undefined, "", wrong, "12345a"]) {
      const data = form(null, attacker);
      if (totpCode !== undefined) data.set("totpCode", totpCode);
      await expectRedirect(saveVendorPayoutAccountAction(data), "/billing/payouts?payoutAccount=step_up_failed");
    }

    expect(await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenant.vendorId } })).toEqual(original);
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(await getDb().auditLog.count({ where: { vendorId: tenant.vendorId, action: "vendor_payout_account_step_up_failed" } })).toBe(4);
  });

  it("stops at the step-up rate limit before checking the code", async () => {
    const tenant = await createTenant("limited");
    actAs(tenant);
    mocks.checkRateLimit.mockResolvedValueOnce({ status: 429 });
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/billing/payouts?payoutAccount=step_up_rate_limited");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), `payout-account-step-up:${tenant.userId}`, 5, 15 * 60 * 1000);
    expect(await getDb().paymentAccount.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
  });

  it("moves an active or verified account back to pending_verification on change", async () => {
    for (const status of ["active", "verified"]) {
      const tenant = await createTenant(`reset-${status}`);
      await getDb().paymentAccount.create({
        data: { vendorId: tenant.vendorId, mode: "platform", providerName: "platform", accountLabel: "synthetic", status },
      });
      actAs(tenant);
      await expectRedirect(
        saveVendorPayoutAccountAction(form(tenant, { accountName: "王小明", bankCode: "8120012", accountNumber: "99887766554433" })),
        "/billing/payouts?payoutAccount=saved",
      );
      const accounts = await getDb().paymentAccount.findMany({ where: { vendorId: tenant.vendorId } });
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({ status: "pending_verification", bankCodeLegacy: "8120012", bankAccountLegacyNumber: "****4433" });
      expect(() => selectPayoutAccount(accounts)).toThrow(PayoutAccountSelectionError);
    }
  });

  it("never writes another tenant's account, even when the form names it", async () => {
    const tenantA = await createTenant("owner-a");
    const tenantB = await createTenant("victim-b");
    actAs(tenantB);
    await expectRedirect(
      saveVendorPayoutAccountAction(form(tenantB, { accountName: "乙公司", bankCode: "700", accountNumber: "11112222333" })),
      "/billing/payouts?payoutAccount=saved",
    );
    const before = await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenantB.vendorId } });

    actAs(tenantA);
    mocks.sendTransactionalEmail.mockClear();
    await expectRedirect(
      saveVendorPayoutAccountAction(form(tenantA, { ...validForm, vendorId: tenantB.vendorId, accountId: before.id })),
      "/billing/payouts?payoutAccount=saved",
    );

    const after = await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenantB.vendorId } });
    expect(after).toEqual(before);
    expect(await getDb().paymentAccount.count({ where: { vendorId: tenantB.vendorId } })).toBe(1);
    const accountA = await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenantA.vendorId } });
    expect(accountA.id).not.toBe(before.id);
    // The envelope is bound to its vendor: it cannot be replayed under another tenant.
    expect(() => decryptBankAccount(accountA.bankAccountEncrypted!, tenantB.vendorId, loadRuntimeBankAccountKeyring())).toThrow();
    expect(await getDb().auditLog.count({ where: { vendorId: tenantB.vendorId } })).toBe(1);
    // Only tenant A's owner is told about tenant A's change.
    expect(mocks.sendTransactionalEmail.mock.calls.map((call) => (call[0] as { to: string }).to)).toEqual([tenantA.email]);
  });

  it("keeps the change but reports it when the owner notification cannot be sent", async () => {
    const tenant = await createTenant("mail-down");
    actAs(tenant);
    mocks.sendTransactionalEmail.mockRejectedValueOnce(new Error("provider down"));
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/billing/payouts?payoutAccount=saved_notification_failed");
    expect(await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenant.vendorId } })).toMatchObject({ status: "pending_verification" });
  });

  it("does not let a merchant lift a platform suspension", async () => {
    const tenant = await createTenant("suspended");
    await getDb().paymentAccount.create({
      data: { vendorId: tenant.vendorId, mode: "platform", providerName: "platform", accountLabel: "synthetic", status: "suspended" },
    });
    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/billing/payouts?payoutAccount=saved");
    expect(await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenant.vendorId } })).toMatchObject({
      status: "suspended",
      bankAccountLegacyNumber: "****7890",
    });
  });

  it("refuses to choose between several platform accounts", async () => {
    const tenant = await createTenant("ambiguous");
    for (const label of ["one", "two"]) {
      await getDb().paymentAccount.create({
        data: { vendorId: tenant.vendorId, mode: "platform", providerName: "platform", accountLabel: label, status: "active" },
      });
    }
    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/billing/payouts?payoutAccount=multiple_accounts");
    expect(await getDb().paymentAccount.count({ where: { vendorId: tenant.vendorId, bankAccountEncrypted: { not: null } } })).toBe(0);
    expect(await getDb().auditLog.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("requires an enrolled second factor and valid input before writing", async () => {
    const tenant = await createTenant("guard");
    actAs(tenant, { mfa: false });
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, validForm)), "/mfa/setup?next=%2Fbilling%2Fpayouts");

    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, { ...validForm, bankCode: "81" })), "/billing/payouts?payoutAccount=invalid_bank_code");
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, { ...validForm, accountNumber: "12ab" })), "/billing/payouts?payoutAccount=invalid_account_number");
    await expectRedirect(saveVendorPayoutAccountAction(form(tenant, { ...validForm, accountName: " " })), "/billing/payouts?payoutAccount=invalid_account_name");
    expect(await getDb().paymentAccount.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
  });

  it("stops before authorization when CSRF validation fails", async () => {
    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("csrf"));
    await expect(saveVendorPayoutAccountAction(form(null, validForm))).rejects.toThrow("csrf");
    expect(mocks.requireVendorOwnerFinance).not.toHaveBeenCalled();
  });
});

describe("PaymentAccount masked legacy number CHECK", () => {
  it("rejects a plaintext legacy account number written outside the app path", async () => {
    const tenant = await createTenant("check");
    await expect(getDb().paymentAccount.create({
      data: {
        vendorId: tenant.vendorId,
        mode: "platform",
        providerName: "manual-sql",
        accountLabel: "synthetic",
        bankAccountLegacyNumber: "1234567890",
      },
    })).rejects.toThrow(/PaymentAccount_bankAccountNumber_masked_check/);
    await expect(getDb().paymentAccount.create({
      data: { vendorId: tenant.vendorId, mode: "platform", providerName: "manual-sql", accountLabel: "masked", bankAccountLegacyNumber: "****7890" },
    })).resolves.toMatchObject({ bankAccountLegacyNumber: "****7890" });
  });
});
