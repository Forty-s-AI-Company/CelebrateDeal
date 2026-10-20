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
  assertAnonymizeTarget,
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

async function createOrder(fixture: Fixture, email: string) {
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
      automationCustomerKeyHash: automationCustomerKeyHash(fixture.vendorId, email),
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

  it("rejects malformed identifiers before touching the database", async () => {
    await expect(anonymizeCustomer(getDb(), { vendorId: "bad id", customerKeyHash: "x", execute: false })).rejects.toThrow("Invalid vendor or customer identifier.");
  });
});

describe("assertAnonymizeTarget", () => {
  it("allows only a loopback celebratedeal database or the approved workflow", () => {
    const remote = "postgresql://user:pw@db.example.test:5432/postgres"; // secret-scan: allow-test-fixture
    expect(assertAnonymizeTarget({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/celebratedeal_test" })).toBe("loopback");
    expect(() => assertAnonymizeTarget({ DATABASE_URL: remote })).toThrow(AnonymizeTargetRefusedError);
    expect(() => assertAnonymizeTarget({ DATABASE_URL: remote, PERSONAL_DATA_REQUEST_WORKFLOW: "true" })).toThrow(AnonymizeTargetRefusedError);
    expect(() => assertAnonymizeTarget({ DATABASE_URL: remote, GITHUB_ACTIONS: "true" })).toThrow(AnonymizeTargetRefusedError);
    expect(assertAnonymizeTarget({ DATABASE_URL: remote, PERSONAL_DATA_REQUEST_WORKFLOW: "true", GITHUB_ACTIONS: "true" })).toBe("workflow");
  });
});
