import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import {
  TeamFunnelAccessDeniedError,
  assertTeamFunnelAccess,
  requireTeamFunnelActor,
  type TeamFunnelAction,
  type TeamFunnelField,
  type TeamFunnelMembership,
  type TeamFunnelResource,
} from "@/lib/team-funnel-access";
import {
  renderTeamFunnelTemplateText,
  type TeamFunnelTemplateRenderResult,
} from "@/lib/team-funnel-template-renderer";
import type { TeamFunnelDynamicFieldContext } from "@/lib/team-funnel-dynamic-fields";
import {
  assertApprovedTeamFunnelProductSlot,
  teamFunnelProductSlotKeys,
  type TeamFunnelProductSlotKey,
} from "@/lib/team-funnel-product-slots";

export const teamFunnelFields = ["HEADLINE", "SUBHEADLINE", "BODY", "CTA_LABEL", "CTA_URL", "PRODUCT_SLOTS"] as const;
export type TeamFunnelPageField = (typeof teamFunnelFields)[number];

export type TeamFunnelPageContent = {
  headline: string;
  subheadline?: string | null;
  body?: string | null;
  ctaLabel: string;
  ctaUrl?: string | null;
};

export type CreateTeamFunnelOriginalPageInput = {
  teamId: string;
  name: string;
  slug: string;
  content: TeamFunnelPageContent;
  lockedFields?: readonly TeamFunnelPageField[];
  productSlots?: readonly TeamFunnelTemplateProductSelection[];
  webinarId?: string | null;
};

export type PublishTeamFunnelTemplateVersionInput = {
  teamId: string;
  templateId: string;
  content: TeamFunnelPageContent;
  lockedFields?: readonly TeamFunnelPageField[];
  productSlots?: readonly TeamFunnelTemplateProductSelection[];
  sourcePage?: TeamFunnelSourcePageUpdate;
};

export type TeamFunnelTemplateProductSelection = {
  slotKey: TeamFunnelProductSlotKey;
  productId: string;
  offerLabel?: string | null;
};

export type TeamFunnelSourcePageUpdate = {
  pageId: string;
  slug: string;
  webinarId?: string | null;
};

export type CopyTeamFunnelTemplateVersionInput = {
  teamId: string;
  templateVersionId: string;
  slug: string;
};

export type TeamFunnelFieldModes = Record<TeamFunnelPageField, "locked" | "editable">;

export type RenderedTeamFunnelPageText = {
  headline: TeamFunnelTemplateRenderResult;
  subheadline: TeamFunnelTemplateRenderResult | null;
  body: TeamFunnelTemplateRenderResult | null;
  ctaLabel: TeamFunnelTemplateRenderResult;
  ctaUrl: TeamFunnelTemplateRenderResult | null;
};

export class TeamFunnelConflictError extends Error {
  readonly code = "TEAM_FUNNEL_CONFLICT";

  constructor(message = "The team funnel resource conflicts with an existing resource") {
    super(message);
    this.name = "TeamFunnelConflictError";
  }
}

const TEAM_FUNNEL_PUBLISH_MAX_ATTEMPTS = 3;

/**
 * Produces the lock contract for a version. Versions are immutable, so changing
 * editable/locked fields is always done by publishing a later version.
 */
export function getTeamFunnelFieldModes(lockedFields: readonly TeamFunnelPageField[] = []): TeamFunnelFieldModes {
  const locked = new Set(lockedFields);
  return Object.fromEntries(teamFunnelFields.map((field) => [field, locked.has(field) ? "locked" : "editable"])) as TeamFunnelFieldModes;
}

/**
 * Renders stored text only through the allowlisted dynamic-field renderer. The
 * original stored content is never mutated by rendering or later publications.
 */
export function renderTeamFunnelPageText(
  content: TeamFunnelPageContent,
  context: TeamFunnelDynamicFieldContext,
): RenderedTeamFunnelPageText {
  return {
    headline: renderTeamFunnelTemplateText(content.headline, context),
    subheadline: content.subheadline == null ? null : renderTeamFunnelTemplateText(content.subheadline, context),
    body: content.body == null ? null : renderTeamFunnelTemplateText(content.body, context),
    ctaLabel: renderTeamFunnelTemplateText(content.ctaLabel, context),
    ctaUrl: content.ctaUrl == null ? null : renderTeamFunnelTemplateText(content.ctaUrl, context),
  };
}

/** Creates A's source template, first immutable version, and independent source page in one transaction. */
export async function createTeamFunnelOriginalPage(input: CreateTeamFunnelOriginalPageInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  await assertCreateAccess(actor);
  const db = getDb();
  const lockedFields = normalizedLockedFields(input.lockedFields);
  const productSlots = normalizedProductSlots(input.productSlots);

  try {
    return await db.$transaction(async (tx) => {
      await assertSellableProducts(tx, actor, productSlots);
      const webinarId = await validateWebinar(tx, actor, input.webinarId);
      const template = await tx.teamFunnelTemplate.create({
        data: { vendorId: actor.vendorId, teamId: actor.teamId, name: input.name, status: "ACTIVE" },
      });
      const version = await tx.teamFunnelTemplateVersion.create({
        data: versionData({
          actor,
          templateId: template.id,
          version: 1,
          content: input.content,
          lockedFields,
          productSlots,
        }),
        include: { fieldLocks: { select: { field: true } } },
      });
      const page = await tx.partnerFunnelPage.create({
        data: pageData({ actor, templateVersionId: version.id, slug: input.slug, content: input.content, webinarId }),
      });

      return { template, version, page, fieldModes: getTeamFunnelFieldModes(lockedFields) };
    });
  } catch (error) {
    throw normalizeWriteError(error);
  }
}

/** Publishes a new immutable version; existing partner pages retain their copied text and lineage. */
export async function publishTeamFunnelTemplateVersion(input: PublishTeamFunnelTemplateVersionInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const db = getDb();
  const template = await db.teamFunnelTemplate.findFirst({
    where: { id: input.templateId, vendorId: actor.vendorId, teamId: actor.teamId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { fieldLocks: { select: { field: true } } },
      },
    },
  });
  const current = template?.versions[0];
  if (!template || !current) throw new TeamFunnelAccessDeniedError("missing_resource");

  await assertResourceAccess(actor, "edit", templateVersionResource(current));
  const lockedFields = normalizedLockedFields(input.lockedFields);
  const productSlots = normalizedProductSlots(input.productSlots);

  for (let attempt = 1; attempt <= TEAM_FUNNEL_PUBLISH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const latest = await tx.teamFunnelTemplateVersion.findFirst({
          where: { templateId: template.id, vendorId: actor.vendorId, teamId: actor.teamId },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        if (!latest) throw new TeamFunnelAccessDeniedError("missing_resource");

        await assertSellableProducts(tx, actor, productSlots);
        const webinarId = await validateWebinar(tx, actor, input.sourcePage?.webinarId);
        if (input.sourcePage) {
          const sourcePage = await tx.partnerFunnelPage.findFirst({
            where: {
              id: input.sourcePage.pageId,
              vendorId: actor.vendorId,
              teamId: actor.teamId,
              promoterMembershipId: actor.id,
              contentOwnerMembershipId: actor.id,
              templateVersion: { templateId: template.id },
            },
            select: { id: true },
          });
          if (!sourcePage) throw new TeamFunnelAccessDeniedError("missing_resource");
        }

        const version = await tx.teamFunnelTemplateVersion.create({
          data: versionData({
            actor,
            templateId: template.id,
            version: latest.version + 1,
            content: input.content,
            lockedFields,
            productSlots,
          }),
          include: { fieldLocks: { select: { field: true } } },
        });
        await tx.teamFunnelTemplate.update({ where: { id: template.id }, data: { status: "ACTIVE" } });

        if (input.sourcePage) {
          const sourcePage = await tx.partnerFunnelPage.updateMany({
            where: {
              id: input.sourcePage.pageId,
              vendorId: actor.vendorId,
              teamId: actor.teamId,
              promoterMembershipId: actor.id,
              contentOwnerMembershipId: actor.id,
              templateVersion: { templateId: template.id },
            },
            data: {
              templateVersionId: version.id,
              slug: input.sourcePage.slug,
              liveId: webinarId,
              headline: input.content.headline,
              subheadline: input.content.subheadline ?? null,
              body: input.content.body ?? null,
              ctaLabel: input.content.ctaLabel,
              ctaUrl: input.content.ctaUrl ?? null,
            },
          });
          if (sourcePage.count !== 1) throw new TeamFunnelAccessDeniedError("missing_resource");
        }

        return { templateId: template.id, version, fieldModes: getTeamFunnelFieldModes(lockedFields) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isRetriablePublishConflict(error) && attempt < TEAM_FUNNEL_PUBLISH_MAX_ATTEMPTS) continue;
      throw normalizeWriteError(error);
    }
  }

  throw new TeamFunnelConflictError();
}

/**
 * Creates B's independent copy of one immutable version. The schema's unique
 * key makes repeated requests converge on the same page instead of duplicating it.
 */
export async function copyTeamFunnelTemplateVersion(input: CopyTeamFunnelTemplateVersionInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const db = getDb();
  const version = await db.teamFunnelTemplateVersion.findFirst({
    where: { id: input.templateVersionId, vendorId: actor.vendorId, teamId: actor.teamId },
    include: { fieldLocks: { select: { field: true } } },
  });
  if (!version) throw new TeamFunnelAccessDeniedError("missing_resource");

  await assertResourceAccess(actor, "copy", templateVersionResource(version));

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.partnerFunnelPage.findFirst({
        where: {
          vendorId: actor.vendorId,
          teamId: actor.teamId,
          templateVersionId: version.id,
          promoterMembershipId: actor.id,
        },
      });
      if (existing) return { page: existing, duplicate: true as const };

      const page = await tx.partnerFunnelPage.create({
        data: pageData({
          actor,
          templateVersionId: version.id,
          slug: input.slug,
          content: version,
          contentOwnerMembershipId: version.contentOwnerMembershipId,
        }),
      });
      return { page, duplicate: false as const };
    });

    return { ...result, source: sourceLineage(version), fieldModes: getTeamFunnelFieldModes(version.fieldLocks.map((lock) => lock.field)) };
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const existing = await db.partnerFunnelPage.findFirst({
        where: {
          vendorId: actor.vendorId,
          teamId: actor.teamId,
          templateVersionId: version.id,
          promoterMembershipId: actor.id,
        },
      });
      if (existing) {
        return {
          page: existing,
          duplicate: true as const,
          source: sourceLineage(version),
          fieldModes: getTeamFunnelFieldModes(version.fieldLocks.map((lock) => lock.field)),
        };
      }
    }
    throw normalizeWriteError(error);
  }
}

async function assertCreateAccess(actor: TeamFunnelMembership) {
  await assertResourceAccess(actor, "edit", {
    id: `new-template:${actor.id}`,
    kind: "template",
    vendorId: actor.vendorId,
    teamId: actor.teamId,
    contentOwnerMembershipId: actor.id,
  });
}

async function assertResourceAccess(actor: TeamFunnelMembership, action: TeamFunnelAction, resource: TeamFunnelResource) {
  const db = getDb();
  const [memberships, relationships] = await Promise.all([
    db.teamMembership.findMany({
      where: { vendorId: actor.vendorId, teamId: actor.teamId },
      select: {
        id: true,
        vendorId: true,
        teamId: true,
        vendorMemberId: true,
        status: true,
        leftAt: true,
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
    memberships: memberships.map((membership) => ({
      ...membership,
      userId: membership.vendorMember.userId,
      vendorMemberStatus: membership.vendorMember.status,
      vendorMemberDeactivatedAt: membership.vendorMember.deactivatedAt,
    })),
    relationships,
  });
}

function versionData({
  actor,
  templateId,
  version,
  content,
  lockedFields,
  productSlots,
}: {
  actor: TeamFunnelMembership;
  templateId: string;
  version: number;
  content: TeamFunnelPageContent;
  lockedFields: readonly TeamFunnelPageField[];
  productSlots: readonly TeamFunnelTemplateProductSelection[];
}) {
  return {
    vendorId: actor.vendorId,
    teamId: actor.teamId,
    templateId,
    version,
    contentOwnerMembershipId: actor.id,
    createdByMemberId: actor.vendorMemberId,
    ...content,
    fieldLocks: {
      // The parent version supplies this relation's vendor through its
      // composite key; nested create input must not repeat `vendorId`.
      create: lockedFields.map((field) => ({ field, lockedByMemberId: actor.vendorMemberId })),
    },
    productSlots: {
      create: productSlots.map((slot) => ({
        productId: slot.productId,
        slotKey: slot.slotKey,
        displayOrder: teamFunnelProductSlotKeys.indexOf(slot.slotKey),
        offerLabel: slot.offerLabel ?? null,
      })),
    },
  };
}

function pageData({
  actor,
  templateVersionId,
  slug,
  content,
  contentOwnerMembershipId = actor.id,
  webinarId = null,
}: {
  actor: TeamFunnelMembership;
  templateVersionId: string;
  slug: string;
  content: TeamFunnelPageContent;
  contentOwnerMembershipId?: string;
  webinarId?: string | null;
}) {
  return {
    vendorId: actor.vendorId,
    teamId: actor.teamId,
    templateVersionId,
    promoterMembershipId: actor.id,
    contentOwnerMembershipId,
    liveId: webinarId,
    slug,
    headline: content.headline,
    subheadline: content.subheadline ?? null,
    body: content.body ?? null,
    ctaLabel: content.ctaLabel,
    ctaUrl: content.ctaUrl ?? null,
  };
}

function templateVersionResource(version: {
  id: string;
  vendorId: string;
  teamId: string;
  contentOwnerMembershipId: string;
  fieldLocks: readonly { field: TeamFunnelPageField }[];
}): TeamFunnelResource {
  return {
    id: version.id,
    kind: "templateVersion",
    vendorId: version.vendorId,
    teamId: version.teamId,
    contentOwnerMembershipId: version.contentOwnerMembershipId,
    lockedFields: version.fieldLocks.map((lock) => lock.field) as TeamFunnelField[],
  };
}

function sourceLineage(version: { templateId: string; id: string; version: number }) {
  return { templateId: version.templateId, templateVersionId: version.id, version: version.version };
}

function normalizedLockedFields(fields: readonly TeamFunnelPageField[] | undefined) {
  return [...new Set(fields ?? [])];
}

function normalizedProductSlots(slots: readonly TeamFunnelTemplateProductSelection[] | undefined) {
  const normalized = [...(slots ?? [])];
  const seen = new Set<TeamFunnelProductSlotKey>();

  for (const slot of normalized) {
    assertApprovedTeamFunnelProductSlot(slot.slotKey);
    if (!slot.productId || seen.has(slot.slotKey)) throw new TeamFunnelConflictError();
    seen.add(slot.slotKey);
  }

  return normalized;
}

async function assertSellableProducts(
  tx: Prisma.TransactionClient,
  actor: TeamFunnelMembership,
  slots: readonly TeamFunnelTemplateProductSelection[],
) {
  const productIds = [...new Set(slots.map((slot) => slot.productId))];
  if (productIds.length === 0) return;

  const products = await tx.product.findMany({
    where: {
      id: { in: productIds },
      vendorId: actor.vendorId,
      isActive: true,
      fulfillmentTypeConfirmed: true,
    },
    select: { id: true },
  });
  if (products.length !== productIds.length) throw new TeamFunnelAccessDeniedError("missing_resource");
}

async function validateWebinar(
  tx: Prisma.TransactionClient,
  actor: TeamFunnelMembership,
  webinarId: string | null | undefined,
) {
  if (!webinarId) return null;

  const webinar = await tx.live.findFirst({
    where: {
      id: webinarId,
      vendorId: actor.vendorId,
      teamId: actor.teamId,
      seminarOwnerMembershipId: actor.id,
    },
    select: { id: true },
  });
  if (!webinar) throw new TeamFunnelAccessDeniedError("missing_resource");
  return webinar.id;
}

function isUniqueConstraint(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2002" || error.code === "P2034");
}

function isRetriablePublishConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2002" || !("meta" in error)) return false;

  const target = JSON.stringify(error.meta ?? "");
  return target.includes("templateId") && target.includes("version");
}

function normalizeWriteError(error: unknown): Error {
  if (isUniqueConstraint(error)) return new TeamFunnelConflictError();
  return error instanceof Error ? error : new Error("Team funnel write failed");
}
