import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-133: real PostgreSQL, two tenants, two sales projects.
const runtime = vi.hoisted(() => ({ vendorId: "", projectId: null as string | null }));
const guards = vi.hoisted(() => ({ csrf: vi.fn(), manager: vi.fn(), editable: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerContext: async () => {
    await guards.manager();
    return {
    auth: { user: { id: "synthetic-user" }, member: { id: "synthetic-member", role: "owner" } },
    vendor: { id: runtime.vendorId, name: "Synthetic tenant", betaFeatureGrants: ["consultation_booking"] },
    };
  },
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: (form: FormData) => guards.csrf(form) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sales-project-scope", () => ({
  getSalesProjectScope: async () => ({ projectId: runtime.projectId, projectName: null, isAggregate: false, isLegacyWorkspace: !runtime.projectId }),
  requireEditableSalesProjectScope: async (userId: string, vendorId: string) => {
    await guards.editable(userId, vendorId);
    return { projectId: runtime.projectId, projectName: null, isAggregate: false, isLegacyWorkspace: !runtime.projectId };
  },
}));

import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { saveMobileConsultationAction } from "./mobile-consultation-actions";

const db = new PrismaClient();
const vendors: string[] = [];

async function tenant() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Tenant ${id.slice(0, 6)}`, slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  return vendor.id;
}

async function booking(vendorId: string, email: string, projectId: string | null = null) {
  const event = await db.consultationEvent.create({
    data: { vendorId, title: "Synthetic consultation", weeklySchedule: {}, intakeFormFields: [], ...(projectId ? { projectId } : {}) },
  });
  const customerKeyHash = automationCustomerKeyHash(vendorId, email);
  const row = await db.consultationBooking.create({
    data: {
      vendorId, eventId: event.id, startTime: new Date(), endTime: new Date(Date.now() + 1_800_000),
      clientName: "Synthetic client", clientEmail: email, clientPhone: "+886912345678", customerKeyHash,
    },
  });
  return { id: row.id, customerKeyHash };
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
  vendorA = await tenant();
  vendorB = await tenant();
  runtime.vendorId = vendorA;
  runtime.projectId = null;
});
afterEach(async () => { await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => db.$disconnect());

async function crmRowCounts() {
  return {
    records: await db.customerCrmRecord.count({ where: { vendorId: { in: [vendorA, vendorB] } } }),
    notes: await db.consultantNote.count({ where: { vendorId: { in: [vendorA, vendorB] } } }),
    tags: await db.customerTagAssignment.count({ where: { vendorId: { in: [vendorA, vendorB] } } }),
  };
}

describe("mobile consultation action across two tenants", () => {
  it("writes note, allowlisted tag and closed_won for the caller's own booking in one transaction", async () => {
    const own = await booking(vendorA, "member-a@example.test");
    await saveMobileConsultationAction(data({ bookingId: own.id, note: "已確認預算", tag: "預算足夠", closedWon: "true" }));

    const record = await db.customerCrmRecord.findUniqueOrThrow({
      where: { vendorId_customerKeyHash: { vendorId: vendorA, customerKeyHash: own.customerKeyHash } },
      include: { notes: true },
    });
    expect(record.consultationStatus).toBe("closed_won");
    expect(record.notes.map((note) => note.body)).toEqual(["已確認預算"]);
    expect(await db.customerTagAssignment.count({ where: { vendorId: vendorA, customerKeyHash: own.customerKeyHash, tag: "預算足夠" } })).toBe(1);
  });

  it("rejects another tenant's booking id and writes nothing for either tenant", async () => {
    const foreign = await booking(vendorB, "secret-b@example.test");
    await expect(saveMobileConsultationAction(data({ bookingId: foreign.id, note: "跨租戶備註", tag: "需再跟進", closedWon: "true" }))).rejects.toThrow("此預約尚未建立可用的客戶識別");
    expect(await crmRowCounts()).toEqual({ records: 0, notes: 0, tags: 0 });
  });

  it("rejects a non-allowlisted tag and ignores a client-supplied customer hash", async () => {
    const own = await booking(vendorA, "member-a@example.test");
    await expect(saveMobileConsultationAction(data({ bookingId: own.id, tag: "任意標籤" }))).rejects.toThrow();
    expect(await crmRowCounts()).toEqual({ records: 0, notes: 0, tags: 0 });

    const foreign = await booking(vendorB, "secret-b@example.test");
    await saveMobileConsultationAction(data({ bookingId: own.id, note: "只寫自己的客戶", customerKeyHash: foreign.customerKeyHash }));
    expect(await db.customerCrmRecord.count({ where: { vendorId: vendorA, customerKeyHash: foreign.customerKeyHash } })).toBe(0);
    expect(await db.customerCrmRecord.count({ where: { vendorId: vendorA, customerKeyHash: own.customerKeyHash } })).toBe(1);
  });

  it("scopes writes to the selected project: another project's booking and non-members are refused", async () => {
    const projectOne = await db.salesProject.create({ data: { vendorId: vendorA, name: "專案一", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: "draft" } });
    const projectTwo = await db.salesProject.create({ data: { vendorId: vendorA, name: "專案二", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: "draft" } });
    const inTwo = await booking(vendorA, "two@example.test", projectTwo.id);
    const inOneButNotMember = await booking(vendorA, "one@example.test", projectOne.id);
    runtime.projectId = projectOne.id;

    await expect(saveMobileConsultationAction(data({ bookingId: inTwo.id, note: "跨專案" }))).rejects.toThrow("此預約尚未建立可用的客戶識別");
    await expect(saveMobileConsultationAction(data({ bookingId: inOneButNotMember.id, note: "非成員" }))).rejects.toThrow("此客戶不屬於目前專案");
    expect(await crmRowCounts()).toEqual({ records: 0, notes: 0, tags: 0 });
  });
});

describe("mobile consultation action guards", () => {
  it("checks CSRF first with the submitted form and writes nothing when it fails", async () => {
    const own = await booking(vendorA, "member-a@example.test");
    const form = data({ bookingId: own.id, note: "不應寫入" });
    guards.csrf.mockRejectedValueOnce(new Error("csrf_rejected"));
    await expect(saveMobileConsultationAction(form)).rejects.toThrow("csrf_rejected");
    expect(guards.csrf).toHaveBeenCalledWith(form);
    expect(guards.manager).not.toHaveBeenCalled();
    expect(await crmRowCounts()).toEqual({ records: 0, notes: 0, tags: 0 });
  });

  it("rejects a non-manager role and writes nothing", async () => {
    const own = await booking(vendorA, "member-a@example.test");
    guards.manager.mockRejectedValueOnce(new Error("insufficient_role"));
    await expect(saveMobileConsultationAction(data({ bookingId: own.id, note: "不應寫入" }))).rejects.toThrow("insufficient_role");
    expect(guards.editable).not.toHaveBeenCalled();
    expect(await crmRowCounts()).toEqual({ records: 0, notes: 0, tags: 0 });
  });

  it("requires an editable project scope (aggregate overview is read-only) and writes nothing", async () => {
    const own = await booking(vendorA, "member-a@example.test");
    guards.editable.mockRejectedValueOnce(new Error("aggregate_read_only"));
    await expect(saveMobileConsultationAction(data({ bookingId: own.id, note: "不應寫入" }))).rejects.toThrow("aggregate_read_only");
    expect(guards.editable).toHaveBeenCalledWith("synthetic-user", vendorA);
    expect(await crmRowCounts()).toEqual({ records: 0, notes: 0, tags: 0 });
  });
});
