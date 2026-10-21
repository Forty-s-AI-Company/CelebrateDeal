import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { automationCustomerKeyHash } from "../src/lib/automation-workflow";
import { protectCommerceOrderPii, revealCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { getDb } from "../src/lib/db";
import { decryptPrivateChatBody, encryptPrivateChatBody } from "../src/lib/live-private-chat-storage";
import {
  ANONYMIZED_NAME,
  ANONYMIZED_TEXT,
  anonymizeCustomer,
  AnonymizeTargetRefusedError,
  resolveAnonymizeTarget,
} from "./anonymize-customer";

const vendorIds: string[] = [];

async function createVendorFixture(label: string) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic privacy ${label}`, slug: `privacy-${label}-${suffix}`, email: `privacy-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "Synthetic form", slug: `form-${suffix}`, headline: "Synthetic", fields: [] },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, title: "Synthetic live", slug: `live-${suffix}`, scheduledAt: new Date(), formId: form.id },
  });
  return { vendorId: vendor.id, formId: form.id, liveId: live.id };
}

type Fixture = Awaited<ReturnType<typeof createVendorFixture>>;

async function createSubmission(fixture: Fixture, email: string, options: { storeHash: boolean }) {
  return getDb().formSubmission.create({
    data: {
      formId: fixture.formId,
      liveId: fixture.liveId,
      name: "王小明",
      email,
      phone: "0912345678",
      answers: { note: "synthetic answer" },
      customerKeyHash: options.storeHash ? automationCustomerKeyHash(fixture.vendorId, email) : null,
    },
  });
}

async function createOrder(fixture: Fixture, email: string, options: { legacy?: boolean } = {}) {
  const db = getDb();
  const orderId = `order${randomUUID().replace(/-/g, "")}`;
  const pii = protectCommerceOrderPii({
    buyer: { name: "王小明", email, phone: "0912345678" },
    shipping: { recipientName: "王小明", phone: "0912345678", countryCode: "TW", administrativeArea: "台北市", locality: "信義區", addressLine1: "合成路 1 號" },
  }, { vendorId: fixture.vendorId, orderId });
  return db.commerceOrder.create({
    data: {
      id: orderId,
      vendorId: fixture.vendorId,
      automationCustomerKeyHash: options.legacy ? null : automationCustomerKeyHash(fixture.vendorId, email),
      orderNumber: `SYN-${randomUUID()}`,
      checkoutIdempotencyKey: randomUUID(),
      checkoutIdentityHash: pii.checkoutIdentityHash,
      status: "paid",
      subtotalAmountCents: 120_000,
      totalAmountCents: 120_000,
      paidAmountCents: 120_000,
      buyerEncryptedEnvelope: pii.buyerEncrypted,
      buyerMaskedName: pii.buyerNameMasked,
      buyerMaskedEmail: pii.buyerEmailMasked,
      buyerMaskedPhone: pii.buyerPhoneMasked,
      shippingEncryptedEnvelope: pii.shippingEncrypted,
      shippingMaskedSummary: pii.shippingSummaryMasked,
    },
  });
}

afterEach(async () => {
  const db = getDb();
  for (const vendorId of vendorIds.splice(0)) {
    await db.livePrivateChatMessage.deleteMany({ where: { vendorId } });
    await db.liveChatMessage.deleteMany({ where: { vendorId } });
    await db.formSubmission.deleteMany({ where: { form: { vendorId } } });
    await db.commerceOrder.deleteMany({ where: { vendorId } });
    await db.blacklist.deleteMany({ where: { vendorId } });
    await db.live.deleteMany({ where: { vendorId } });
    await db.registrationForm.deleteMany({ where: { vendorId } });
    await db.vendor.deleteMany({ where: { id: vendorId } });
  }
});

describe("anonymizeCustomer (PostgreSQL)", () => {
  it("dry run only counts rows and changes nothing", async () => {
    const fixture = await createVendorFixture("dry");
    const email = `buyer-${randomUUID()}@example.test`;
    const submission = await createSubmission(fixture, email, { storeHash: true });
    await createOrder(fixture, email);

    const counts = await anonymizeCustomer(getDb(), {
      vendorId: fixture.vendorId,
      customerKeyHash: automationCustomerKeyHash(fixture.vendorId, email),
      execute: false,
    });

    expect(counts).toMatchObject({ formSubmissions: 1, commerceOrders: 1 });
    expect(await getDb().formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).toMatchObject({ name: "王小明", email });
  });

  it("overwrites the customer's PII, keeps financial values and leaves other customers and tenants untouched", async () => {
    const fixture = await createVendorFixture("target");
    const other = await createVendorFixture("other-tenant");
    const email = `buyer-${randomUUID()}@example.test`;
    const bystanderEmail = `bystander-${randomUUID()}@example.test`;
    const hashed = await createSubmission(fixture, email, { storeHash: true });
    const legacy = await createSubmission(fixture, email.toUpperCase(), { storeHash: false });
    const bystander = await createSubmission(fixture, bystanderEmail, { storeHash: true });
    const otherTenant = await createSubmission(other, email, { storeHash: true });
    const order = await createOrder(fixture, email);
    const otherTenantOrder = await createOrder(other, email);
    const chat = await getDb().liveChatMessage.create({
      data: { vendorId: fixture.vendorId, liveId: fixture.liveId, formSubmissionId: hashed.id, authorName: "王小明", body: "我的電話是 0912345678" },
    });
    const messageId = createHash("sha256").update(randomUUID()).digest("hex");
    const scope = { vendorId: fixture.vendorId, liveId: fixture.liveId, submissionId: hashed.id, messageId, source: "viewer" as const };
    await getDb().livePrivateChatMessage.create({
      data: { id: messageId, vendorId: fixture.vendorId, liveId: fixture.liveId, formSubmissionId: hashed.id, source: "viewer", bodyEncrypted: encryptPrivateChatBody("私訊內容", scope) },
    });

    const customerKeyHash = automationCustomerKeyHash(fixture.vendorId, email);
    const counts = await anonymizeCustomer(getDb(), { vendorId: fixture.vendorId, customerKeyHash, execute: true });
    expect(counts).toMatchObject({ formSubmissions: 2, liveChatMessages: 1, livePrivateChatMessages: 1, commerceOrders: 1 });

    for (const id of [hashed.id, legacy.id]) {
      const row = await getDb().formSubmission.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ name: ANONYMIZED_NAME, phone: null, answers: null, customerKeyHash: null });
      expect(row.email).toMatch(/@redacted\.invalid$/);
    }
    expect(await getDb().formSubmission.findUniqueOrThrow({ where: { id: bystander.id } })).toMatchObject({ name: "王小明", email: bystanderEmail });
    expect(await getDb().formSubmission.findUniqueOrThrow({ where: { id: otherTenant.id } })).toMatchObject({ name: "王小明", email });

    expect(await getDb().liveChatMessage.findUniqueOrThrow({ where: { id: chat.id } })).toMatchObject({ authorName: ANONYMIZED_NAME, body: ANONYMIZED_TEXT });
    const privateRow = await getDb().livePrivateChatMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(decryptPrivateChatBody(privateRow.bodyEncrypted, scope)).toBe(ANONYMIZED_TEXT);

    const storedOrder = await getDb().commerceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(storedOrder).toMatchObject({
      totalAmountCents: 120_000,
      paidAmountCents: 120_000,
      status: "paid",
      buyerMaskedName: ANONYMIZED_NAME,
      buyerMaskedPhone: null,
      shippingEncryptedEnvelope: null,
      shippingMaskedSummary: null,
      automationCustomerKeyHash: null,
    });
    const revealed = revealCommerceOrderPii(
      { buyerEncrypted: storedOrder.buyerEncryptedEnvelope, shippingEncrypted: null },
      { vendorId: fixture.vendorId, orderId: order.id },
    );
    expect(revealed.buyer.name).toBe(ANONYMIZED_NAME);
    expect(JSON.stringify(storedOrder)).not.toContain("王小明");

    expect(await getDb().commerceOrder.findUniqueOrThrow({ where: { id: otherTenantOrder.id } }))
      .toMatchObject({ buyerEncryptedEnvelope: otherTenantOrder.buyerEncryptedEnvelope, automationCustomerKeyHash: otherTenantOrder.automationCustomerKeyHash });

    // Rerun is a no-op: the hash link is gone, so nothing matches any more.
    expect(await anonymizeCustomer(getDb(), { vendorId: fixture.vendorId, customerKeyHash, execute: false }))
      .toMatchObject({ formSubmissions: 0, commerceOrders: 0, liveChatMessages: 0 });
  });

  it("finds legacy orders without a stored hash and email blacklist entries, and re-runs to all zeros", async () => {
    const fixture = await createVendorFixture("legacy");
    const email = `legacy-${randomUUID()}@example.test`;
    const legacyOrder = await createOrder(fixture, email.toUpperCase(), { legacy: true });
    const unrelatedLegacy = await createOrder(fixture, `someone-${randomUUID()}@example.test`, { legacy: true });
    const blocked = await getDb().blacklist.create({
      data: { vendorId: fixture.vendorId, identifier: email, identifierType: "email", reason: "spam", notes: "王小明 多次洗版" },
    });
    const customerKeyHash = automationCustomerKeyHash(fixture.vendorId, email);

    const dry = await anonymizeCustomer(getDb(), { vendorId: fixture.vendorId, customerKeyHash, execute: false });
    expect(dry).toMatchObject({ commerceOrders: 1, blacklistEntries: 1, legacyOrdersUnreadable: 0 });

    await anonymizeCustomer(getDb(), { vendorId: fixture.vendorId, customerKeyHash, execute: true });
    const stored = await getDb().commerceOrder.findUniqueOrThrow({ where: { id: legacyOrder.id } });
    expect(stored).toMatchObject({ buyerMaskedName: ANONYMIZED_NAME, shippingEncryptedEnvelope: null, totalAmountCents: 120_000 });
    expect(await getDb().commerceOrder.findUniqueOrThrow({ where: { id: unrelatedLegacy.id } }))
      .toMatchObject({ buyerEncryptedEnvelope: unrelatedLegacy.buyerEncryptedEnvelope });
    const blacklist = await getDb().blacklist.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(blacklist.identifier).toMatch(/@redacted\.invalid$/);
    expect(blacklist.notes).toBeNull();

    const rerun = await anonymizeCustomer(getDb(), { vendorId: fixture.vendorId, customerKeyHash, execute: false });
    expect(Object.values(rerun).every((count) => count === 0)).toBe(true);
  });

  it("rejects malformed identifiers before touching the database", async () => {
    await expect(anonymizeCustomer(getDb(), { vendorId: "bad id", customerKeyHash: "x", execute: false })).rejects.toThrow("Invalid vendor or customer identifier.");
  });
});

describe("resolveAnonymizeTarget", () => {
  const remote = "postgresql://user:pw@db.example.test:5432/postgres"; // secret-scan: allow-test-fixture
  const loopback = "postgresql://postgres:postgres@127.0.0.1:5433/celebratedeal_test";

  it("allows a loopback celebratedeal database and pins exactly that URL", () => {
    expect(resolveAnonymizeTarget({ DATABASE_URL: loopback })).toEqual({ url: loopback, target: "loopback" });
  });

  it("refuses every remote target while no workflow is approved, whatever the environment claims", () => {
    for (const env of [
      { DATABASE_URL: remote },
      { DATABASE_URL: remote, GITHUB_ACTIONS: "true", PERSONAL_DATA_REQUEST_WORKFLOW: "true" },
      { DATABASE_URL: remote, GITHUB_ACTIONS: "true", ANONYMIZE_CUSTOMER_WORKFLOW: "personal-data-request" },
      { DATABASE_URL: "" },
    ]) {
      expect(() => resolveAnonymizeTarget(env)).toThrow(AnonymizeTargetRefusedError);
    }
  });

  it("accepts a remote target only for a reviewed workflow entry running on its platform", () => {
    const approved = { "personal-data-request": (env: Readonly<Record<string, string | undefined>>) => env.GITHUB_WORKFLOW_REF === "owner/repo/.github/workflows/personal-data-request.yml@refs/heads/master" };
    const env = { DATABASE_URL: remote, ANONYMIZE_CUSTOMER_WORKFLOW: "personal-data-request" };
    expect(() => resolveAnonymizeTarget(env, approved)).toThrow(AnonymizeTargetRefusedError);
    expect(resolveAnonymizeTarget({ ...env, GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/personal-data-request.yml@refs/heads/master" }, approved).target).toBe("workflow");
  });

  it("the CLI refuses --execute without the confirmation string before touching data", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/anonymize-customer.ts", "--vendor-id", "vendor", "--customer-key-hash", "a".repeat(43), "--execute"], {
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: loopback } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("target-refused:confirmation-missing");
  });
});
