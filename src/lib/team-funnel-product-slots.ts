import { getDb } from "@/lib/db";
import {
  TeamFunnelAccessDeniedError,
  assertTeamFunnelAccess,
  requireTeamFunnelActor,
  type TeamFunnelAction,
  type TeamFunnelMembership,
  type TeamFunnelResource,
} from "@/lib/team-funnel-access";

/** The only product placements that a team-funnel template may expose. */
export const teamFunnelProductSlotKeys = ["main_product", "bundle_product", "join_member", "consultation"] as const;
export type TeamFunnelProductSlotKey = (typeof teamFunnelProductSlotKeys)[number];

type ProductLink = {
  id: string;
  checkoutUrl?: string | null;
};

export type TeamFunnelTemplateSlot = {
  id: string;
  slotKey: string;
  productId: string;
  displayOrder?: number;
  offerLabel?: string | null;
  product?: ProductLink | null;
};

export type TeamFunnelPartnerSlotOverride = {
  productSlotId: string;
  productId?: string | null;
  overrideUrl?: string | null;
  product?: ProductLink | null;
};

export type TeamFunnelAttribution = {
  pageId: string;
  vendorId: string;
  teamId: string;
  leaderMembershipId: string;
  promoterMembershipId: string;
  contentOwnerMembershipId: string;
  seminarOwnerMembershipId: string | null;
};

export type TeamFunnelPartnerProfile = {
  pageId: string;
  vendorId: string;
  teamId: string;
  mode: "course" | "product";
  webinarOwnerMembershipId: string | null;
  registrationPromoterMembershipId: string;
  leadOwnerMembershipId: string;
  clickAttribution: TeamFunnelAttribution;
  conversionAttribution: TeamFunnelAttribution;
};

export type ResolvedTeamFunnelProductSlot = {
  slotKey: TeamFunnelProductSlotKey;
  status: "resolved" | "missing";
  source: "partner_override" | "template_default" | "missing";
  productId: string | null;
  url: string | null;
  offerLabel: string | null;
  attribution: TeamFunnelAttribution;
};

export class TeamFunnelInvalidProductUrlError extends Error {
  readonly code = "TEAM_FUNNEL_INVALID_PRODUCT_URL";

  constructor() {
    super("Product URLs must be valid http or https URLs without credentials");
    this.name = "TeamFunnelInvalidProductUrlError";
  }
}

export class TeamFunnelInvalidProductSlotError extends Error {
  readonly code = "TEAM_FUNNEL_INVALID_PRODUCT_SLOT";

  constructor() {
    super("The product slot is not approved for team funnels");
    this.name = "TeamFunnelInvalidProductSlotError";
  }
}

export class TeamFunnelPartnerProfileError extends Error {
  readonly code = "TEAM_FUNNEL_INVALID_PARTNER_PROFILE";

  constructor() {
    super("The course page does not retain its template owner's webinar");
    this.name = "TeamFunnelPartnerProfileError";
  }
}

export class TeamFunnelProductSlotConflictError extends Error {
  readonly code = "TEAM_FUNNEL_PRODUCT_SLOT_CONFLICT";

  constructor() {
    super("The template version already has this product slot");
    this.name = "TeamFunnelProductSlotConflictError";
  }
}

/**
 * Canonicalizes a safe external URL. This is intentionally stricter than a
 * generic URL validator: product links must never carry credentials or a
 * non-web scheme.
 */
export function parseSafeTeamFunnelProductUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null;

  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function isApprovedTeamFunnelProductSlot(slotKey: string): slotKey is TeamFunnelProductSlotKey {
  return (teamFunnelProductSlotKeys as readonly string[]).includes(slotKey);
}

export function assertApprovedTeamFunnelProductSlot(slotKey: string): asserts slotKey is TeamFunnelProductSlotKey {
  if (!isApprovedTeamFunnelProductSlot(slotKey)) throw new TeamFunnelInvalidProductSlotError();
}

export function assertSafeTeamFunnelProductUrl(value: string): string {
  const parsed = parseSafeTeamFunnelProductUrl(value);
  if (!parsed) throw new TeamFunnelInvalidProductUrlError();
  return parsed;
}

/**
 * Pure ownership mapping used by both public-page rendering and persistence.
 * A course keeps A as webinar owner, while B remains the registration and lead
 * owner. Product pages attribute clicks and conversions to B.
 */
export function resolveTeamFunnelPartnerProfile(input: {
  pageId: string;
  vendorId: string;
  teamId: string;
  contentOwnerMembershipId: string;
  promoterMembershipId: string;
  live?: { seminarOwnerMembershipId: string | null } | null;
}): TeamFunnelPartnerProfile {
  const isCourse = Boolean(input.live);
  const webinarOwnerMembershipId = input.live?.seminarOwnerMembershipId ?? null;

  if (isCourse && webinarOwnerMembershipId !== input.contentOwnerMembershipId) {
    throw new TeamFunnelPartnerProfileError();
  }

  const baseAttribution: TeamFunnelAttribution = {
    pageId: input.pageId,
    vendorId: input.vendorId,
    teamId: input.teamId,
    leaderMembershipId: input.contentOwnerMembershipId,
    promoterMembershipId: input.promoterMembershipId,
    contentOwnerMembershipId: input.contentOwnerMembershipId,
    seminarOwnerMembershipId: isCourse ? webinarOwnerMembershipId : null,
  };

  return {
    pageId: input.pageId,
    vendorId: input.vendorId,
    teamId: input.teamId,
    mode: isCourse ? "course" : "product",
    webinarOwnerMembershipId,
    registrationPromoterMembershipId: input.promoterMembershipId,
    leadOwnerMembershipId: input.promoterMembershipId,
    clickAttribution: baseAttribution,
    conversionAttribution: baseAttribution,
  };
}

/** Resolves one semantic template slot without accepting or retaining A's URL. */
export function resolveTeamFunnelProductSlot(input: {
  slotKey: TeamFunnelProductSlotKey;
  templateSlot?: TeamFunnelTemplateSlot | null;
  partnerOverride?: TeamFunnelPartnerSlotOverride | null;
  attribution: TeamFunnelAttribution;
}): ResolvedTeamFunnelProductSlot {
  const template = input.templateSlot;
  const override = input.partnerOverride;
  const overrideUrl = override?.overrideUrl == null ? null : parseSafeTeamFunnelProductUrl(override.overrideUrl);
  const overrideProductUrl = override?.product?.checkoutUrl == null ? null : parseSafeTeamFunnelProductUrl(override.product.checkoutUrl);
  const templateUrl = template?.product?.checkoutUrl == null ? null : parseSafeTeamFunnelProductUrl(template.product.checkoutUrl);
  const offerLabel = template?.offerLabel ?? null;

  if (overrideUrl) {
    return resolved(input.slotKey, "partner_override", override?.productId ?? template?.productId ?? null, overrideUrl, offerLabel, input.attribution);
  }
  if (overrideProductUrl) {
    return resolved(input.slotKey, "partner_override", override?.productId ?? null, overrideProductUrl, offerLabel, input.attribution);
  }
  if (templateUrl) {
    return resolved(input.slotKey, "template_default", template?.productId ?? null, templateUrl, offerLabel, input.attribution);
  }
  return resolved(input.slotKey, "missing", null, null, offerLabel, input.attribution);
}

/** Always returns all approved slots, including an explicit missing state. */
export function resolveTeamFunnelProductSlots(input: {
  templateSlots: readonly TeamFunnelTemplateSlot[];
  partnerOverrides: readonly TeamFunnelPartnerSlotOverride[];
  attribution: TeamFunnelAttribution;
}): ResolvedTeamFunnelProductSlot[] {
  const templateSlots = new Map<TeamFunnelProductSlotKey, TeamFunnelTemplateSlot>();
  for (const slot of input.templateSlots) {
    if (isApprovedTeamFunnelProductSlot(slot.slotKey) && !templateSlots.has(slot.slotKey)) {
      templateSlots.set(slot.slotKey, slot);
    }
  }
  const overrides = new Map(input.partnerOverrides.map((override) => [override.productSlotId, override]));

  return teamFunnelProductSlotKeys.map((slotKey) => {
    const templateSlot = templateSlots.get(slotKey) ?? null;
    return resolveTeamFunnelProductSlot({
      slotKey,
      templateSlot,
      partnerOverride: templateSlot ? overrides.get(templateSlot.id) ?? null : null,
      attribution: input.attribution,
    });
  });
}

export async function getTeamFunnelPartnerProfile(input: { teamId: string; pageId: string }) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const page = await loadPage(actor, input.pageId);
  await assertPageAccess(actor, page, "read");
  return profileFromPage(page);
}

export async function resolvePersistedTeamFunnelProductSlots(input: { teamId: string; pageId: string }) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const page = await loadPage(actor, input.pageId);
  await assertPageAccess(actor, page, "read");
  const profile = profileFromPage(page);
  return {
    profile,
    slots: resolveTeamFunnelProductSlots({
      templateSlots: page.templateVersion.productSlots,
      partnerOverrides: page.productOverrides,
      attribution: profile.clickAttribution,
    }),
  };
}

/** Adds an immutable template default as a product reference, never as a partner URL. */
export async function createTeamFunnelTemplateProductSlot(input: {
  teamId: string;
  templateVersionId: string;
  slotKey: TeamFunnelProductSlotKey;
  productId: string;
  offerLabel?: string | null;
}) {
  assertApprovedTeamFunnelProductSlot(input.slotKey);
  const actor = await requireTeamFunnelActor(input.teamId);
  const db = getDb();
  const version = await db.teamFunnelTemplateVersion.findFirst({
    where: { id: input.templateVersionId, vendorId: actor.vendorId, teamId: actor.teamId },
    include: { fieldLocks: { select: { field: true } } },
  });
  if (!version) throw new TeamFunnelAccessDeniedError("missing_resource");
  await assertVersionAccess(actor, version);

  const product = await db.product.findFirst({
    where: { id: input.productId, vendorId: actor.vendorId, isActive: true },
    select: { id: true },
  });
  if (!product) throw new TeamFunnelAccessDeniedError("missing_resource");

  const existing = await db.teamFunnelTemplateProductSlot.findFirst({
    where: { vendorId: actor.vendorId, templateVersionId: version.id, slotKey: input.slotKey },
    select: { id: true },
  });
  if (existing) throw new TeamFunnelProductSlotConflictError();

  const displayOrder = teamFunnelProductSlotKeys.indexOf(input.slotKey);
  return db.teamFunnelTemplateProductSlot.create({
    data: {
      vendorId: actor.vendorId,
      templateVersionId: version.id,
      productId: product.id,
      slotKey: input.slotKey,
      displayOrder,
      offerLabel: input.offerLabel ?? null,
    },
  });
}

/** Persists only B's scoped product selection/link after slot-lock authorization. */
export async function upsertTeamFunnelPartnerProductSlotOverride(input: {
  teamId: string;
  pageId: string;
  slotKey: TeamFunnelProductSlotKey;
  productId?: string | null;
  overrideUrl?: string | null;
}) {
  assertApprovedTeamFunnelProductSlot(input.slotKey);
  if (input.overrideUrl != null) input.overrideUrl = assertSafeTeamFunnelProductUrl(input.overrideUrl);

  const actor = await requireTeamFunnelActor(input.teamId);
  const page = await loadPage(actor, input.pageId);
  await assertPageAccess(actor, page, "edit");
  const slot = page.templateVersion.productSlots.find((candidate) => candidate.slotKey === input.slotKey);
  if (!slot) throw new TeamFunnelAccessDeniedError("missing_resource");

  let productId: string | null = input.productId ?? null;
  if (productId) {
    const product = await getDb().product.findFirst({
      where: { id: productId, vendorId: actor.vendorId, isActive: true },
      select: { id: true },
    });
    if (!product) throw new TeamFunnelAccessDeniedError("missing_resource");
    productId = product.id;
  }

  return getDb().partnerProductSlotOverride.upsert({
    where: { pageId_productSlotId: { pageId: page.id, productSlotId: slot.id } },
    create: {
      vendorId: actor.vendorId,
      pageId: page.id,
      productSlotId: slot.id,
      productId,
      overrideUrl: input.overrideUrl ?? null,
    },
    update: { productId, overrideUrl: input.overrideUrl ?? null },
  });
}

function resolved(
  slotKey: TeamFunnelProductSlotKey,
  source: ResolvedTeamFunnelProductSlot["source"],
  productId: string | null,
  url: string | null,
  offerLabel: string | null,
  attribution: TeamFunnelAttribution,
): ResolvedTeamFunnelProductSlot {
  return { slotKey, status: url ? "resolved" : "missing", source, productId, url, offerLabel, attribution };
}

async function loadPage(actor: TeamFunnelMembership, pageId: string) {
  const page = await getDb().partnerFunnelPage.findFirst({
    where: { id: pageId, vendorId: actor.vendorId, teamId: actor.teamId },
    include: {
      live: { select: { seminarOwnerMembershipId: true } },
      templateVersion: {
        include: {
          fieldLocks: { select: { field: true } },
          productSlots: { include: { product: { select: { id: true, checkoutUrl: true } } } },
        },
      },
      productOverrides: { include: { product: { select: { id: true, checkoutUrl: true } } } },
    },
  });
  if (!page) throw new TeamFunnelAccessDeniedError("missing_resource");
  return page;
}

function profileFromPage(page: Awaited<ReturnType<typeof loadPage>>) {
  return resolveTeamFunnelPartnerProfile({
    pageId: page.id,
    vendorId: page.vendorId,
    teamId: page.teamId,
    contentOwnerMembershipId: page.contentOwnerMembershipId,
    promoterMembershipId: page.promoterMembershipId,
    live: page.live,
  });
}

async function assertPageAccess(
  actor: TeamFunnelMembership,
  page: Awaited<ReturnType<typeof loadPage>>,
  action: Extract<TeamFunnelAction, "read" | "edit">,
) {
  await assertResourceAccess(actor, action, {
    id: page.id,
    kind: "page",
    vendorId: page.vendorId,
    teamId: page.teamId,
    promoterMembershipId: page.promoterMembershipId,
    contentOwnerMembershipId: page.contentOwnerMembershipId,
    seminarOwnerMembershipId: page.live?.seminarOwnerMembershipId,
    lockedFields: page.templateVersion.fieldLocks.map((lock) => lock.field),
  }, action === "edit" ? "PRODUCT_SLOTS" : undefined);
}

async function assertVersionAccess(
  actor: TeamFunnelMembership,
  version: { id: string; vendorId: string; teamId: string; contentOwnerMembershipId: string },
) {
  await assertResourceAccess(actor, "edit", {
    id: version.id,
    kind: "templateVersion",
    vendorId: version.vendorId,
    teamId: version.teamId,
    contentOwnerMembershipId: version.contentOwnerMembershipId,
  });
}

async function assertResourceAccess(
  actor: TeamFunnelMembership,
  action: TeamFunnelAction,
  resource: TeamFunnelResource,
  field?: "PRODUCT_SLOTS",
) {
  const db = getDb();
  const [memberships, relationships] = await Promise.all([
    db.teamMembership.findMany({
      where: { vendorId: actor.vendorId, teamId: actor.teamId },
      select: {
        id: true, vendorId: true, teamId: true, vendorMemberId: true, status: true, leftAt: true,
        vendorMember: { select: { userId: true, status: true, deactivatedAt: true } },
      },
    }),
    db.teamMembershipRelationship.findMany({
      where: { teamId: actor.teamId },
      select: { teamId: true, uplineMembershipId: true, downlineMembershipId: true, effectiveAt: true, endedAt: true },
    }),
  ]);
  assertTeamFunnelAccess({
    action,
    actor,
    resource,
    field,
    memberships: memberships.map((membership) => ({
      ...membership,
      userId: membership.vendorMember.userId,
      vendorMemberStatus: membership.vendorMember.status,
      vendorMemberDeactivatedAt: membership.vendorMember.deactivatedAt,
    })),
    relationships,
  });
}
