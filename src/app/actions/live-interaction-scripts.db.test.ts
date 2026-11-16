import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ vendorId: "", database: null as unknown, allowed: true }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.database }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: async () => {
    if (!runtime.allowed) throw new Error("NEXT_REDIRECT");
    return { id: runtime.vendorId, timezone: "Asia/Taipei" };
  },
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));

import { listLiveInteractionScriptsAction } from "./live-interaction-scripts";

// Actual PostgreSQL reads; only the request, CSRF and session boundaries are synthetic.
const db = new PrismaClient();
const vendors: string[] = [];

async function vendor() {
  const id = randomUUID();
  const created = await db.vendor.create({ data: { name: "Synthetic script list", slug: `script-list-${id}`, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(created.id);
  return created.id;
}

function input(values: Record<string, string> = {}) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(async () => {
  runtime.database = db;
  runtime.allowed = true;
  runtime.vendorId = await vendor();
});
afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});
afterAll(async () => db.$disconnect());

describe("live studio script list on PostgreSQL", () => {
  it("returns only the session vendor's published scripts, newest first", async () => {
    const otherVendorId = await vendor();
    const older = await db.interactionScript.create({ data: { vendorId: runtime.vendorId, name: "較舊已發布", status: "published", createdAt: new Date("2026-11-01T00:00:00Z") } });
    const newer = await db.interactionScript.create({ data: { vendorId: runtime.vendorId, name: "較新已發布", status: "published", createdAt: new Date("2026-11-02T00:00:00Z") } });
    await db.interactionScript.create({ data: { vendorId: runtime.vendorId, name: "草稿不列出", status: "draft" } });
    await db.interactionScript.create({ data: { vendorId: otherVendorId, name: "他家已發布", status: "published" } });

    const result = await listLiveInteractionScriptsAction(input());

    expect(result).toEqual({ status: "success", scripts: [{ id: newer.id, name: "較新已發布" }, { id: older.id, name: "較舊已發布" }] });
  });

  it("never lists another vendor's scripts, whatever vendor the input claims", async () => {
    const otherVendorId = await vendor();
    await db.interactionScript.create({ data: { vendorId: otherVendorId, name: "他家已發布", status: "published" } });

    const result = await listLiveInteractionScriptsAction(input({ vendorId: otherVendorId }));

    expect(result).toEqual({ status: "success", scripts: [] });
  });

  it("lists nothing for a caller without vendor manager access", async () => {
    await db.interactionScript.create({ data: { vendorId: runtime.vendorId, name: "已發布", status: "published" } });
    runtime.allowed = false;

    await expect(listLiveInteractionScriptsAction(input())).rejects.toThrow("NEXT_REDIRECT");
  });
});
