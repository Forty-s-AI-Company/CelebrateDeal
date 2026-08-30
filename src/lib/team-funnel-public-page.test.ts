import { describe, expect, it } from "vitest";
import {
  buildPartnerPlaybackHref,
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
      status: "scheduled",
      replayEnabled: true,
      seminarOwnerMembershipId: "member-a",
      form: {
        id: "form-a",
        slug: "register-a",
        isActive: true,
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
        submitLabel: "送出報名",
        successMessage: "已收到資料",
      },
    },
    templateVersion: {
      contentOwnerMembershipId: "member-a",
      productSlots: [{
        id: "slot-main", slotKey: "main_product", productId: "product-a", offerLabel: "主打方案",
        product: { id: "product-a", vendorId: "vendor-1", checkoutUrl: "https://shop.example.test/a", isActive: true, fulfillmentTypeConfirmed: true },
      }],
    },
    productOverrides: [{
      productSlotId: "slot-main", productId: "product-b", overrideUrl: "https://shop.example.test/b",
      product: { id: "product-b", vendorId: "vendor-1", checkoutUrl: "https://shop.example.test/b-product", isActive: true, fulfillmentTypeConfirmed: true },
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
          registrationHref: "#registration-heading",
        },
        cta: { href: "#registration-heading" },
      },
    });
    const playbackUrl = new URL(result.page?.webinar.playbackHref ?? "", "https://app.example.test");
    expect(playbackUrl.pathname).toBe("/live/webinar-a");
    expect(playbackUrl.searchParams.get("sourcePage")).toBe("partner-b");
    expect(playbackUrl.searchParams.get("ref")).toBe("B-CODE");
    expect(result.page?.productSlots).toContainEqual({ slotKey: "main_product", offerLabel: "主打方案", url: "https://shop.example.test/b", checkoutMode: "external" });
    expect(result.page?.body).toEqual([
      { type: "paragraph", text: "<script>alert('x')</script>" },
      { type: "list", items: ["第一項", "第二項"] },
    ]);
  });

  it("publishes a ready platform product as an internal checkout destination", () => {
    const result = prepareTeamFunnelPublicPage(page({
      productOverrides: [],
      templateVersion: {
        contentOwnerMembershipId: "member-a",
        productSlots: [{
          id: "slot-main",
          slotKey: "main_product",
          productId: "product-a",
          offerLabel: "主打方案",
          product: {
            id: "product-a",
            vendorId: "vendor-1",
            checkoutUrl: null,
            isActive: true,
            fulfillmentTypeConfirmed: true,
            inventory: 2,
            priceCents: 8_800,
          },
        }],
      },
    }));

    expect(result.state).toBe("ready");
    expect(result.page?.productSlots).toContainEqual({
      slotKey: "main_product",
      offerLabel: "主打方案",
      url: "/checkout/vendor-1/product-a",
      checkoutMode: "platform",
    });
  });

  it("encodes the shared playback slug while preserving source lineage", () => {
    const playbackUrl = new URL(buildPartnerPlaybackHref("webinar/a", "partner-b", null), "https://app.example.test");

    expect(playbackUrl.pathname).toBe("/live/webinar%2Fa");
    expect(playbackUrl.searchParams.get("sourcePage")).toBe("partner-b");
    expect(playbackUrl.searchParams.has("ref")).toBe(false);
  });

  it("keeps the partner page visible but disables submission for an invalid legacy form schema", () => {
    const result = prepareTeamFunnelPublicPage(page({
      live: {
        ...page().live!,
        form: {
          ...page().live!.form!,
          fields: [{ key: "email", label: "Email", type: "email", required: true }],
        },
      },
    }));

    expect(result.state).toBe("ready");
    expect(result.page?.webinar.registration).toBeNull();
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

    expect(result.page?.cta.href).toBe("#registration-heading");
  });

  it.each([
    ["draft", true],
    ["ended", false],
    ["archived", true],
  ])("does not expose a %s webinar with replay=%s", (status, replayEnabled) => {
    expect(prepareTeamFunnelPublicPage(page({
      live: { ...page().live!, status, replayEnabled },
    }))).toEqual({ state: "missing_webinar" });
  });

  it("does not expose checkout links from inactive products", () => {
    const inactive = page({
      productOverrides: [],
      templateVersion: {
        contentOwnerMembershipId: "member-a",
        productSlots: [{
          id: "slot-main",
          slotKey: "main_product",
          productId: "product-a",
          offerLabel: "主打方案",
          product: { id: "product-a", checkoutUrl: "https://shop.example.test/a", isActive: false },
        }],
      },
    });

    expect(prepareTeamFunnelPublicPage(inactive)).toEqual({ state: "missing_slot" });
  });
});
