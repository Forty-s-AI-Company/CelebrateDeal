import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import { applyFunnelTemplateChange } from "@/lib/funnel-template-transaction";
import type { PageDocument } from "@/lib/funnel-page-document";
import { normalizeInteractionEventDraft } from "@/lib/interaction-event";
import { hashTeamFunnelLiveShareCode } from "@/lib/team-funnel-live-sharing";
import { hashShareCode } from "@/lib/team-funnel-sharing";
import { BETA_GATED_FEATURES, VENDOR_FEATURE_MODULES } from "@/lib/vendor-feature-toggles";
import type { TenantData } from "@/test/two-tenant-fixture";

/**
 * A2-06 (R-05 / F-134 third batch): content, settings and team-funnel rows on
 * top of `createTwoTenantFixture`. Every row is synthetic and belongs to exactly
 * one tenant, so a second-tenant test can hand tenant B's identifiers to a
 * tenant-A actor and prove the action refuses them, while the same call with
 * tenant A's identifiers goes through.
 */
export type TenantContent = {
  imageAssetId: string;
  videoId: string;
  archivedVideoId: string;
  messageTemplateId: string;
  messageTemplateUpdatedAt: string;
  liveFormId: string;
  formUpdatedAt: string;
  roleId: string;
  scriptId: string;
  pollRunId: string;
  pollTitle: string;
  funnelPageId: string;
  consultationEventId: string;
  secondProjectId: string;
  team: {
    liveId: string;
    templateId: string;
    versionId: string;
    sourcePageId: string;
    shareCode: string;
    liveShareId: string;
  };
};

/** A Funnel whose first step uses the audience template, as the editor creates it. */
export function audienceFunnelContent() {
  const state = createFunnelStepPages(createFunnelFlow({ id: "flow_audience", name: "合成名單網站", goal: "audience", domain: "synthetic" })!)!;
  const first = state.flow.steps.find((step) => !step.isSystem)!;
  const applied = applyFunnelTemplateChange(state.pages[first.id] as PageDocument, { templateId: "audience" });
  return { ...state, pages: { ...state.pages, [first.id]: applied.document } };
}

/** The opaque team-template share code format of `team-funnel-sharing` (DIRECT_DOWNLINE audience). */
function teamShareCode() {
  const claims = Buffer.from(JSON.stringify({ v: 1, audience: { type: "DIRECT_DOWNLINE" } })).toString("base64url");
  return `tf1.${claims}.${randomBytes(32).toString("base64url")}`;
}

export async function addTenantContent(db: PrismaClient, tenant: TenantData, label: string): Promise<TenantContent> {
  const key = randomUUID();
  const vendorId = tenant.vendor.id;
  await db.vendor.update({
    where: { id: vendorId },
    data: { enabledFeatureModules: [...VENDOR_FEATURE_MODULES], betaFeatureGrants: [...BETA_GATED_FEATURES] },
  });

  const imageAsset = await db.imageAsset.create({
    data: {
      vendorId,
      objectKey: `synthetic/${key}.png`,
      originalFilename: `${label}.png`,
      mimeType: "image/png",
      sizeBytes: 1024,
      publicUrl: `https://images.example.test/${key}.png`,
      status: "ready",
    },
  });
  const video = await db.video.create({
    data: { vendorId, title: `Video ${label}`, sourceType: "url", status: "ready", videoUrl: `https://video.example.test/${key}.m3u8`, durationSec: 3_600 },
  });
  const archivedVideo = await db.video.create({
    data: { vendorId, title: `Archived ${label}`, sourceType: "url", status: "archived", videoUrl: `https://video.example.test/${key}-old.m3u8`, durationSec: 600 },
  });
  await db.videoArchiveState.create({ data: { vendorId, videoId: archivedVideo.id, previousStatus: "ready" } });
  const template = await db.messageTemplate.create({
    data: {
      vendorId,
      name: `Template ${label}`,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{live_title}} 報名成功",
      body: "{{name}} {{unsubscribe_url}}",
      isActive: true,
    },
  });
  const liveForm = await db.registrationForm.create({
    data: {
      vendorId,
      projectId: tenant.projectId,
      name: `Live form ${label}`,
      slug: `live-form-${key}`,
      headline: "Register",
      fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    },
  });

  const role = await db.interactionRole.create({
    data: { vendorId, name: `Role ${label}`, roleType: "official", isActive: true, isScheduled: true },
  });
  const script = await db.interactionScript.create({
    data: {
      vendorId,
      name: `Script ${label}`,
      status: "published",
      events: { create: [{ eventType: "chat_message", triggerSec: 10, title: "歡迎", message: `${label} 歡迎`, roleId: role.id }] },
    },
  });
  await db.live.update({ where: { id: tenant.liveId }, data: { interactionScriptId: script.id } });

  // An open poll on the tenant's Live with one vote.
  const pollTitle = `Poll ${label} ${key.slice(0, 6)}`;
  const poll = normalizeInteractionEventDraft({
    eventType: "poll",
    triggerSec: 0,
    title: pollTitle,
    metadata: { kind: "poll", durationSec: 60, question: "要加購嗎？", options: ["要", "不要"], selectionMode: "single", maxSelections: 2 },
  });
  if (!poll.success || !poll.data.metadata) throw new Error("synthetic poll did not normalize");
  const pollRun = await db.liveInteractionRun.create({
    data: {
      vendorId,
      liveId: tenant.liveId,
      source: "manual",
      eventType: "poll",
      title: pollTitle,
      configuration: poll.data.metadata as unknown as Prisma.InputJsonValue,
      startsAt: new Date(),
      endsAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  await db.liveInteractionResponse.create({
    data: { vendorId, liveId: tenant.liveId, runId: pollRun.id, participantHash: `poll-${key}`, eventType: "poll", value: "要" },
  });

  const funnelPage = await db.landingPage.create({
    data: {
      vendorId,
      projectId: tenant.projectId,
      name: `Funnel ${label}`,
      slug: `funnel-${key}`,
      draftContent: audienceFunnelContent() as unknown as Prisma.InputJsonValue,
    },
  });
  const consultationEvent = await db.consultationEvent.create({
    data: { vendorId, projectId: tenant.projectId, title: `Consultation ${label}`, weeklySchedule: [], intakeFormFields: [] },
  });
  const secondProject = await db.salesProject.create({
    data: { vendorId, name: `Second project ${label}`, slug: `second-${key}`, mode: "live_course", primaryFlow: "live", status: "draft" },
  });

  // Team funnel: the owner is the support member's direct upline and owns a
  // webinar, a template (v1 with a product slot), its source page, the page's
  // share code and a Live share for the support member.
  await db.teamMembershipRelationship.create({
    data: {
      teamId: tenant.teamId,
      uplineMembershipId: tenant.ownerTeamMembershipId,
      downlineMembershipId: tenant.supportTeamMembershipId,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  const teamLive = await db.live.create({
    data: {
      vendorId,
      teamId: tenant.teamId,
      seminarOwnerMembershipId: tenant.ownerTeamMembershipId,
      title: `Team webinar ${label}`,
      slug: `team-live-${key}`,
      status: "scheduled",
      scheduledAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  const teamTemplate = await db.teamFunnelTemplate.create({
    data: { vendorId, teamId: tenant.teamId, name: `Team template ${label} ${key.slice(0, 6)}`, status: "ACTIVE" },
  });
  const version = await db.teamFunnelTemplateVersion.create({
    data: {
      vendorId,
      teamId: tenant.teamId,
      templateId: teamTemplate.id,
      version: 1,
      contentOwnerMembershipId: tenant.ownerTeamMembershipId,
      createdByMemberId: tenant.actors.owner.member.id,
      headline: `${label} 標題`,
      ctaLabel: "立即報名",
      productSlots: { create: [{ productId: tenant.productId, slotKey: "main_product", displayOrder: 0 }] },
    },
  });
  const sourcePage = await db.partnerFunnelPage.create({
    data: {
      vendorId,
      teamId: tenant.teamId,
      templateVersionId: version.id,
      promoterMembershipId: tenant.ownerTeamMembershipId,
      contentOwnerMembershipId: tenant.ownerTeamMembershipId,
      liveId: teamLive.id,
      slug: `partner-${key}`,
      headline: `${label} 標題`,
      ctaLabel: "立即報名",
    },
  });
  const shareCode = teamShareCode();
  await db.partnerFunnelPageShareSetting.create({
    data: { pageId: sourcePage.id, accessMode: "TOKEN_REQUIRED", tokenHash: hashShareCode(shareCode), isEnabled: true },
  });
  const liveShare = await db.partnerLiveShare.create({
    data: {
      vendorId,
      teamId: tenant.teamId,
      liveId: teamLive.id,
      sourcePageId: sourcePage.id,
      promoterMembershipId: tenant.supportTeamMembershipId,
      tokenHash: hashTeamFunnelLiveShareCode(`tls1.${randomBytes(32).toString("base64url")}`),
      isEnabled: true,
    },
  });

  // Prisma returns the stored timestamp; the editors echo it back as the version check.
  const form = await db.registrationForm.findUniqueOrThrow({ where: { id: tenant.formId }, select: { updatedAt: true } });

  return {
    imageAssetId: imageAsset.id,
    videoId: video.id,
    archivedVideoId: archivedVideo.id,
    messageTemplateId: template.id,
    messageTemplateUpdatedAt: template.updatedAt.toISOString(),
    liveFormId: liveForm.id,
    formUpdatedAt: form.updatedAt.toISOString(),
    roleId: role.id,
    scriptId: script.id,
    pollRunId: pollRun.id,
    pollTitle,
    funnelPageId: funnelPage.id,
    consultationEventId: consultationEvent.id,
    secondProjectId: secondProject.id,
    team: {
      liveId: teamLive.id,
      templateId: teamTemplate.id,
      versionId: version.id,
      sourcePageId: sourcePage.id,
      shareCode,
      liveShareId: liveShare.id,
    },
  };
}
