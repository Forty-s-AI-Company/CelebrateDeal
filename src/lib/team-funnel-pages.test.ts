import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  id: "member-a",
  vendorId: "vendor-1",
  teamId: "team-1",
  vendorMemberId: "vendor-member-a",
  userId: "user-a",
  status: "ACTIVE" as const,
  leftAt: null,
  vendorMemberStatus: "active",
  vendorMemberDeactivatedAt: null,
};
const partner = { ...actor, id: "member-b", vendorMemberId: "vendor-member-b", userId: "user-b" };

const db = {
  $transaction: vi.fn(),
  teamMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  teamFunnelTemplate: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  teamFunnelTemplateVersion: { create: vi.fn(), findFirst: vi.fn() },
  partnerFunnelPage: { create: vi.fn(), findFirst: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: actor.userId }, member: { id: actor.vendorMemberId, status: "active", deactivatedAt: null } })),
  requireVendor: vi.fn(async () => ({ id: actor.vendorId })),
}));

import { POST as pagesPost } from "@/app/api/team-funnel/pages/route";
import { POST as templatesPost } from "@/app/api/team-funnel/templates/route";
import {
  copyTeamFunnelTemplateVersion,
  createTeamFunnelOriginalPage,
  publishTeamFunnelTemplateVersion,
  renderTeamFunnelPageText,
} from "@/lib/team-funnel-pages";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";

const originalContent = {
  headline: "Hello {{partner.displayName}}",
  subheadline: "Launch day",
  body: "{{webinar.title}}",
  ctaLabel: "Join now",
  ctaUrl: "https://example.test/join",
};

function membershipRecord(value = actor) {
  return {
    id: value.id,
    vendorId: value.vendorId,
    teamId: value.teamId,
    vendorMemberId: value.vendorMemberId,
    status: value.status,
    leftAt: value.leftAt,
    vendorMember: {
      userId: value.userId,
      status: value.vendorMemberStatus,
      deactivatedAt: value.vendorMemberDeactivatedAt,
    },
  };
}

function templateVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    vendorId: actor.vendorId,
    teamId: actor.teamId,
    templateId: "template-1",
    version: 1,
    contentOwnerMembershipId: actor.id,
    createdByMemberId: actor.vendorMemberId,
    ...originalContent,
    fieldLocks: [{ field: "CTA_URL" as const }],
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    vendorId: actor.vendorId,
    teamId: actor.teamId,
    templateVersionId: "version-1",
    promoterMembershipId: actor.id,
    contentOwnerMembershipId: actor.id,
    slug: "source-page",
    ...originalContent,
    ...overrides,
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.test", "x-celebratedeal-client": "web" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.teamMembership.findFirst.mockResolvedValue(membershipRecord(actor));
  db.teamMembership.findMany.mockResolvedValue([membershipRecord(actor), membershipRecord(partner)]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([
    { teamId: actor.teamId, uplineMembershipId: actor.id, downlineMembershipId: partner.id, effectiveAt: new Date("2026-01-01"), endedAt: null },
  ]);
  db.$transaction.mockImplementation(async (callback: (transaction: typeof db) => unknown) => callback(db));
  db.teamFunnelTemplate.create.mockResolvedValue({ id: "template-1", name: "Source", status: "ACTIVE" });
  db.teamFunnelTemplateVersion.create.mockResolvedValue(templateVersion());
  db.partnerFunnelPage.create.mockResolvedValue(page());
  db.teamFunnelTemplate.update.mockResolvedValue({ id: "template-1", status: "ACTIVE" });
});

afterEach(() => vi.restoreAllMocks());

describe("team funnel page service", () => {
  it("creates an original page and its immutable locked template version transactionally", async () => {
    const result = await createTeamFunnelOriginalPage({
      teamId: actor.teamId,
      name: "Source",
      slug: "source-page",
      content: originalContent,
      lockedFields: ["CTA_URL"],
    });

    expect(result.version.id).toBe("version-1");
    expect(result.fieldModes).toMatchObject({ CTA_URL: "locked", HEADLINE: "editable" });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.teamFunnelTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        version: 1,
        contentOwnerMembershipId: actor.id,
        fieldLocks: { create: [{ vendorId: actor.vendorId, field: "CTA_URL", lockedByMemberId: actor.vendorMemberId }] },
      }),
    }));
  });

  it("publishes a later immutable version without modifying the existing partner page", async () => {
    db.teamFunnelTemplate.findFirst.mockResolvedValue({ id: "template-1", versions: [templateVersion()] });
    db.teamFunnelTemplateVersion.findFirst.mockResolvedValue({ version: 1 });

    const result = await publishTeamFunnelTemplateVersion({
      teamId: actor.teamId,
      templateId: "template-1",
      content: { ...originalContent, headline: "Second version" },
      lockedFields: ["HEADLINE"],
    });

    expect(result.version.id).toBe("version-1");
    expect(db.teamFunnelTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 2, headline: "Second version" }),
    }));
    expect(db.partnerFunnelPage.create).not.toHaveBeenCalled();
    expect(db.partnerFunnelPage.findFirst).not.toHaveBeenCalled();
  });

  it("copies a specified version once, preserving source lineage and returning the existing copy on retry", async () => {
    db.teamMembership.findFirst.mockResolvedValue(membershipRecord(partner));
    db.teamFunnelTemplateVersion.findFirst.mockResolvedValue(templateVersion());
    db.partnerFunnelPage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(page({ promoterMembershipId: partner.id }));
    db.partnerFunnelPage.create.mockResolvedValue(page({ promoterMembershipId: partner.id }));

    const input = { teamId: actor.teamId, templateVersionId: "version-1", slug: "partner-page" };
    const created = await copyTeamFunnelTemplateVersion(input);
    const retried = await copyTeamFunnelTemplateVersion(input);

    expect(created).toMatchObject({ duplicate: false, source: { templateId: "template-1", templateVersionId: "version-1", version: 1 } });
    expect(retried).toMatchObject({ duplicate: true, source: { templateVersionId: "version-1" } });
    expect(db.partnerFunnelPage.create).toHaveBeenCalledOnce();
    expect(db.partnerFunnelPage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        promoterMembershipId: partner.id,
        contentOwnerMembershipId: actor.id,
        headline: originalContent.headline,
        body: originalContent.body,
      }),
    }));
  });

  it("rejects a cross-tenant version through the same denial path as an absent version", async () => {
    db.teamFunnelTemplateVersion.findFirst.mockResolvedValue(null);

    await expect(copyTeamFunnelTemplateVersion({ teamId: actor.teamId, templateVersionId: "foreign-version", slug: "partner-page" }))
      .rejects.toBeInstanceOf(TeamFunnelAccessDeniedError);
    expect(db.teamFunnelTemplateVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: actor.vendorId, teamId: actor.teamId, id: "foreign-version" }),
    }));
  });

  it("uses the allowlisted renderer without changing stored content", () => {
    const rendered = renderTeamFunnelPageText(originalContent, { partner: { displayName: "Ada" }, webinar: { title: "Demo" } });
    expect(rendered.headline.text).toBe("Hello Ada");
    expect(rendered.body?.text).toBe("Demo");
    expect(originalContent.headline).toBe("Hello {{partner.displayName}}");
  });
});

describe("team funnel JSON routes", () => {
  it("validates page creation requests before accessing services", async () => {
    const response = await pagesPost(jsonRequest("/api/team-funnel/pages", { action: "create", teamId: actor.teamId }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(db.teamMembership.findFirst).not.toHaveBeenCalled();
  });

  it("exposes successful create and publish requests through stable JSON envelopes", async () => {
    const createResponse = await pagesPost(jsonRequest("/api/team-funnel/pages", {
      action: "create", teamId: actor.teamId, name: "Source", slug: "source-page", content: originalContent, lockedFields: ["CTA_URL"],
    }));
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({ data: { template: { id: "template-1" }, fieldModes: { CTA_URL: "locked" } } });

    db.teamFunnelTemplate.findFirst.mockResolvedValue({ id: "template-1", versions: [templateVersion()] });
    db.teamFunnelTemplateVersion.findFirst.mockResolvedValue({ version: 1 });
    const publishResponse = await templatesPost(jsonRequest("/api/team-funnel/templates", {
      action: "publish", teamId: actor.teamId, templateId: "template-1", content: originalContent,
    }));
    expect(publishResponse.status).toBe(201);
    await expect(publishResponse.json()).resolves.toMatchObject({ data: { templateId: "template-1" } });
  });

  it("returns the identical not-found code for a cross-tenant copy request", async () => {
    db.teamFunnelTemplateVersion.findFirst.mockResolvedValue(null);
    const response = await pagesPost(jsonRequest("/api/team-funnel/pages", {
      action: "copy", teamId: actor.teamId, templateVersionId: "foreign-version", slug: "partner-page",
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_NOT_FOUND" } });
  });
});
