import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-133: renders the real page against PostgreSQL for two tenants.
const runtime = vi.hoisted(() => ({ vendorId: "", projectId: null as string | null, aggregate: false }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerContext: async () => ({
    auth: { user: { id: "synthetic-user" }, member: { id: "synthetic-member", role: "owner" } },
    vendor: { id: runtime.vendorId, name: "Synthetic tenant", betaFeatureGrants: ["consultation_booking"] },
  }),
}));
vi.mock("@/lib/sales-project-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sales-project-scope")>()),
  getSalesProjectScope: async () => ({ projectId: runtime.projectId, projectName: null, isAggregate: runtime.aggregate, isLegacyWorkspace: !runtime.projectId }),
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/app/actions/mobile-consultation-actions", () => ({ saveMobileConsultationAction: vi.fn() }));

import MobileConsultationsPage from "./page";

const db = new PrismaClient();
const vendors: string[] = [];

async function tenant() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Tenant ${id.slice(0, 6)}`, slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  return vendor.id;
}

async function todaysBooking(vendorId: string, clientName: string, eventTitle: string) {
  const event = await db.consultationEvent.create({ data: { vendorId, title: eventTitle, weeklySchedule: {}, intakeFormFields: [] } });
  const start = new Date();
  await db.consultationBooking.create({
    data: {
      vendorId, eventId: event.id, startTime: start, endTime: new Date(start.getTime() + 1_800_000), clientName,
      clientEmail: `${randomUUID()}@example.test`, clientPhone: "+886912345678", customerKeyHash: randomUUID().replaceAll("-", "").repeat(2),
      status: "scheduled", meetingUrl: "https://meet.example.test/room",
    },
  });
}

let vendorA = "";
let vendorB = "";
beforeEach(async () => {
  vendorA = await tenant();
  vendorB = await tenant();
  runtime.vendorId = vendorA;
  runtime.projectId = null;
  runtime.aggregate = false;
  await todaysBooking(vendorA, "甲方客戶", "甲方諮詢");
  await todaysBooking(vendorB, "乙方客戶", "乙方諮詢");
});
afterEach(async () => { await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => db.$disconnect());

describe("mobile consultation page", () => {
  it("shows only the signed-in tenant consultations with touch-sized call, meeting and quick-note actions", async () => {
    const html = renderToStaticMarkup(await MobileConsultationsPage());
    expect(html).toContain("甲方客戶");
    expect(html).toContain("甲方諮詢");
    expect(html).not.toContain("乙方客戶");
    expect(html).not.toContain("乙方諮詢");
    for (const copy of ["今日諮詢", "立即撥打", "開啟視訊", "快速備註", "預算足夠", "需再跟進", "標記成交"]) expect(html).toContain(copy);
    expect(html).toContain("min-h-12");
    expect(html).toContain("共 1 場");
  });

  it("switches tenants without leaking the previous tenant schedule", async () => {
    runtime.vendorId = vendorB;
    const html = renderToStaticMarkup(await MobileConsultationsPage());
    expect(html).toContain("乙方客戶");
    expect(html).not.toContain("甲方客戶");
  });

  it("makes the all-project overview read-only: no write form is rendered", async () => {
    runtime.aggregate = true;
    const html = renderToStaticMarkup(await MobileConsultationsPage());
    expect(html).toContain("全部專案總覽為唯讀模式");
    expect(html).toContain("甲方客戶");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="closedWon"');
  });
});
