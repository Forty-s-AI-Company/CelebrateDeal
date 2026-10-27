import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

/**
 * PostgreSQL: a custom-code save writes the draft and its AuditLog entry in one
 * transaction. A database trigger makes the audit insert fail for one page, and
 * the draft update must roll back with it. All data is synthetic.
 */
const mocks = vi.hoisted(() => ({ manager: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.scope, getSalesProjectScope: mocks.scope }));

import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { LandingPageInputError, saveLandingPageDraft } from "@/lib/landing-page-service";

const vendorIds: string[] = [];
const userIds: string[] = [];
const trigger = `cd_custom_code_audit_fail_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

function codeDocument(js: string): PageDocument {
  const document = createEmptyPageDocument("doc-1");
  const code: FunnelNode = { schemaVersion: 1, id: "code", type: "raw_html", props: { html: "<p>合成</p>", js }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
  document.root = [{
    schemaVersion: 1, id: "section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
    children: [{ schemaVersion: 1, id: "row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [code] }],
  }];
  return JSON.parse(JSON.stringify(document)) as PageDocument;
}

async function tenant(verified: boolean) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic custom code", slug: `custom-code-${suffix}`, email: `custom-code-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: {
    name: "Synthetic owner", email: `custom-code-${suffix}@example.test`, passwordHash: "synthetic-only", emailVerifiedAt: verified ? new Date() : null,
    memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
  } });
  userIds.push(user.id);
  const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Synthetic project", slug: `custom-code-project-${suffix}`, mode: "live_course", primaryFlow: "live" } });
  const page = await db.landingPage.create({ data: {
    vendorId: vendor.id, projectId: project.id, name: "自訂頁", slug: `custom-code-${suffix}`,
    draftContent: createEmptyPageDocument("doc-1") as unknown as Prisma.InputJsonValue,
  } });
  mocks.manager.mockResolvedValue({ auth: { user: { id: user.id, emailVerifiedAt: verified ? new Date() : null }, member: { role: "owner", status: "active" } }, vendor: { id: vendor.id } });
  mocks.scope.mockResolvedValue({ projectId: project.id, projectName: "Synthetic project", isAggregate: false, isLegacyWorkspace: false });
  return { vendorId: vendor.id, userId: user.id, pageId: page.id, slug: page.slug };
}

beforeEach(() => { vi.clearAllMocks(); });

afterAll(async () => {
  const db = getDb();
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "AuditLog"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("custom code save and audit share one transaction", () => {
  it("writes the draft and an audit entry without the code", async () => {
    const { vendorId, userId, pageId, slug } = await tenant(true);
    await expect(saveLandingPageDraft({ id: pageId, revision: 1, name: "自訂頁", slug, content: codeDocument("window.syntheticSecret = 1;") })).resolves.toEqual({ id: pageId, revision: 2 });
    const db = getDb();
    const page = await db.landingPage.findUniqueOrThrow({ where: { id: pageId }, select: { revision: true, draftContent: true } });
    expect(page.revision).toBe(2);
    expect(JSON.stringify(page.draftContent)).toContain("syntheticSecret");
    const audits = await db.auditLog.findMany({ where: { vendorId, targetType: "LandingPage", targetId: pageId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: userId, action: "funnel_custom_code_saved" });
    expect(audits[0]!.after).toMatchObject({ operation: "save", changes: [{ location: "page/node:code", change: "added", fields: ["html", "js"] }] });
    expect(JSON.stringify(audits[0]!.after)).not.toContain("syntheticSecret");
  });

  it("rolls the draft back when the audit insert fails", async () => {
    const { vendorId, pageId, slug } = await tenant(true);
    const db = getDb();
    await db.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."targetId" = '${pageId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    try {
      await expect(saveLandingPageDraft({ id: pageId, revision: 1, name: "自訂頁", slug, content: codeDocument("run();") })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "AuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    const page = await db.landingPage.findUniqueOrThrow({ where: { id: pageId }, select: { revision: true, draftContent: true } });
    expect(page.revision).toBe(1);
    expect(JSON.stringify(page.draftContent)).not.toContain("run();");
    expect(await db.auditLog.count({ where: { vendorId, targetId: pageId } })).toBe(0);
  });

  it("refuses JS from an unverified e-mail without touching the database", async () => {
    const { vendorId, pageId, slug } = await tenant(false);
    await expect(saveLandingPageDraft({ id: pageId, revision: 1, name: "自訂頁", slug, content: codeDocument("run();") })).rejects.toBeInstanceOf(LandingPageInputError);
    const db = getDb();
    expect((await db.landingPage.findUniqueOrThrow({ where: { id: pageId }, select: { revision: true } })).revision).toBe(1);
    expect(await db.auditLog.count({ where: { vendorId, targetId: pageId } })).toBe(0);
  });
});
