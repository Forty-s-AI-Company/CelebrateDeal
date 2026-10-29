import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-133: real PostgreSQL, two tenants. Only the session/CSRF/project-selection
// boundaries are synthetic; every query below runs against the actual schema.
const runtime = vi.hoisted(() => ({ vendorId: "", projectId: null as string | null }));
const guards = vi.hoisted(() => ({ csrf: vi.fn(), manager: vi.fn(), editable: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerContext: async () => {
    await guards.manager();
    return {
    auth: { user: { id: "synthetic-user" }, member: { id: "synthetic-member", role: "owner" } },
    vendor: { id: runtime.vendorId, name: "Synthetic tenant" },
    };
  },
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: (form: FormData) => guards.csrf(form) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const immediate = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: immediate.schedule }));
vi.mock("@/lib/sales-project-scope", () => ({
  getSalesProjectScope: async () => ({ projectId: runtime.projectId, projectName: null, isAggregate: false, isLegacyWorkspace: !runtime.projectId }),
  requireEditableSalesProjectScope: async (userId: string, vendorId: string) => {
    await guards.editable(userId, vendorId);
    return { projectId: runtime.projectId, projectName: null, isAggregate: false, isLegacyWorkspace: !runtime.projectId };
  },
}));

import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import {
  addCustomerTagAction,
  grantCustomerVoucherAction,
  saveConsultantNoteAction,
  searchCustomersAction,
} from "./customer-crm-actions";

const db = new PrismaClient();
const vendors: string[] = [];

async function tenant() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Tenant ${id.slice(0, 6)}`, slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  return vendor.id;
}

async function registrant(vendorId: string, email: string, name: string) {
  const form = await db.registrationForm.create({
    data: { vendorId, name: "Synthetic form", slug: randomUUID(), headline: "Register", fields: [{ key: "name", label: "姓名", type: "text", required: true }], isActive: true },
  });
  const customerKeyHash = automationCustomerKeyHash(vendorId, email);
  await db.formSubmission.create({ data: { formId: form.id, name, email, phone: "0912345678", customerKeyHash, verificationStatus: "VERIFIED" } });
  return customerKeyHash;
}

function data(entries: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

let vendorA = "";
let vendorB = "";
beforeEach(async () => {
  guards.csrf.mockReset().mockResolvedValue(undefined);
  guards.manager.mockReset().mockResolvedValue(undefined);
  guards.editable.mockReset().mockResolvedValue(undefined);
  immediate.schedule.mockReset();
  vendorA = await tenant();
  vendorB = await tenant();
  runtime.vendorId = vendorA;
  runtime.projectId = null;
});
afterEach(async () => { await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => db.$disconnect());

describe("customer CRM actions across two tenants", () => {
  it("search never returns another tenant's customer and shows only masked contacts", async () => {
    await registrant(vendorB, "secret-b@example.test", "乙方學員");
    await registrant(vendorA, "member-a@example.test", "甲方學員");

    runtime.vendorId = vendorA;
    const asA = await searchCustomersAction({ status: "idle", message: "", items: [] }, data({ query: "example.test", tag: "" }));
    expect(asA.status).toBe("success");
    expect(asA.items.map((item) => item.name)).toEqual(["甲方學員"]);
    expect(JSON.stringify(asA.items)).not.toContain("secret-b");
    expect(JSON.stringify(asA.items)).not.toContain("member-a@example.test");

    const byForeignEmail = await searchCustomersAction({ status: "idle", message: "", items: [] }, data({ query: "secret-b@example.test", tag: "" }));
    expect(byForeignEmail.items).toEqual([]);
  });

  it("tag and note mutations write only under the caller's vendor, even with a foreign customer hash", async () => {
    const foreignHash = await registrant(vendorB, "secret-b@example.test", "乙方學員");

    await addCustomerTagAction(data({ customerKeyHash: foreignHash, tag: "高意向" }));
    await saveConsultantNoteAction(data({ customerKeyHash: foreignHash, body: "只屬於甲方的備註", status: "following_up" }));

    expect(await db.customerTagAssignment.count({ where: { vendorId: vendorB } })).toBe(0);
    expect(await db.consultantNote.count({ where: { vendorId: vendorB } })).toBe(0);
    expect(await db.customerCrmRecord.count({ where: { vendorId: vendorB } })).toBe(0);
    // Rows land under the caller (A), keyed by the supplied hash, and are invisible to B's listing.
    expect(await db.customerTagAssignment.count({ where: { vendorId: vendorA, customerKeyHash: foreignHash } })).toBe(1);
    runtime.vendorId = vendorB;
    const asB = await searchCustomersAction({ status: "idle", message: "", items: [] }, data({ query: "", tag: "" }));
    expect(asB.items.every((item) => !item.tags.includes("高意向"))).toBe(true);
  });

  it("refuses mutations for a customer outside the selected project and writes nothing", async () => {
    const hash = await registrant(vendorA, "member-a@example.test", "甲方學員");
    const project = await db.salesProject.create({ data: { vendorId: vendorA, name: "Synthetic project", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: "draft" } });
    runtime.projectId = project.id;

    await expect(addCustomerTagAction(data({ customerKeyHash: hash, tag: "高意向" }))).rejects.toThrow("customer_not_in_selected_project");
    await expect(saveConsultantNoteAction(data({ customerKeyHash: hash, body: "不應寫入", status: "closed_won" }))).rejects.toThrow("customer_not_in_selected_project");
    expect(await db.customerTagAssignment.count({ where: { vendorId: vendorA } })).toBe(0);
    expect(await db.consultantNote.count({ where: { vendorId: vendorA } })).toBe(0);
    expect(await db.customerCrmRecord.count({ where: { vendorId: vendorA } })).toBe(0);
  });

  it("voucher grants cannot use another tenant's product or reach another tenant's customer contact", async () => {
    const foreignHash = await registrant(vendorB, "secret-b@example.test", "乙方學員");
    const ownHash = await registrant(vendorA, "member-a@example.test", "甲方學員");
    const foreignProduct = await db.product.create({ data: { vendorId: vendorB, name: "乙方商品", slug: randomUUID(), priceCents: 10_000, currency: "TWD", inventory: 5, isActive: true, fulfillmentTypeConfirmed: true } });
    const ownProduct = await db.product.create({ data: { vendorId: vendorA, name: "甲方商品", slug: randomUUID(), priceCents: 10_000, currency: "TWD", inventory: 5, isActive: true, fulfillmentTypeConfirmed: true } });

    await expect(grantCustomerVoucherAction(data({ customerKeyHash: ownHash, productId: foreignProduct.id }))).rejects.toThrow("找不到可派券的商品");
    // A's own product, but the hash belongs to B's learner: no verified contact exists under A.
    await expect(grantCustomerVoucherAction(data({ customerKeyHash: foreignHash, productId: ownProduct.id }))).rejects.toThrow("找不到已驗證的學員聯絡方式");
    expect(await db.automationVoucherGrant.count({ where: { vendorId: { in: [vendorA, vendorB] } } })).toBe(0);
    expect(immediate.schedule).not.toHaveBeenCalled();
  });

  it("dispatches the committed voucher email right after the response, scoped to the caller's tenant", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm-voucher.example.test");
    try {
      const ownHash = await registrant(vendorA, "member-a@example.test", "甲方學員");
      const ownProduct = await db.product.create({ data: { vendorId: vendorA, name: "甲方商品", slug: randomUUID(), priceCents: 10_000, currency: "TWD", inventory: 5, isActive: true, fulfillmentTypeConfirmed: true } });

      await grantCustomerVoucherAction(data({ customerKeyHash: ownHash, productId: ownProduct.id }));

      const deliveries = await db.emailDelivery.findMany({ where: { vendorId: { in: [vendorA, vendorB] } }, select: { id: true, vendorId: true, status: true } });
      expect(deliveries).toEqual([{ id: expect.any(String), vendorId: vendorA, status: "queued" }]);
      expect(immediate.schedule).toHaveBeenCalledExactlyOnceWith([deliveries[0]!.id]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("customer CRM action guards", () => {
  const mutations = [
    ["addCustomerTagAction", addCustomerTagAction, (hash: string) => data({ customerKeyHash: hash, tag: "高意向" })],
    ["saveConsultantNoteAction", saveConsultantNoteAction, (hash: string) => data({ customerKeyHash: hash, body: "不應寫入", status: "following_up" })],
  ] as const;

  async function rows() {
    return {
      tags: await db.customerTagAssignment.count({ where: { vendorId: { in: [vendorA, vendorB] } } }),
      notes: await db.consultantNote.count({ where: { vendorId: { in: [vendorA, vendorB] } } }),
      records: await db.customerCrmRecord.count({ where: { vendorId: { in: [vendorA, vendorB] } } }),
    };
  }

  it.each(mutations)("%s rejects a failed CSRF check before any other work", async (_name, action, build) => {
    const hash = await registrant(vendorA, "member-a@example.test", "甲方學員");
    const form = build(hash);
    guards.csrf.mockRejectedValueOnce(new Error("csrf_rejected"));
    await expect(action(form)).rejects.toThrow("csrf_rejected");
    expect(guards.csrf).toHaveBeenCalledWith(form);
    expect(guards.manager).not.toHaveBeenCalled();
    expect(await rows()).toEqual({ tags: 0, notes: 0, records: 0 });
  });

  it.each(mutations)("%s rejects a non-manager role", async (_name, action, build) => {
    const hash = await registrant(vendorA, "member-a@example.test", "甲方學員");
    guards.manager.mockRejectedValueOnce(new Error("insufficient_role"));
    await expect(action(build(hash))).rejects.toThrow("insufficient_role");
    expect(await rows()).toEqual({ tags: 0, notes: 0, records: 0 });
  });

  it.each(mutations)("%s requires an editable project scope", async (_name, action, build) => {
    const hash = await registrant(vendorA, "member-a@example.test", "甲方學員");
    guards.editable.mockRejectedValueOnce(new Error("aggregate_read_only"));
    await expect(action(build(hash))).rejects.toThrow("aggregate_read_only");
    expect(guards.editable).toHaveBeenCalledWith("synthetic-user", vendorA);
    expect(await rows()).toEqual({ tags: 0, notes: 0, records: 0 });
  });
});
