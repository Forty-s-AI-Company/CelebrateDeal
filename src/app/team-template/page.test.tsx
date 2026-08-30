import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  getCsrfToken: vi.fn(),
  shareFindFirst: vi.fn(),
  membershipFindFirst: vi.fn(),
  relationshipFindFirst: vi.fn(),
  hashShareCode: vi.fn(),
  claimAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor, requireAuth: mocks.requireAuth }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    partnerFunnelPageShareSetting: { findFirst: mocks.shareFindFirst },
    teamMembership: { findFirst: mocks.membershipFindFirst },
    teamMembershipRelationship: { findFirst: mocks.relationshipFindFirst },
  }),
}));
vi.mock("@/lib/team-funnel-sharing", () => ({ hashShareCode: mocks.hashShareCode }));
vi.mock("@/app/actions/team-funnel-partner-actions", () => ({ claimTeamTemplateAction: mocks.claimAction }));
vi.mock("@/components/team-template-claim", () => ({
  TeamTemplateClaim: ({ template }: { template: { templateName: string; sourceOwnerName: string; lockedFields: string[] } }) => (
    <div data-testid="team-template-claim">{JSON.stringify(template)}</div>
  ),
  TeamTemplateClaimError: ({ state }: { state: string }) => <div role="alert">share-error:{state}</div>,
}));

import TeamTemplateClaimPage from "./page";

function memberShare() {
  const encoded = Buffer.from(JSON.stringify({ audience: { type: "MEMBER", membershipId: "membership-1" } }), "utf8").toString("base64url");
  return `tf1.${encoded}.${"a".repeat(32)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
  mocks.hashShareCode.mockReturnValue("share-hash");
  mocks.shareFindFirst.mockResolvedValue(null);
  mocks.membershipFindFirst.mockResolvedValue({ id: "membership-1" });
  mocks.relationshipFindFirst.mockResolvedValue({ id: "relationship-1" });
});

describe("/team-template route", () => {
  it("renders the missing-share guidance without querying the database", async () => {
    const html = renderToStaticMarkup(await TeamTemplateClaimPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("取得團隊模板");
    expect(html).toContain("找不到分享連結");
    expect(mocks.shareFindFirst).not.toHaveBeenCalled();
    expect(mocks.hashShareCode).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown share setting", async () => {
    const html = renderToStaticMarkup(await TeamTemplateClaimPage({ searchParams: Promise.resolve({ share: "invalid-share" }) }));

    expect(mocks.hashShareCode).toHaveBeenCalledExactlyOnceWith("invalid-share");
    expect(html).toContain("找不到分享連結");
    expect(html).not.toContain("team-template-claim");
  });

  it("loads a member-scoped share and renders only the controlled template fields", async () => {
    mocks.shareFindFirst.mockResolvedValue({
      isEnabled: true,
      accessMode: "MEMBER",
      expiresAt: null,
      page: {
        vendorId: "vendor-1",
        teamId: "team-1",
        promoterMembershipId: "membership-1",
        contentOwner: { vendorMember: { user: { name: "內容負責人" } } },
        live: { title: "團隊直播" },
        templateVersion: {
          version: 4,
          template: { name: "原始模板" },
          fieldLocks: [{ field: "headline" }],
        },
      },
    });

    const html = renderToStaticMarkup(await TeamTemplateClaimPage({ searchParams: Promise.resolve({ share: memberShare() }) }));

    expect(mocks.shareFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: "share-hash" } }));
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", teamId: "team-1" }) }));
    expect(mocks.relationshipFindFirst).not.toHaveBeenCalled();
    expect(html).toContain("team-template-claim");
    expect(html).toContain("原始模板");
    expect(html).toContain("內容負責人");
    expect(html).toContain("headline");
  });
});
