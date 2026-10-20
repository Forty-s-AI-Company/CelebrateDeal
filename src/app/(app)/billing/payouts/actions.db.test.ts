import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptBankAccount, loadRuntimeBankAccountKeyring } from "@/lib/bank-account";
import { getDb } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorOwnerFinance: vi.fn(),
  revalidatePath: vi.fn(),
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

import { saveVendorPayoutAccountAction } from "./actions";

type Tenant = { vendorId: string; userId: string };
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
  const user = await db.user.create({
    data: { name: `Synthetic owner ${label}`, email: `owner-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  const tenant = { vendorId: vendor.id, userId: user.id };
  tenants.push(tenant);
  return tenant;
}

function actAs(tenant: Tenant, options: { mfa?: boolean } = {}) {
  mocks.requireVendorOwnerFinance.mockResolvedValue({
    user: { id: tenant.userId, email: "owner@example.test", mfaFactor: options.mfa === false ? null : { id: "factor" } },
    vendor: { id: tenant.vendorId },
    member: { role: "owner" },
  });
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const validForm = { accountName: "王小明", bankCode: "812", accountNumber: "0012-3456-7890" };

async function expectRedirect(promise: Promise<unknown>, path: string) {
  await expect(promise).rejects.toThrow(`redirect:${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  const db = getDb();
  for (const tenant of tenants.splice(0)) {
    await db.auditLog.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.paymentAccount.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.user.deleteMany({ where: { id: tenant.userId } });
    await db.vendor.deleteMany({ where: { id: tenant.vendorId } });
  }
});

describe("saveVendorPayoutAccountAction (PostgreSQL)", () => {
  it("stores only an encrypted envelope and masked legacy values for the session vendor", async () => {
    const tenant = await createTenant("a");
    actAs(tenant);

    await expectRedirect(saveVendorPayoutAccountAction(form(validForm)), "/billing/payouts?payoutAccount=saved");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledTimes(1);
    expect(mocks.requireVendorOwnerFinance).toHaveBeenCalledWith("/billing/payouts");
    const accounts = await getDb().paymentAccount.findMany({ where: { vendorId: tenant.vendorId } });
    expect(accounts).toHaveLength(1);
    const account = accounts[0]!;
    expect(account).toMatchObject({
      mode: "platform",
      status: "active",
      bankAccountLegacyName: "王＊＊",
      bankCodeLegacy: "812",
      bankAccountLegacyNumber: "****7890",
    });
    expect(JSON.stringify(account)).not.toContain("001234567890");
    expect(decryptBankAccount(account.bankAccountEncrypted!, tenant.vendorId, loadRuntimeBankAccountKeyring())).toEqual({
      accountName: "王小明",
      bankCode: "812",
      accountNumber: "001234567890",
    });

    const audit = await getDb().auditLog.findMany({ where: { vendorId: tenant.vendorId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "vendor_payout_account_saved", targetId: account.id, actorId: tenant.userId });
    expect(JSON.stringify(audit[0])).not.toContain("001234567890");
    expect(JSON.stringify(audit[0])).not.toContain("王小明");
  });

  it("updates the existing account in place instead of creating a second one", async () => {
    const tenant = await createTenant("update");
    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form(validForm)), "/billing/payouts?payoutAccount=saved");
    await expectRedirect(
      saveVendorPayoutAccountAction(form({ accountName: "王小明", bankCode: "8120012", accountNumber: "99887766554433" })),
      "/billing/payouts?payoutAccount=saved",
    );

    const accounts = await getDb().paymentAccount.findMany({ where: { vendorId: tenant.vendorId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ bankCodeLegacy: "8120012", bankAccountLegacyNumber: "****4433" });
    expect(await getDb().auditLog.count({ where: { vendorId: tenant.vendorId } })).toBe(2);
  });

  it("never writes another tenant's account, even when the form names it", async () => {
    const tenantA = await createTenant("owner-a");
    const tenantB = await createTenant("victim-b");
    actAs(tenantB);
    await expectRedirect(
      saveVendorPayoutAccountAction(form({ accountName: "乙公司", bankCode: "700", accountNumber: "11112222333" })),
      "/billing/payouts?payoutAccount=saved",
    );
    const before = await getDb().paymentAccount.findFirstOrThrow({ where: { vendorId: tenantB.vendorId } });

    actAs(tenantA);
    await expectRedirect(
      saveVendorPayoutAccountAction(form({ ...validForm, vendorId: tenantB.vendorId, accountId: before.id })),
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
  });

  it("does not let a merchant lift a platform suspension", async () => {
    const tenant = await createTenant("suspended");
    await getDb().paymentAccount.create({
      data: { vendorId: tenant.vendorId, mode: "platform", providerName: "platform", accountLabel: "synthetic", status: "suspended" },
    });
    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form(validForm)), "/billing/payouts?payoutAccount=saved");
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
    await expectRedirect(saveVendorPayoutAccountAction(form(validForm)), "/billing/payouts?payoutAccount=multiple_accounts");
    expect(await getDb().paymentAccount.count({ where: { vendorId: tenant.vendorId, bankAccountEncrypted: { not: null } } })).toBe(0);
    expect(await getDb().auditLog.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
  });

  it("requires an enrolled second factor and valid input before writing", async () => {
    const tenant = await createTenant("guard");
    actAs(tenant, { mfa: false });
    await expectRedirect(saveVendorPayoutAccountAction(form(validForm)), "/mfa/setup?next=%2Fbilling%2Fpayouts");

    actAs(tenant);
    await expectRedirect(saveVendorPayoutAccountAction(form({ ...validForm, bankCode: "81" })), "/billing/payouts?payoutAccount=invalid_bank_code");
    await expectRedirect(saveVendorPayoutAccountAction(form({ ...validForm, accountNumber: "12ab" })), "/billing/payouts?payoutAccount=invalid_account_number");
    await expectRedirect(saveVendorPayoutAccountAction(form({ ...validForm, accountName: " " })), "/billing/payouts?payoutAccount=invalid_account_name");
    expect(await getDb().paymentAccount.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
  });

  it("stops before authorization when CSRF validation fails", async () => {
    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("csrf"));
    await expect(saveVendorPayoutAccountAction(form(validForm))).rejects.toThrow("csrf");
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
