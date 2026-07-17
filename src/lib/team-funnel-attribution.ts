import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";

export const ATTRIBUTION_COOKIE = "celebratedeal_attribution";
export const VISITOR_COOKIE = "celebratedeal_visitor";
export const ATTRIBUTION_TTL_SECONDS = 60 * 60 * 24 * 30;

type AttributionCookie = {
  clickId: string;
  visitorId: string;
  issuedAt: number;
};

export type TeamFunnelAttribution = {
  vendorId: string;
  teamId: string;
  sourcePageId: string;
  templateVersionId: string;
  promoterMembershipId: string;
  leadOwnerMembershipId: string;
  leaderMembershipId: string;
  contentOwnerMembershipId: string;
  webinarOwnerMembershipId: string | null;
  referralCode: string | null;
  source: "REFERRAL" | "EXISTING_OWNER";
};

export type ReferralResolution = {
  code: string;
  affiliateId: string;
  visitorId: string | null;
  source: "query" | "cookie" | "legacy";
};

export function normalizeReferralCode(value: string | null | undefined) {
  const code = value?.trim().toUpperCase() ?? "";
  return code && code.length <= 80 ? code : null;
}

export function referralCodeFromRequest(request: Request) {
  for (const value of [request.url, request.headers.get("referer")]) {
    if (!value) continue;
    try {
      const code = normalizeReferralCode(new URL(value).searchParams.get("ref"));
      if (code) return code;
    } catch {
      // A malformed Referer must not affect attribution.
    }
  }
  return null;
}

/** The page is derived from the browser's same-origin Referer, never request JSON/form fields. */
export function sourcePageSlugFromRequest(request: Request) {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const sourceUrl = new URL(referer);
    if (sourceUrl.origin !== new URL(request.url).origin) return null;
    const path = sourceUrl.pathname.split("/").filter(Boolean).at(-1);
    return path && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(path) ? path.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function visitorIdFromRequest(request: Request) {
  const existing = readCookie(request.headers.get("cookie"), VISITOR_COOKIE);
  return existing && /^[a-z0-9-]{20,100}$/i.test(existing) ? existing : randomUUID();
}

export function attributionCookieFromRequest(request: Request, now = Date.now()): AttributionCookie | null {
  const raw = readCookie(request.headers.get("cookie"), ATTRIBUTION_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<AttributionCookie>;
    if (
      typeof parsed.clickId !== "string" ||
      typeof parsed.visitorId !== "string" ||
      typeof parsed.issuedAt !== "number" ||
      parsed.issuedAt > now ||
      now - parsed.issuedAt > ATTRIBUTION_TTL_SECONDS * 1000
    ) return null;
    return { clickId: parsed.clickId, visitorId: parsed.visitorId, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}

export function encodeAttributionCookie(value: AttributionCookie) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function attributionCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: ATTRIBUTION_TTL_SECONDS,
  };
}

/**
 * Resolves referral evidence in a deliberate order. An explicitly supplied,
 * unknown query code is terminal: it cannot silently revive an older cookie.
 */
export async function resolveReferral(input: {
  vendorId: string;
  queryCode?: string | null;
  legacyCode?: string | null;
  cookie: AttributionCookie | null;
  now?: Date;
}): Promise<ReferralResolution | null> {
  const queryCode = normalizeReferralCode(input.queryCode);
  if (queryCode) return findActiveAffiliate(input.vendorId, queryCode, "query", null);

  if (input.cookie) {
    const minCreatedAt = new Date((input.now ?? new Date()).getTime() - ATTRIBUTION_TTL_SECONDS * 1000);
    const click = await getDb().affiliateClick.findFirst({
      where: {
        id: input.cookie.clickId,
        vendorId: input.vendorId,
        visitorId: input.cookie.visitorId,
        createdAt: { gte: minCreatedAt },
      },
      select: { referralCode: true, affiliateId: true },
    });
    if (click?.referralCode && click.affiliateId) {
      return { code: click.referralCode, affiliateId: click.affiliateId, visitorId: input.cookie.visitorId, source: "cookie" };
    }
  }

  const legacyCode = normalizeReferralCode(input.legacyCode);
  return legacyCode ? findActiveAffiliate(input.vendorId, legacyCode, "legacy", null) : null;
}

/**
 * All ownership is loaded from the resolved page, team hierarchy, and webinar.
 * Client input may choose a public page slug and a referral clue, never an owner.
 */
export async function resolveTeamFunnelAttribution(input: {
  vendorId: string;
  liveId: string | null;
  sourcePageSlug: string | null;
  referral: ReferralResolution | null;
}): Promise<TeamFunnelAttribution | null> {
  if (!input.liveId || !input.sourcePageSlug) return null;

  const db = getDb();
  const page = await db.partnerFunnelPage.findFirst({
    where: { vendorId: input.vendorId, liveId: input.liveId, slug: input.sourcePageSlug },
    select: {
      id: true,
      teamId: true,
      templateVersionId: true,
      promoterMembershipId: true,
      contentOwnerMembershipId: true,
    },
  });
  if (!page) return null;

  const [live, memberships, relationships] = await Promise.all([
    db.live.findFirst({
      where: { id: input.liveId, vendorId: input.vendorId, teamId: page.teamId },
      select: { seminarOwnerMembershipId: true },
    }),
    db.teamMembership.findMany({
      where: { vendorId: input.vendorId, teamId: page.teamId, status: "ACTIVE", leftAt: null },
      select: { id: true, affiliateId: true },
    }),
    db.teamMembershipRelationship.findMany({
      where: { teamId: page.teamId, endedAt: null },
      select: { uplineMembershipId: true, downlineMembershipId: true },
    }),
  ]);
  if (!live) return null;

  const activeMembershipIds = new Set(memberships.map((membership) => membership.id));
  if (!activeMembershipIds.has(page.promoterMembershipId) || !activeMembershipIds.has(page.contentOwnerMembershipId)) return null;

  const referralPromoter = input.referral
    ? memberships.find((membership) => membership.affiliateId === input.referral?.affiliateId)?.id ?? null
    : null;
  const promoterMembershipId = referralPromoter ?? page.promoterMembershipId;
  const leaderMembershipId = resolveLeader(promoterMembershipId, relationships);
  const webinarOwnerMembershipId = live.seminarOwnerMembershipId && activeMembershipIds.has(live.seminarOwnerMembershipId)
    ? live.seminarOwnerMembershipId
    : null;

  return {
    vendorId: input.vendorId,
    teamId: page.teamId,
    sourcePageId: page.id,
    templateVersionId: page.templateVersionId,
    promoterMembershipId,
    leadOwnerMembershipId: promoterMembershipId,
    leaderMembershipId,
    contentOwnerMembershipId: page.contentOwnerMembershipId,
    webinarOwnerMembershipId,
    referralCode: referralPromoter ? input.referral?.code ?? null : null,
    source: referralPromoter ? "REFERRAL" : "EXISTING_OWNER",
  };
}

export async function recordClickAttribution(affiliateClickId: string, attribution: TeamFunnelAttribution | null) {
  if (!attribution) return;
  await getDb().teamClickAttribution.upsert({
    where: { vendorId_affiliateClickId: { vendorId: attributionVendorId(attribution), affiliateClickId } },
    create: clickAttributionData(affiliateClickId, attribution),
    update: {},
  });
}

export async function recordLeadAttribution(formSubmissionId: string, attribution: TeamFunnelAttribution | null) {
  if (!attribution) return;
  await getDb().teamLeadAttribution.upsert({
    where: { formSubmissionId },
    create: leadAttributionData(formSubmissionId, attribution),
    update: {},
  });
}

function attributionVendorId(attribution: TeamFunnelAttribution) {
  return attribution.vendorId;
}

function clickAttributionData(affiliateClickId: string, attribution: TeamFunnelAttribution) {
  return {
    vendorId: attributionVendorId(attribution),
    teamId: attribution.teamId,
    affiliateClickId,
    pageId: attribution.sourcePageId,
    leaderMembershipId: attribution.leaderMembershipId,
    promoterMembershipId: attribution.promoterMembershipId,
    contentOwnerMembershipId: attribution.contentOwnerMembershipId,
    seminarOwnerMembershipId: attribution.webinarOwnerMembershipId,
    source: attribution.source,
    referralCode: attribution.referralCode,
  };
}

function leadAttributionData(formSubmissionId: string, attribution: TeamFunnelAttribution) {
  return {
    vendorId: attributionVendorId(attribution),
    teamId: attribution.teamId,
    formSubmissionId,
    pageId: attribution.sourcePageId,
    leaderMembershipId: attribution.leaderMembershipId,
    promoterMembershipId: attribution.promoterMembershipId,
    contentOwnerMembershipId: attribution.contentOwnerMembershipId,
    seminarOwnerMembershipId: attribution.webinarOwnerMembershipId,
    source: attribution.source,
    referralCode: attribution.referralCode,
  };
}

async function findActiveAffiliate(vendorId: string, code: string, source: ReferralResolution["source"], visitorId: string | null) {
  const affiliate = await getDb().affiliate.findFirst({
    where: { vendorId, code, isActive: true },
    select: { id: true },
  });
  return affiliate ? { code, affiliateId: affiliate.id, source, visitorId } : null;
}

function resolveLeader(promoterId: string, relationships: readonly { uplineMembershipId: string; downlineMembershipId: string }[]) {
  const uplines = new Map(relationships.map((relationship) => [relationship.downlineMembershipId, relationship.uplineMembershipId]));
  const seen = new Set<string>();
  let leader = promoterId;
  while (uplines.has(leader) && !seen.has(leader)) {
    seen.add(leader);
    leader = uplines.get(leader)!;
  }
  return leader;
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  const part = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}
