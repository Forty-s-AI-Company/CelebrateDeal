import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTwoTenantFixture,
  formData,
  type TenantActor,
  type TenantData,
  type TwoTenantFixture,
} from "@/test/two-tenant-fixture";
import { withAllFeatures } from "@/test/two-tenant-fixture-extras";
import { addTenantContent, type TenantContent } from "@/test/two-tenant-fixture-content";

// A2-06 (R-05 / F-134 third batch): the second-tenant matrix for the team
// funnel Server Actions (team templates, partner pages, template share codes
// and Live shares). Each tenant has a sales team in which the owner is the
// support member's direct upline and owns a webinar, a template version with a
// product slot, its source page, a template share code and a Live share. Only
// the session, CSRF and navigation boundaries are synthetic. A "foreign" row
// hands tenant B's team, page, template, product, webinar, membership or share
// code to a tenant-A member; an "own" row is the same call with tenant A's
// identifiers and must go through.
const runtime = vi.hoisted(() => ({ actor: null as unknown }));

vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
  notFound: (): never => {
    throw new Error("not_found");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
  assertServerActionSecurity: vi.fn(async () => undefined),
  assertServerActionOrigin: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  const current = () => runtime.actor as TenantActor;
  const session = { id: "synthetic-session" };
  return {
    ...original,
    requireAuth: async () => ({ user: current().user, member: current().member, vendor: current().vendor, session, isPlatformAdmin: false }),
    requireVendor: async () => current().vendor,
  };
});

import { createTeamLiveShareAction, disableTeamLiveShareAction, initialTeamLiveShareActionState } from "./team-funnel-live-share-actions";
import { claimTeamTemplateAction, savePartnerPageAction, setPartnerPagePublishAction } from "./team-funnel-partner-actions";
import { manageTeamFunnelTemplateAction } from "./team-funnel-template-actions";

const db = new PrismaClient();
let fixture: TwoTenantFixture;
let content: { a: TenantContent; b: TenantContent };

type Tenant = TenantData & { c: TenantContent };
type Fix = { a: Tenant; b: Tenant };

async function snapshot(vendorId: string) {
  const byVendor = { where: { vendorId }, orderBy: { id: "asc" as const } };
  return JSON.stringify([
    await db.teamFunnelTemplate.findMany(byVendor),
    await db.teamFunnelTemplateVersion.findMany(byVendor),
    await db.teamFunnelTemplateProductSlot.findMany(byVendor),
    await db.partnerFunnelPage.findMany(byVendor),
    await db.partnerFunnelPageShareSetting.findMany({ where: { page: { vendorId } }, orderBy: { id: "asc" } }),
    await db.partnerProductSlotOverride.findMany(byVendor),
    await db.partnerLiveShare.findMany(byVendor),
    await db.live.findMany(byVendor),
    await db.teamMembership.findMany(byVendor),
    await db.auditLog.count({ where: { vendorId } }),
  ]);
}

async function outcome(run: () => Promise<unknown>) {
  try {
    const value = await run();
    if (value && typeof value === "object" && "status" in value && "message" in value) {
      const state = value as { status: string; message: string };
      return `state:${state.status}:${state.message}`;
    }
    return `value:${JSON.stringify(value) ?? "undefined"}`;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${error.code}`;
    if (error instanceof Error) return `error:${error.message}`;
    throw error;
  }
}

type Row = {
  name: string;
  actor?: (f: Fix) => TenantActor;
  run: (f: Fix) => Promise<unknown>;
  expected: string;
  verify?: (f: Fix) => Promise<void>;
};

const owner = (f: Fix) => f.a.actors.owner;
const support = (f: Fix) => f.a.actors.support;
const idle = { status: "idle" as const, message: "" };

const TEMPLATE_DENIED = "state:error:你沒有管理這個團隊模板的權限，或該資源已不存在。";
const PAGE_DENIED = "state:error:你沒有存取這個夥伴頁的權限，或它已不再可用。";
const SHARE_UNAVAILABLE = "state:error:此分享連結已過期、已停用，或不屬於你的團隊。";
const LIVE_SHARE_DENIED = "state:error:你沒有管理這個 Live 分享的權限，或來源頁已不存在。";
const LIVE_SHARE_CONFLICT = "state:error:這個 Live 目前不能分享，請確認頁面 owner、直播狀態與上下線關係。";

const templateForm = (teamId: string, fields: Record<string, string>) => formData({
  teamId, name: `合成模板 ${randomUUID().slice(0, 8)}`, slug: `tpl-${randomUUID()}`, headline: "合成標題", ctaLabel: "立即報名", ctaUrl: "https://example.test/join", ...fields,
});
const pageForm = (teamId: string, pageId: string, fields: Record<string, string> = {}) => formData({
  teamId, pageId, headline: "夥伴標題", subheadline: "副標", body: "內文", ctaLabel: "加入", ctaUrl: "https://example.test/partner", ...fields,
});
const liveShareForm = (teamId: string, pageId: string, promoterMembershipId: string) => formData({ teamId, pageId, promoterMembershipId });
const claimForm = (teamId: string, shareCode: string) => formData({ teamId, shareCode, mode: "QUICK_APPLY", slug: `claim-${randomUUID()}`, confirmed: "yes" });

const foreignRows: Row[] = [
  // Team templates (manageTeamFunnelTemplateAction).
  {
    name: "team template: create a template inside tenant B's team",
    run: (f) => manageTeamFunnelTemplateAction(idle, templateForm(f.b.teamId, { operation: "create" })),
    expected: TEMPLATE_DENIED,
  },
  {
    name: "team template: create a template that sells tenant B's product",
    run: (f) => manageTeamFunnelTemplateAction(idle, templateForm(f.a.teamId, { operation: "create", product_main_product: f.b.productId })),
    expected: TEMPLATE_DENIED,
  },
  {
    name: "team template: create a template bound to tenant B's team webinar",
    run: (f) => manageTeamFunnelTemplateAction(idle, templateForm(f.a.teamId, { operation: "create", webinarId: f.b.c.team.liveId })),
    expected: TEMPLATE_DENIED,
  },
  {
    name: "team template: publish a new version of tenant B's template",
    run: (f) => manageTeamFunnelTemplateAction(idle, templateForm(f.a.teamId, { operation: "publish", templateId: f.b.c.team.templateId, sourcePageId: f.b.c.team.sourcePageId })),
    expected: TEMPLATE_DENIED,
  },
  {
    name: "team template: publish own template onto tenant B's source page",
    run: (f) => manageTeamFunnelTemplateAction(idle, templateForm(f.a.teamId, { operation: "publish", templateId: f.a.c.team.templateId, sourcePageId: f.b.c.team.sourcePageId })),
    expected: TEMPLATE_DENIED,
  },
  {
    name: "team template: issue a share code for tenant B's source page",
    run: (f) => manageTeamFunnelTemplateAction(idle, formData({ operation: "create-share", teamId: f.a.teamId, pageId: f.b.c.team.sourcePageId })),
    expected: TEMPLATE_DENIED,
  },
  {
    name: "team template: disable tenant B's share code",
    run: (f) => manageTeamFunnelTemplateAction(idle, formData({ operation: "disable-share", teamId: f.a.teamId, pageId: f.b.c.team.sourcePageId })),
    expected: TEMPLATE_DENIED,
  },
  // Partner pages (team-funnel-partner-actions.ts).
  {
    name: "partner page: claim tenant B's template with B's real share code",
    actor: support,
    run: (f) => claimTeamTemplateAction(idle, claimForm(f.a.teamId, f.b.c.team.shareCode)),
    expected: SHARE_UNAVAILABLE,
  },
  {
    name: "partner page: claim tenant B's share code inside tenant B's team",
    actor: support,
    run: (f) => claimTeamTemplateAction(idle, claimForm(f.b.teamId, f.b.c.team.shareCode)),
    expected: "state:error:你沒有存取這個夥伴頁的權限，或它已不再可用。",
  },
  {
    name: "partner page: edit tenant B's page text",
    run: (f) => savePartnerPageAction(idle, pageForm(f.a.teamId, f.b.c.team.sourcePageId)),
    expected: PAGE_DENIED,
  },
  {
    name: "partner page: edit tenant B's page through tenant B's team id",
    run: (f) => savePartnerPageAction(idle, pageForm(f.b.teamId, f.b.c.team.sourcePageId)),
    expected: PAGE_DENIED,
  },
  {
    name: "partner page: publish tenant B's page",
    run: (f) => setPartnerPagePublishAction(idle, formData({ teamId: f.a.teamId, pageId: f.b.c.team.sourcePageId, publish: "true" })),
    expected: PAGE_DENIED,
  },
  // Live shares (team-funnel-live-share-actions.ts).
  {
    name: "Live share: share tenant B's webinar page with tenant A's member",
    run: (f) => createTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.a.teamId, f.b.c.team.sourcePageId, f.a.supportTeamMembershipId)),
    expected: LIVE_SHARE_DENIED,
  },
  {
    name: "Live share: share tenant A's webinar page with tenant B's member",
    run: (f) => createTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.a.teamId, f.a.c.team.sourcePageId, f.b.supportTeamMembershipId)),
    expected: LIVE_SHARE_CONFLICT,
  },
  {
    name: "Live share: share inside tenant B's team",
    run: (f) => createTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.b.teamId, f.b.c.team.sourcePageId, f.b.supportTeamMembershipId)),
    expected: LIVE_SHARE_DENIED,
  },
  {
    name: "Live share: disable tenant B's Live share",
    run: (f) => disableTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.a.teamId, f.b.c.team.sourcePageId, f.b.supportTeamMembershipId)),
    expected: LIVE_SHARE_DENIED,
  },
  {
    name: "Live share: disable tenant B's member share through tenant A's page",
    run: (f) => disableTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.a.teamId, f.a.c.team.sourcePageId, f.b.supportTeamMembershipId)),
    expected: "state:error:這個 Live 分享已不存在、過期或已停用。",
  },
];

const ownRows: Row[] = [
  {
    name: "team template: create with own product and webinar, publish v2, issue and disable a share code",
    run: async (f) => {
      expect(await outcome(() => manageTeamFunnelTemplateAction(idle, templateForm(f.a.teamId, { operation: "create", product_main_product: f.a.productId, webinarId: f.a.c.team.liveId }))))
        .toBe("state:success:原始頁與第一個模板版本已建立。");
      expect(await outcome(() => manageTeamFunnelTemplateAction(idle, templateForm(f.a.teamId, { operation: "publish", templateId: f.a.c.team.templateId, sourcePageId: f.a.c.team.sourcePageId, webinarId: f.a.c.team.liveId }))))
        .toBe("state:success:版本 v2 已發布。既有夥伴副本不會被覆寫。");
      expect(await outcome(() => manageTeamFunnelTemplateAction(idle, formData({ operation: "create-share", teamId: f.a.teamId, pageId: f.a.c.team.sourcePageId }))))
        .toContain("state:success:分享連結已建立。");
      return manageTeamFunnelTemplateAction(idle, formData({ operation: "disable-share", teamId: f.a.teamId, pageId: f.a.c.team.sourcePageId }));
    },
    expected: "state:success:分享連結已停用",
    verify: async (f) => {
      expect(await db.teamFunnelTemplate.count({ where: { vendorId: f.a.vendor.id } })).toBe(2);
      expect(await db.teamFunnelTemplateVersion.count({ where: { templateId: f.a.c.team.templateId } })).toBe(2);
      expect((await db.partnerFunnelPageShareSetting.findUniqueOrThrow({ where: { pageId: f.a.c.team.sourcePageId } })).isEnabled).toBe(false);
    },
  },
  {
    name: "partner page: the direct downline claims own team's template with its share code",
    actor: support,
    run: (f) => claimTeamTemplateAction(idle, claimForm(f.a.teamId, f.a.c.team.shareCode)),
    expected: "redirect:/partner-pages/",
    verify: async (f) => {
      expect(await db.partnerFunnelPage.count({ where: { vendorId: f.a.vendor.id, promoterMembershipId: f.a.supportTeamMembershipId } })).toBe(1);
    },
  },
  {
    name: "partner page: edit own page text and product slot, then publish it",
    run: async (f) => {
      expect(await outcome(() => savePartnerPageAction(idle, pageForm(f.a.teamId, f.a.c.team.sourcePageId, { product_main_product: f.a.productId }))))
        .toBe("state:success:夥伴頁已儲存。");
      return setPartnerPagePublishAction(idle, formData({ teamId: f.a.teamId, pageId: f.a.c.team.sourcePageId, publish: "true" }));
    },
    expected: "state:success:夥伴頁已發布。",
    verify: async (f) => {
      expect((await db.partnerFunnelPage.findUniqueOrThrow({ where: { id: f.a.c.team.sourcePageId } })).headline).toBe("夥伴標題");
      expect(await db.partnerProductSlotOverride.findFirstOrThrow({ where: { pageId: f.a.c.team.sourcePageId } })).toMatchObject({ vendorId: f.a.vendor.id, productId: f.a.productId });
    },
  },
  {
    name: "Live share: share own webinar page with the direct downline, then disable it",
    run: async (f) => {
      expect(await outcome(() => createTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.a.teamId, f.a.c.team.sourcePageId, f.a.supportTeamMembershipId))))
        .toContain("state:success:Live 分享連結已建立");
      return disableTeamLiveShareAction(initialTeamLiveShareActionState, liveShareForm(f.a.teamId, f.a.c.team.sourcePageId, f.a.supportTeamMembershipId));
    },
    expected: "state:success:Live 分享已停用。",
    verify: async (f) => {
      expect((await db.partnerLiveShare.findUniqueOrThrow({ where: { id: f.a.c.team.liveShareId } })).isEnabled).toBe(false);
    },
  },
];

async function buildFixture() {
  fixture = await createTwoTenantFixture(db);
  content = { a: await addTenantContent(db, fixture.a, "A"), b: await addTenantContent(db, fixture.b, "B") };
}

afterAll(async () => {
  await db.$disconnect();
});

function view(): Fix {
  return { a: { ...fixture.a, c: content.a }, b: { ...fixture.b, c: content.b } };
}

describe("second-tenant matrix (team funnel): foreign identifiers are refused and nothing is written", () => {
  // Foreign rows prove that nothing changes, so they share one fixture.
  beforeAll(buildFixture);
  afterAll(async () => fixture?.cleanup());

  it.each(foreignRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    runtime.actor = withAllFeatures((row.actor ?? owner)(f));
    const [beforeA, beforeB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];

    const result = await outcome(() => row.run(f));
    expect(result).toContain(row.expected);
    for (const secret of [f.b.c.team.shareCode, "B 標題"]) expect(result).not.toContain(secret);

    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
    expect(await snapshot(f.a.vendor.id)).toBe(beforeA);
  });

});

describe("second-tenant matrix (team funnel): a foreign product on an own page", () => {
  beforeEach(buildFixture);
  afterEach(async () => fixture?.cleanup());

  it("an own page saved with tenant B's product never stores the foreign product and writes nothing else", async () => {
    const f = view();
    runtime.actor = withAllFeatures(owner(f));
    const [beforeA, beforeB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];
    const headlineBefore = (await db.partnerFunnelPage.findUniqueOrThrow({ where: { id: f.a.c.team.sourcePageId } })).headline;
    expect(headlineBefore).not.toBe("夥伴標題");

    expect(await outcome(() => savePartnerPageAction(idle, pageForm(f.a.teamId, f.a.c.team.sourcePageId, { product_main_product: f.b.productId }))))
      .toBe(PAGE_DENIED);

    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
    expect(await db.partnerProductSlotOverride.count({ where: { OR: [{ pageId: f.a.c.team.sourcePageId }, { productId: f.b.productId }] } })).toBe(0);
    // A3-02 (was locked as a partial write by #666): every field and slot is
    // validated before anything is written, so tenant A's own copy is not
    // saved behind the error either.
    expect((await db.partnerFunnelPage.findUniqueOrThrow({ where: { id: f.a.c.team.sourcePageId } })).headline).toBe(headlineBefore);
    expect(await snapshot(f.a.vendor.id)).toBe(beforeA);
  });

  it("an own page with valid copy and an unsafe product link writes nothing", async () => {
    const f = view();
    runtime.actor = withAllFeatures(owner(f));
    const beforeA = await snapshot(f.a.vendor.id);

    expect(await outcome(() => savePartnerPageAction(idle, pageForm(f.a.teamId, f.a.c.team.sourcePageId, {
      product_main_product: f.a.productId,
      url_main_product: "javascript:alert(1)",
    })))).toBe("state:error:商品連結必須是有效的 http 或 https 完整網址。");

    expect(await snapshot(f.a.vendor.id)).toBe(beforeA);
  });

  it("an own page saved after a refusal writes copy and product slot together", async () => {
    const f = view();
    runtime.actor = withAllFeatures(owner(f));
    expect(await outcome(() => savePartnerPageAction(idle, pageForm(f.a.teamId, f.a.c.team.sourcePageId, { product_main_product: f.b.productId }))))
      .toBe(PAGE_DENIED);

    expect(await outcome(() => savePartnerPageAction(idle, pageForm(f.a.teamId, f.a.c.team.sourcePageId, { product_main_product: f.a.productId }))))
      .toBe("state:success:夥伴頁已儲存。");

    expect((await db.partnerFunnelPage.findUniqueOrThrow({ where: { id: f.a.c.team.sourcePageId } })).headline).toBe("夥伴標題");
    expect(await db.partnerProductSlotOverride.findMany({ where: { pageId: f.a.c.team.sourcePageId }, select: { vendorId: true, productId: true } }))
      .toEqual([{ vendorId: f.a.vendor.id, productId: f.a.productId }]);
  });
});

describe("second-tenant matrix (team funnel): the same actions with own identifiers go through", () => {
  beforeEach(buildFixture);
  afterEach(async () => fixture?.cleanup());

  it.each(ownRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    runtime.actor = withAllFeatures((row.actor ?? owner)(f));
    const beforeB = await snapshot(f.b.vendor.id);

    const result = await outcome(() => row.run(f));
    expect(result).toContain(row.expected);
    await row.verify?.(f);

    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
  });
});
