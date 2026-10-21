import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-133: renders the real page against PostgreSQL for two tenants.
const runtime = vi.hoisted(() => ({ vendorId: "", projectId: null as string | null }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerContext: async () => ({
    auth: { user: { id: "synthetic-user" }, member: { id: "synthetic-member", role: "owner" } },
    vendor: { id: runtime.vendorId, name: "Synthetic tenant" },
  }),
}));
vi.mock("@/lib/sales-project-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sales-project-scope")>()),
  getSalesProjectScope: async () => ({ projectId: runtime.projectId, projectName: null, isAggregate: false, isLegacyWorkspace: !runtime.projectId }),
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/app/actions/customer-crm-actions", () => ({ searchCustomersAction: vi.fn() }));

import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import CustomersPage from "./page";

const db = new PrismaClient();
const vendors: string[] = [];

async function tenant() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Tenant ${id.slice(0, 6)}`, slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  return vendor.id;
}

async function learner(vendorId: string, email: string, name: string) {
  const form = await db.registrationForm.create({
    data: { vendorId, name: "Synthetic form", slug: randomUUID(), headline: "Register", fields: [{ key: "name", label: "姓名", type: "text", required: true }], isActive: true },
  });
  await db.formSubmission.create({ data: { formId: form.id, name, email, phone: "0912345678", customerKeyHash: automationCustomerKeyHash(vendorId, email), verificationStatus: "VERIFIED" } });
}

let vendorA = "";
let vendorB = "";
beforeEach(async () => {
  vendorA = await tenant();
  vendorB = await tenant();
  runtime.vendorId = vendorA;
  runtime.projectId = null;
  await learner(vendorA, "member-a@example.test", "甲方學員");
  await learner(vendorB, "secret-b@example.test", "乙方學員");
});
afterEach(async () => { await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => db.$disconnect());

describe("customer CRM page", () => {
  it("lists only the signed-in tenant learners with masked contacts and a detail link", async () => {
    const html = renderToStaticMarkup(await CustomersPage());
    expect(html).toContain("甲方學員");
    expect(html).not.toContain("乙方學員");
    expect(html).toContain("成交轉換率");
    expect(html).toContain("搜尋姓名、Email 或電話");
    expect(html).toContain("/customers/");
    // Raw contact details never reach the markup; only masked ones do.
    expect(html).not.toContain("member-a@example.test");
    expect(html).not.toContain("secret-b");
    expect(html).not.toContain("0912345678");
    expect(html).toMatch(/me\*+@example\.test/);
  });

  it("shows the other tenant own data when signed in as that tenant", async () => {
    runtime.vendorId = vendorB;
    const html = renderToStaticMarkup(await CustomersPage());
    expect(html).toContain("乙方學員");
    expect(html).not.toContain("甲方學員");
  });

  it("limits a selected project to its member learners", async () => {
    const project = await db.salesProject.create({ data: { vendorId: vendorA, name: "Synthetic project", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: "draft" } });
    runtime.projectId = project.id;
    const html = renderToStaticMarkup(await CustomersPage());
    expect(html).not.toContain("甲方學員");
    expect(html).toContain("全部學員");
  });
});
