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
import { createMessageTemplateQuickAction, createProductQuickAction, createRegistrationFormQuickAction, createUrlVideoQuickAction } from "./live-resource-quick-create";

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

describe("live studio product quick create on PostgreSQL", () => {
  /** The live pages' product selector (`/lives/new`, and `/lives/[id]/edit` inside a project scope). */
  function listedForStudio(vendorId: string, projectId?: string) {
    return db.product.findMany({
      where: { vendorId, isActive: true, fulfillmentTypeConfirmed: true, ...(projectId ? { salesProjectLinks: { some: { projectId } } } : {}) },
      select: { id: true, name: true, inventory: true },
    });
  }

  it("creates a listed physical TWD product for the session vendor, priced from the whole-dollar input, bound to its own project", async () => {
    const own = await project(runtime.vendorId);
    const otherVendorId = await vendor();
    const foreignProduct = await db.product.create({ data: { vendorId: otherVendorId, name: "別家商品", slug: "foreign", priceCents: 100, inventory: 1 } });

    const result = await createProductQuickAction(input({
      name: " 原型食物餐盒 ",
      price: "1290",
      inventory: "20",
      fulfillmentType: "physical",
      projectId: own.id,
      // Forged fields: none of them may reach the row.
      vendorId: otherVendorId,
      id: foreignProduct.id,
      priceCents: "1",
      currency: "USD",
      checkoutUrl: "https://evil.example.test/pay",
      upsellProductId: foreignProduct.id,
      upsellDiscount: "100",
      isActive: "",
    }));

    expect(result.status).toBe("success");
    const rows = await db.product.findMany({ where: { vendorId: runtime.vendorId }, include: { salesProjectLinks: true, deliveryConfig: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vendorId: runtime.vendorId,
      name: "原型食物餐盒",
      slug: "原型食物餐盒",
      priceCents: 129_000,
      compareAtCents: null,
      currency: "TWD",
      inventory: 20,
      isActive: true,
      fulfillmentType: "physical",
      fulfillmentTypeConfirmed: true,
      commerceDomain: "merchant",
      checkoutUrl: null,
      imageUrl: null,
      imageAssetId: null,
      description: null,
      upsellProductId: null,
      downsellProductId: null,
      courseContentOwnerMembershipId: null,
      coursePromoterShareBps: null,
      deliveryConfig: null,
    });
    expect(rows[0]!.salesProjectLinks).toEqual([expect.objectContaining({ vendorId: runtime.vendorId, projectId: own.id, productId: rows[0]!.id })]);
    expect(result).toEqual({ status: "success", option: { id: rows[0]!.id, name: "原型食物餐盒", inventory: 20 } });
    // Both live pages list it right away, including the edit page inside that project.
    expect(await listedForStudio(runtime.vendorId)).toEqual([{ id: rows[0]!.id, name: "原型食物餐盒", inventory: 20 }]);
    expect(await listedForStudio(runtime.vendorId, own.id)).toEqual([{ id: rows[0]!.id, name: "原型食物餐盒", inventory: 20 }]);
    // The other merchant's product is untouched.
    expect(await db.product.findUniqueOrThrow({ where: { id: foreignProduct.id } })).toMatchObject({ vendorId: otherVendorId, name: "別家商品", priceCents: 100 });
  });

  it("refuses another vendor's project and writes nothing for either vendor", async () => {
    const otherVendorId = await vendor();
    const foreign = await project(otherVendorId);

    const result = await createProductQuickAction(input({ name: "跨商家商品", price: "500", inventory: "3", fulfillmentType: "physical", projectId: foreign.id }));

    expect(result).toMatchObject({ status: "error", message: "找不到目前商家可用的專案，未儲存本次變更。" });
    expect(await db.product.count({ where: { vendorId: { in: [runtime.vendorId, otherVendorId] } } })).toBe(0);
    expect(await db.salesProjectProduct.count({ where: { projectId: foreign.id } })).toBe(0);
  });

  it("refuses an archived project of the same vendor", async () => {
    const archived = await db.salesProject.create({ data: { vendorId: runtime.vendorId, name: "Archived", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: "archived" } });
    const result = await createProductQuickAction(input({ name: "封存專案商品", price: "500", inventory: "3", fulfillmentType: "physical", projectId: archived.id }));
    expect(result.status).toBe("error");
    expect(await db.product.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("adds a suffix when the vendor already has a product at the address derived from the name", async () => {
    const otherVendorId = await vendor();
    await db.product.create({ data: { vendorId: runtime.vendorId, name: "Whole Food Box", slug: "whole-food-box", priceCents: 100, inventory: 1 } });
    await db.product.create({ data: { vendorId: otherVendorId, name: "Whole Food Box", slug: "whole-food-box", priceCents: 100, inventory: 1 } });

    const result = await createProductQuickAction(input({ name: "Whole Food Box", price: "990", inventory: "5", fulfillmentType: "physical" }));

    expect(result.status).toBe("success");
    const created = await db.product.findFirstOrThrow({ where: { vendorId: runtime.vendorId, slug: { not: "whole-food-box" } } });
    expect(created.slug).toMatch(/^whole-food-box-[0-9a-f]{6}$/u);
    expect(created.priceCents).toBe(99_000);
    expect(await db.product.findMany({ where: { vendorId: otherVendorId }, select: { slug: true, priceCents: true } })).toEqual([{ slug: "whole-food-box", priceCents: 100 }]);
  });

  it("keeps the address derived from the name when only another merchant uses it", async () => {
    const otherVendorId = await vendor();
    // Addresses are unique per merchant: another merchant's product at the same address does not matter.
    await db.product.create({ data: { vendorId: otherVendorId, name: "Whole Food Box", slug: "whole-food-box", priceCents: 100, inventory: 1 } });

    const result = await createProductQuickAction(input({ name: "Whole Food Box", price: "990", inventory: "5", fulfillmentType: "physical" }));

    expect(result.status).toBe("success");
    expect(await db.product.findMany({ where: { vendorId: runtime.vendorId }, select: { slug: true, priceCents: true } })).toEqual([{ slug: "whole-food-box", priceCents: 99_000 }]);
    expect(await db.product.findMany({ where: { vendorId: otherVendorId }, select: { slug: true, priceCents: true } })).toEqual([{ slug: "whole-food-box", priceCents: 100 }]);
  });

  it.each([
    { price: "1290.5" },
    { price: "0" },
    { price: "21474837" },
    { inventory: "0" },
    { fulfillmentType: "digital" },
    { fulfillmentType: "course" },
  ])("writes no product for %j", async (patch) => {
    const result = await createProductQuickAction(input({ name: "x", price: "100", inventory: "1", fulfillmentType: "physical", ...patch }));
    expect(result.status).toBe("error");
    expect(await db.product.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("stores the largest whole price the editor accepts", async () => {
    const result = await createProductQuickAction(input({ name: "高價商品", price: "21474836", inventory: "1", fulfillmentType: "physical" }));
    expect(result.status).toBe("success");
    expect(await db.product.findFirstOrThrow({ where: { vendorId: runtime.vendorId } })).toMatchObject({ priceCents: 2_147_483_600, currency: "TWD" });
  });
});
