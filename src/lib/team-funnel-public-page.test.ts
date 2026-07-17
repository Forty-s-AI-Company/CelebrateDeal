import { describe, expect, it } from "vitest";
import {
  prepareTeamFunnelPublicPage,
  toStructuredContentBlocks,
  type PublicTeamFunnelPageRecord,
} from "./team-funnel-public-page";

function page(overrides: Partial<PublicTeamFunnelPageRecord> = {}): PublicTeamFunnelPageRecord {
  return {
    id: "page-b",
    vendorId: "vendor-1",
    teamId: "team-1",
    slug: "partner-b",
    templateVersionId: "version-a",
    promoterMembershipId: "member-b",
    contentOwnerMembershipId: "member-a",
    headline: "{{partner.name}} 邀請您參加 {{webinar.title}}",
    subheadline: null,
    body: "<script>alert('x')</script>\n\n- 第一項\n- 第二項",
    ctaLabel: "立即加入",
    ctaUrl: "javascript:alert(1)",
    sharing: { accessMode: "PUBLIC", isEnabled: true, expiresAt: null },
    promoter: member("B 夥伴", "b@example.test", "member-b", { code: "B-CODE", isActive: true }),
    contentOwner: member("A 講師", "a@example.test", "member-a"),
    live: {
      id: "live-a",
      teamId: "team-1",
      slug: "webinar-a",
      title: "A 的講座",
      scheduledAt: new Date("2026-07-17T10:00:00.000Z"),
      seminarOwnerMembershipId: "member-a",
      form: { slug: "register-a", isActive: true },
    },
    templateVersion: {
      contentOwnerMembershipId: "member-a",
      productSlots: [{
        id: "slot-main", slotKey: "main_product", productId: "product-a", offerLabel: "主打方案",
        product: { id: "product-a", checkoutUrl: "https://shop.example.test/a" },
      }],
    },
    productOverrides: [{
      productSlotId: "slot-main", productId: "product-b", overrideUrl: "https://shop.example.test/b",
      product: { id: "product-b", checkoutUrl: "https://shop.example.test/b-product" },
    }],
    ...overrides,
  };
}

function member(name: string, email: string, id: string, affiliate: { code: string; isActive: boolean } | null = null) {
  return {
    id,
    status: "ACTIVE",
    leftAt: null,
    vendorMember: { status: "active", deactivatedAt: null, user: { name, email } },
    affiliate,
  };
}

describe("public team funnel page resolver", () => {
  it("renders B's contact, referral, and override while preserving A's webinar binding", () => {
    const result = prepareTeamFunnelPublicPage(page());

    expect(result).toMatchObject({
      state: "ready",
      page: {
        headline: "B 夥伴 邀請您參加 A 的講座",
        partner: { name: "B 夥伴", email: "b@example.test", referralCode: "B-CODE" },
        webinar: {
          title: "A 的講座",
          registrationHref: "/form/register-a?ref=B-CODE",
          playbackHref: "/live/webinar-a",
        },
        cta: { href: "/form/register-a?ref=B-CODE" },
      },
    });
    expect(result.page?.productSlots).toContainEqual({ slotKey: "main_product", offerLabel: "主打方案", url: "https://shop.example.test/b" });
    expect(result.page?.body).toEqual([
      { type: "paragraph", text: "<script>alert('x')</script>" },
      { type: "list", items: ["第一項", "第二項"] },
    ]);
  });

  it.each([
    [null, "not_found"],
    [page({ sharing: null }), "unpublished"],
    [page({ sharing: { accessMode: "DISABLED", isEnabled: false, expiresAt: null } }), "disabled"],
    [page({ promoter: { ...member("B", "b@example.test", "member-b"), status: "INACTIVE" } }), "inactive_partner"],
    [page({ live: null }), "missing_webinar"],
    [page({ productOverrides: [], templateVersion: { contentOwnerMembershipId: "member-a", productSlots: [] } }), "missing_slot"],
  ] as const)("returns a safe %s state", (input, expected) => {
    expect(prepareTeamFunnelPublicPage(input)).toEqual({ state: expected });
  });

  it("uses only paragraph and list blocks, keeping hostile markup as text", () => {
    expect(toStructuredContentBlocks("hello\nworld\n\n* one\n* <img src=x onerror=alert(1)>")).toEqual([
      { type: "paragraph", text: "hello world" },
      { type: "list", items: ["one", "<img src=x onerror=alert(1)>"] },
    ]);
  });

  it("rejects browser-ambiguous relative CTA URLs", () => {
    const result = prepareTeamFunnelPublicPage(page({ ctaUrl: "/\\\\attacker.example.test/collect" }));

    expect(result.page?.cta.href).toBe("/form/register-a?ref=B-CODE");
  });
});
