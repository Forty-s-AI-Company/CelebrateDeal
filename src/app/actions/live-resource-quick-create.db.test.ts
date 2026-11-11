import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ vendorId: "", userId: "", database: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.database }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: async () => ({ id: runtime.vendorId, timezone: "Asia/Taipei" }),
  requireVendorManagerContext: async () => ({
    auth: { user: { id: runtime.userId }, member: { role: "owner" } },
    vendor: { id: runtime.vendorId, timezone: "Asia/Taipei" },
  }),
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { toSlug } from "@/lib/format";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import { createMessageTemplateQuickAction, createRegistrationFormQuickAction, createUrlVideoQuickAction } from "./live-resource-quick-create";

// Actual PostgreSQL writes; only the request, CSRF and session boundaries are synthetic.
const db = new PrismaClient();
const vendors: string[] = [];

async function vendor() {
  const id = randomUUID();
  const created = await db.vendor.create({ data: { name: "Synthetic quick create", slug: `quick-create-${id}`, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(created.id);
  return created.id;
}

async function project(vendorId: string) {
  return db.salesProject.create({ data: { vendorId, name: "Synthetic project", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: "draft" } });
}

function input(values: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(async () => {
  runtime.database = db;
  runtime.vendorId = await vendor();
  runtime.userId = `synthetic-user-${randomUUID()}`;
});
afterEach(async () => {
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});
afterAll(async () => db.$disconnect());

describe("live studio quick create on PostgreSQL", () => {
  it("creates the form for the session vendor bound to its own project", async () => {
    const own = await project(runtime.vendorId);
    const name = `快速報名表 ${randomUUID()}`;

    const result = await createRegistrationFormQuickAction(input({ name, headline: "週五講座", projectId: own.id, vendorId: "forged-vendor" }));

    expect(result.status).toBe("success");
    const rows = await db.registrationForm.findMany({ where: { vendorId: runtime.vendorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: runtime.vendorId, projectId: own.id, name, headline: "週五講座", isActive: true });
    expect(result).toEqual({ status: "success", option: { id: rows[0]!.id, name } });
  });

  it("refuses another vendor's project and writes nothing for either vendor", async () => {
    const otherVendorId = await vendor();
    const foreign = await project(otherVendorId);

    const result = await createRegistrationFormQuickAction(input({ name: "跨商家報名表", headline: "x", projectId: foreign.id }));

    expect(result).toMatchObject({ status: "error", message: "找不到目前商家可用的專案，未儲存本次變更。" });
    expect(await db.registrationForm.count({ where: { vendorId: { in: [runtime.vendorId, otherVendorId] } } })).toBe(0);
  });

  it("adds a suffix when another merchant already uses the address derived from the name", async () => {
    const otherVendorId = await vendor();
    const name = `Summer Launch ${randomUUID().slice(0, 8)}`;
    await db.registrationForm.create({ data: { vendorId: otherVendorId, name: "taken", slug: toSlug(name), headline: "taken", fields: [] } });

    const result = await createRegistrationFormQuickAction(input({ name, headline: "Summer" }));

    expect(result.status).toBe("success");
    const created = await db.registrationForm.findFirstOrThrow({ where: { vendorId: runtime.vendorId } });
    expect(created.slug).toMatch(new RegExp(`^${toSlug(name)}-[0-9a-f]{6}$`, "u"));
    // The other merchant's form is untouched.
    expect(await db.registrationForm.count({ where: { vendorId: otherVendorId } })).toBe(1);
  });

  it("creates an active, sendable Email template for the session vendor and audits it", async () => {
    const result = await createMessageTemplateQuickAction(input({
      trigger: "live_reminder",
      name: "開播提醒",
      subject: "{{live_title}} 即將開始",
      body: "{{name}} 你好，{{live_url}}",
      channel: "line",
      vendorId: "forged-vendor",
    }));

    expect(result.status).toBe("success");
    const rows = await db.messageTemplate.findMany({ where: { vendorId: runtime.vendorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: runtime.vendorId, channel: "email", trigger: "live_reminder", isActive: true, name: "開播提醒" });
    expect(result).toEqual({ status: "success", option: { id: rows[0]!.id, name: "開播提醒", channel: "email", trigger: "live_reminder" } });
    expect(await db.auditLog.count({ where: { vendorId: runtime.vendorId, action: "message_template_created", targetId: rows[0]!.id } })).toBe(1);
  });

  it("creates a live-ready external URL video for the session vendor only, ignoring a forged id and vendor", async () => {
    const otherVendorId = await vendor();
    const foreign = await db.video.create({ data: { vendorId: otherVendorId, title: "別家影片", sourceType: "url", videoUrl: "https://media.example.test/foreign.mp4", status: "ready" } });

    const result = await createUrlVideoQuickAction(input({
      title: "週五講座錄影",
      videoUrl: "https://media.example.test/live.mp4",
      id: foreign.id,
      vendorId: otherVendorId,
      status: "archived",
    }));

    expect(result.status).toBe("success");
    const rows = await db.video.findMany({ where: { vendorId: runtime.vendorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: runtime.vendorId, title: "週五講座錄影", sourceType: "url", status: "ready", videoUrl: "https://media.example.test/live.mp4" });
    expect(result).toEqual({ status: "success", option: { id: rows[0]!.id, title: "週五講座錄影" }, ready: true });
    // The same selector the live pages use lists it right away.
    expect(await db.video.count({ where: liveReadyVideoWhere(runtime.vendorId, rows[0]!.id) })).toBe(1);
    // The other vendor's video is untouched.
    expect(await db.video.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ vendorId: otherVendorId, title: "別家影片", status: "ready" });
    expect(await db.video.count({ where: { vendorId: otherVendorId } })).toBe(1);
  });

  it("writes no video for an unsafe URL", async () => {
    const result = await createUrlVideoQuickAction(input({ title: "x", videoUrl: "javascript:alert(1)" }));
    expect(result.status).toBe("error");
    expect(await db.video.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("writes no template for a trigger the studio cannot bind", async () => {
    const result = await createMessageTemplateQuickAction(input({ trigger: "order_paid", name: "x", subject: "x", body: "x" }));
    expect(result.status).toBe("error");
    expect(await db.messageTemplate.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });
});
