import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const owner = {
  id: "member-a", vendorId: "vendor-1", teamId: "team-1", vendorMemberId: "vendor-member-a", userId: "user-a",
  status: "ACTIVE" as const, leftAt: null, vendorMemberStatus: "active", vendorMemberDeactivatedAt: null,
};
const partner = { ...owner, id: "member-b", vendorMemberId: "vendor-member-b", userId: "user-b" };

const db = {
  teamMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn() },
  teamFunnelTemplateVersion: { findFirst: vi.fn() },
  teamFunnelTemplateProductSlot: { findFirst: vi.fn(), create: vi.fn() },
  partnerProductSlotOverride: { upsert: vi.fn() },
  product: { findFirst: vi.fn() },
};
const requireAuth = vi.fn();
const requireVendor = vi.fn();

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuth(...args),
  requireVendor: (...args: unknown[]) => requireVendor(...args),
}));

import { POST as partnerProfilePost } from "@/app/api/team-funnel/partner-profile/route";
import { POST as productSlotsPost } from "@/app/api/team-funnel/product-slots/route";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  TeamFunnelInvalidProductUrlError,
  assertSafeTeamFunnelProductUrl,
  createTeamFunnelTemplateProductSlot,
  parseSafeTeamFunnelProductUrl,
  resolveTeamFunnelPartnerProfile,
  resolveTeamFunnelProductSlot,
  resolveTeamFunnelProductSlots,
  upsertTeamFunnelPartnerProductSlotOverride,
} from "@/lib/team-funnel-product-slots";

function membershipRecord(value = owner) {
  return {
    id: value.id, vendorId: value.vendorId, teamId: value.teamId, vendorMemberId: value.vendorMemberId,
    status: value.status, leftAt: value.leftAt,
    vendorMember: { userId: value.userId, status: value.vendorMemberStatus, deactivatedAt: value.vendorMemberDeactivatedAt },
  };
}

function attribution() {
  return {
    pageId: "page-b", vendorId: owner.vendorId, teamId: owner.teamId,
    leaderMembershipId: owner.id, promoterMembershipId: partner.id,
    contentOwnerMembershipId: owner.id, seminarOwnerMembershipId: null,
  };
}

function persistedPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-b", vendorId: owner.vendorId, teamId: owner.teamId,
    promoterMembershipId: partner.id, contentOwnerMembershipId: owner.id,
    live: null,
    templateVersion: {
      fieldLocks: [],
      productSlots: [{
        id: "slot-main", slotKey: "main_product", productId: "product-default", displayOrder: 0, offerLabel: "Starter",
        product: { id: "product-default", checkoutUrl: "https://shop.example.test/default" },
      }],
    },
    productOverrides: [],
    ...overrides,
  };
}

function request(path: string, body: unknown) {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.test", "x-celebratedeal-client": "web" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: partner.userId }, member: { id: partner.vendorMemberId, status: "active", deactivatedAt: null } });
  requireVendor.mockResolvedValue({ id: partner.vendorId });
  db.teamMembership.findFirst.mockResolvedValue(membershipRecord(partner));
  db.teamMembership.findMany.mockResolvedValue([membershipRecord(owner), membershipRecord(partner)]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([
    { teamId: owner.teamId, uplineMembershipId: owner.id, downlineMembershipId: partner.id, effectiveAt: new Date("2026-01-01"), endedAt: null },
  ]);
  db.partnerFunnelPage.findFirst.mockResolvedValue(persistedPage());
  db.partnerProductSlotOverride.upsert.mockResolvedValue({ id: "override-1", pageId: "page-b", productSlotId: "slot-main" });
});

afterEach(() => vi.restoreAllMocks());

describe("team-funnel product slot pure functions", () => {
  it("resolves B's URL first, then the template product default, then an explicit missing state", () => {
    const templateSlot = {
      id: "slot-main", slotKey: "main_product", productId: "product-default", offerLabel: "Starter",
      product: { id: "product-default", checkoutUrl: "https://shop.example.test/default" },
    } as const;

    expect(resolveTeamFunnelProductSlot({
      slotKey: "main_product", templateSlot,
      partnerOverride: { productSlotId: "slot-main", overrideUrl: "https://b.example.test/offer" }, attribution: attribution(),
    })).toMatchObject({
      source: "partner_override", url: "https://b.example.test/offer", productId: "product-default",
      attribution: { promoterMembershipId: partner.id, contentOwnerMembershipId: owner.id },
    });
    expect(resolveTeamFunnelProductSlot({ slotKey: "main_product", templateSlot, attribution: attribution() }))
      .toMatchObject({ source: "template_default", url: "https://shop.example.test/default" });
    expect(resolveTeamFunnelProductSlot({
      slotKey: "main_product", templateSlot: { ...templateSlot, product: { id: "product-default", checkoutUrl: null } }, attribution: attribution(),
    })).toMatchObject({ status: "missing", source: "missing", url: null });
  });

  it("exposes all four approved slots and never turns an unsafe stored URL into a link", () => {
    const slots = resolveTeamFunnelProductSlots({
      templateSlots: [{ id: "slot-main", slotKey: "main_product", productId: "product-1", product: { id: "product-1", checkoutUrl: "javascript:alert(1)" } }],
      partnerOverrides: [], attribution: attribution(),
    });
    expect(slots.map((slot) => slot.slotKey)).toEqual(["main_product", "bundle_product", "join_member", "consultation"]);
    expect(slots).toEqual(expect.arrayContaining([expect.objectContaining({ slotKey: "main_product", status: "missing" })]));
  });

  it("accepts only credential-free http(s) URLs", () => {
    expect(parseSafeTeamFunnelProductUrl("https://shop.example.test/p/1")).toBe("https://shop.example.test/p/1");
    for (const value of ["javascript:alert(1)", "data:text/html,hello", "https://user:pass@example.test/p", "//example.test/p", "not a url"]) {
      expect(parseSafeTeamFunnelProductUrl(value)).toBeNull();
    }
    expect(() => assertSafeTeamFunnelProductUrl("javascript:alert(1)")).toThrow(TeamFunnelInvalidProductUrlError);
  });

  it("keeps A as the course webinar owner while B owns registration and leads", () => {
    const course = resolveTeamFunnelPartnerProfile({
      pageId: "page-b", vendorId: owner.vendorId, teamId: owner.teamId,
      contentOwnerMembershipId: owner.id, promoterMembershipId: partner.id,
      live: { seminarOwnerMembershipId: owner.id },
    });
    expect(course).toMatchObject({
      mode: "course", webinarOwnerMembershipId: owner.id,
      registrationPromoterMembershipId: partner.id, leadOwnerMembershipId: partner.id,
      clickAttribution: { promoterMembershipId: partner.id, seminarOwnerMembershipId: owner.id },
    });
  });

  it("gives product clicks and conversions B's resolved attribution", () => {
    const product = resolveTeamFunnelPartnerProfile({
      pageId: "page-b", vendorId: owner.vendorId, teamId: owner.teamId,
      contentOwnerMembershipId: owner.id, promoterMembershipId: partner.id,
    });
    expect(product).toMatchObject({
      mode: "product", webinarOwnerMembershipId: null,
      clickAttribution: { promoterMembershipId: partner.id, seminarOwnerMembershipId: null },
      conversionAttribution: { promoterMembershipId: partner.id, seminarOwnerMembershipId: null },
    });
  });
});

describe("team-funnel product slot persistence", () => {
  it("stores a template slot as a product reference, never as a partner checkout URL", async () => {
    requireAuth.mockResolvedValueOnce({ user: { id: owner.userId }, member: { id: owner.vendorMemberId, status: "active", deactivatedAt: null } });
    db.teamMembership.findFirst.mockResolvedValueOnce(membershipRecord(owner));
    db.teamFunnelTemplateVersion.findFirst.mockResolvedValue({
      id: "version-a", vendorId: owner.vendorId, teamId: owner.teamId, contentOwnerMembershipId: owner.id,
      fieldLocks: [],
    });
    db.product.findFirst.mockResolvedValue({ id: "product-default" });
    db.teamFunnelTemplateProductSlot.findFirst.mockResolvedValue(null);
    db.teamFunnelTemplateProductSlot.create.mockResolvedValue({ id: "slot-main" });

    await createTeamFunnelTemplateProductSlot({
      teamId: owner.teamId, templateVersionId: "version-a", slotKey: "main_product", productId: "product-default",
    });

    expect(db.teamFunnelTemplateProductSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: owner.vendorId,
        templateVersionId: "version-a",
        productId: "product-default",
        slotKey: "main_product",
      }),
    });
    expect(db.teamFunnelTemplateProductSlot.create.mock.calls[0][0].data).not.toHaveProperty("overrideUrl");
    expect(db.teamFunnelTemplateProductSlot.create.mock.calls[0][0].data).not.toHaveProperty("checkoutUrl");
  });

  it("stores B's override only in B's page scope and rejects cross-tenant pages", async () => {
    await upsertTeamFunnelPartnerProductSlotOverride({
      teamId: owner.teamId, pageId: "page-b", slotKey: "main_product", overrideUrl: "https://b.example.test/offer",
    });
    expect(db.partnerProductSlotOverride.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { pageId_productSlotId: { pageId: "page-b", productSlotId: "slot-main" } },
      create: expect.objectContaining({ vendorId: owner.vendorId, pageId: "page-b", overrideUrl: "https://b.example.test/offer" }),
    }));

    db.partnerFunnelPage.findFirst.mockResolvedValueOnce(null);
    await expect(upsertTeamFunnelPartnerProductSlotOverride({
      teamId: owner.teamId, pageId: "foreign-page", slotKey: "main_product", overrideUrl: "https://b.example.test/offer",
    })).rejects.toBeInstanceOf(TeamFunnelAccessDeniedError);
    expect(db.partnerFunnelPage.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "foreign-page", vendorId: owner.vendorId, teamId: owner.teamId },
    }));
  });

  it("honors PRODUCT_SLOTS locks before B's override is persisted", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValueOnce(persistedPage({ templateVersion: {
      fieldLocks: [{ field: "PRODUCT_SLOTS" }], productSlots: persistedPage().templateVersion.productSlots,
    } }));
    await expect(upsertTeamFunnelPartnerProductSlotOverride({
      teamId: owner.teamId, pageId: "page-b", slotKey: "main_product", overrideUrl: "https://b.example.test/offer",
    })).rejects.toMatchObject({ reason: "locked_field" });
    expect(db.partnerProductSlotOverride.upsert).not.toHaveBeenCalled();
  });
});

describe("team-funnel product slot routes", () => {
  it("rejects unsafe URL input before accessing the persistent service", async () => {
    const response = await productSlotsPost(request("/api/team-funnel/product-slots", {
      action: "set-override", teamId: owner.teamId, pageId: "page-b", slotKey: "main_product", overrideUrl: "javascript:alert(1)",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_INVALID_PRODUCT_URL" } });
  });

  it("returns the profile ownership mapping through the profile route", async () => {
    const response = await partnerProfilePost(request("/api/team-funnel/partner-profile", {
      action: "get", teamId: owner.teamId, pageId: "page-b",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { mode: "product", registrationPromoterMembershipId: partner.id, leadOwnerMembershipId: partner.id },
    });
  });

  it("resolves a persisted B override before the template default", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValueOnce(persistedPage({
      productOverrides: [{
        productSlotId: "slot-main", productId: "product-b", overrideUrl: "https://b.example.test/offer",
        product: { id: "product-b", checkoutUrl: "https://b.example.test/product" },
      }],
    }));

    const response = await productSlotsPost(request("/api/team-funnel/product-slots", {
      action: "resolve", teamId: owner.teamId, pageId: "page-b",
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ data: { profile: { clickAttribution: { promoterMembershipId: partner.id } } } });
    expect(body.data.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotKey: "main_product", source: "partner_override", url: "https://b.example.test/offer" }),
    ]));
  });
});
