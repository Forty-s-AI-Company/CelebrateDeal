import { getDb } from "@/lib/db";
import { renderTeamFunnelPageText } from "@/lib/team-funnel-pages";
import {
  parseSafeTeamFunnelProductUrl,
  resolveTeamFunnelPartnerProfile,
  resolveTeamFunnelProductSlots,
  type ResolvedTeamFunnelProductSlot,
} from "@/lib/team-funnel-product-slots";

export type TeamFunnelContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export type TeamFunnelPublicPageState =
  | "ready"
  | "not_found"
  | "unpublished"
  | "disabled"
  | "inactive_partner"
  | "missing_webinar"
  | "missing_slot";

export type TeamFunnelPublicPageView = {
  state: TeamFunnelPublicPageState;
  page?: {
    slug: string;
    headline: string;
    subheadline: string | null;
    body: TeamFunnelContentBlock[];
    cta: { label: string; href: string };
    partner: { name: string; email: string | null; referralCode: string | null };
    webinar: { title: string; startsAt: string; playbackHref: string; registrationHref: string };
    productSlots: Array<Pick<ResolvedTeamFunnelProductSlot, "slotKey" | "offerLabel" | "url">>;
  };
};

type PublicMembership = {
  id: string;
  status: string;
  leftAt: Date | null;
  vendorMember: { status: string; deactivatedAt: Date | null; user: { name: string; email: string } };
  affiliate: { code: string; isActive: boolean } | null;
};

export type PublicTeamFunnelPageRecord = {
  id: string;
  vendorId: string;
  teamId: string;
  slug: string;
  templateVersionId: string;
  promoterMembershipId: string;
  contentOwnerMembershipId: string;
  headline: string;
  subheadline: string | null;
  body: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
  sharing: { accessMode: "PUBLIC" | "TOKEN_REQUIRED" | "DISABLED"; isEnabled: boolean; expiresAt: Date | null } | null;
  promoter: PublicMembership;
  contentOwner: PublicMembership;
  live: {
    id: string;
    teamId: string | null;
    slug: string;
    title: string;
    scheduledAt: Date;
    seminarOwnerMembershipId: string | null;
    form: { slug: string; isActive: boolean } | null;
  } | null;
  templateVersion: {
    contentOwnerMembershipId: string;
    productSlots: Array<{ id: string; slotKey: string; productId: string; offerLabel: string | null; product: { id: string; checkoutUrl: string | null } | null }>;
  };
  productOverrides: Array<{ productSlotId: string; productId: string | null; overrideUrl: string | null; product: { id: string; checkoutUrl: string | null } | null }>;
};

/**
 * Server-only lookup for a stable `/p/[slug]` page. It deliberately loads only
 * the copied page and its server-owned relations; no public request may supply
 * a tenant, team, owner, webinar, or product identifier.
 */
export async function getPublicTeamFunnelPage(slug: string): Promise<TeamFunnelPublicPageView> {
  const page = await getDb().partnerFunnelPage.findUnique({
    where: { slug },
    include: {
      sharing: { select: { accessMode: true, isEnabled: true, expiresAt: true } },
      promoter: {
        include: {
          vendorMember: { include: { user: { select: { name: true, email: true } } } },
          affiliate: { select: { code: true, isActive: true } },
        },
      },
      contentOwner: {
        include: {
          vendorMember: { include: { user: { select: { name: true, email: true } } } },
          affiliate: { select: { code: true, isActive: true } },
        },
      },
      live: { select: { id: true, teamId: true, slug: true, title: true, scheduledAt: true, seminarOwnerMembershipId: true, form: { select: { slug: true, isActive: true } } } },
      templateVersion: {
        select: { contentOwnerMembershipId: true, productSlots: { include: { product: { select: { id: true, checkoutUrl: true } } } } },
      },
      productOverrides: { include: { product: { select: { id: true, checkoutUrl: true } } } },
    },
  });

  return prepareTeamFunnelPublicPage(page as PublicTeamFunnelPageRecord | null);
}

/**
 * Converts a persisted page into a minimal render model. Every branch fails
 * closed, and all stored copy remains text rather than executable markup.
 */
export function prepareTeamFunnelPublicPage(page: PublicTeamFunnelPageRecord | null, now = new Date()): TeamFunnelPublicPageView {
  if (!page) return { state: "not_found" };
  if (page.sharing?.accessMode === "DISABLED" || page.sharing?.isEnabled === false || (page.sharing?.expiresAt && page.sharing.expiresAt <= now)) {
    return { state: "disabled" };
  }
  if (!page.sharing || page.sharing.accessMode !== "PUBLIC") return { state: "unpublished" };
  if (!isActiveMembership(page.promoter)) return { state: "inactive_partner" };
  if (!isActiveMembership(page.contentOwner)) return { state: "disabled" };
  if (
    page.templateVersion.contentOwnerMembershipId !== page.contentOwnerMembershipId
    || !page.live
    || page.live.teamId !== page.teamId
    || !page.live.form?.isActive
    || page.live.seminarOwnerMembershipId !== page.contentOwnerMembershipId
  ) {
    return { state: "missing_webinar" };
  }

  const referralCode = page.promoter.affiliate?.isActive ? page.promoter.affiliate.code : null;
  const registrationHref = withReferral(`/form/${page.live.form.slug}`, referralCode);
  const profile = resolveTeamFunnelPartnerProfile({
    pageId: page.id,
    vendorId: page.vendorId,
    teamId: page.teamId,
    contentOwnerMembershipId: page.contentOwnerMembershipId,
    promoterMembershipId: page.promoterMembershipId,
    live: { seminarOwnerMembershipId: page.live.seminarOwnerMembershipId },
  });
  const slots = resolveTeamFunnelProductSlots({
    templateSlots: page.templateVersion.productSlots,
    partnerOverrides: page.productOverrides,
    attribution: profile.clickAttribution,
  });
  const mainSlot = slots.find((slot) => slot.slotKey === "main_product");
  if (!mainSlot?.url) return { state: "missing_slot" };

  const rendered = renderTeamFunnelPageText(
    {
      headline: page.headline,
      subheadline: page.subheadline,
      body: page.body,
      ctaLabel: page.ctaLabel,
      ctaUrl: page.ctaUrl,
    },
    {
      partner: {
        name: page.promoter.vendorMember.user.name,
        displayName: page.promoter.vendorMember.user.name,
        email: page.promoter.vendorMember.user.email,
        productUrl: mainSlot.url,
        joinUrl: registrationHref,
        referralCode,
      },
      webinar: {
        title: page.live.title,
        startAt: page.live.scheduledAt.toISOString(),
        hostName: page.contentOwner.vendorMember.user.name,
        registrationUrl: registrationHref,
      },
    },
  );

  return {
    state: "ready",
    page: {
      slug: page.slug,
      headline: rendered.headline.text,
      subheadline: rendered.subheadline?.text ?? null,
      body: toStructuredContentBlocks(rendered.body?.text ?? ""),
      cta: {
        label: rendered.ctaLabel.text,
        href: parseSafePublicHref(rendered.ctaUrl?.text) ?? registrationHref,
      },
      partner: {
        name: page.promoter.vendorMember.user.name,
        email: page.promoter.vendorMember.user.email || null,
        referralCode,
      },
      webinar: {
        title: page.live.title,
        startsAt: page.live.scheduledAt.toISOString(),
        playbackHref: `/live/${page.live.slug}`,
        registrationHref,
      },
      productSlots: slots.filter((slot) => slot.url).map((slot) => ({
        slotKey: slot.slotKey,
        offerLabel: slot.offerLabel,
        url: slot.url,
      })),
    },
  };
}

/** Only paragraphs and simple unordered lists are supported as rich content. */
export function toStructuredContentBlocks(value: string): TeamFunnelContentBlock[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: TeamFunnelContentBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const line of lines) {
    const item = /^\s*[-*]\s+(.+)$/u.exec(line);
    if (item) {
      flushParagraph();
      list.push(item[1]);
    } else if (line.trim()) {
      flushList();
      paragraph.push(line.trim());
    } else {
      flushParagraph();
      flushList();
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

function isActiveMembership(member: PublicMembership) {
  return member.status === "ACTIVE" && member.leftAt === null && member.vendorMember.status === "active" && member.vendorMember.deactivatedAt === null;
}

function withReferral(path: string, referralCode: string | null) {
  return referralCode ? `${path}?ref=${encodeURIComponent(referralCode)}` : path;
}

function parseSafePublicHref(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith("/")) {
    try {
      const origin = "https://public-page.invalid";
      const url = new URL(value, origin);
      if (url.origin === origin) return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }
  return parseSafeTeamFunnelProductUrl(value);
}
