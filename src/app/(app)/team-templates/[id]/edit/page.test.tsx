import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  getCsrfToken: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  teamFunnelTemplateFindFirst: vi.fn(),
  productFindMany: vi.fn(),
  liveFindMany: vi.fn(),
  partnerFunnelPageFindFirst: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({
  requireVendor: mocks.requireVendor,
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    teamMembership: { findMany: mocks.teamMembershipFindMany },
    teamFunnelTemplate: { findFirst: mocks.teamFunnelTemplateFindFirst },
    product: { findMany: mocks.productFindMany },
    live: { findMany: mocks.liveFindMany },
    partnerFunnelPage: { findFirst: mocks.partnerFunnelPageFindFirst },
  }),
}));

import EditTeamTemplatePage from "./page";

describe("EditTeamTemplatePage authorization scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.requireAuth.mockResolvedValue({ member: { id: "vendor-member-1" } });
    mocks.getCsrfToken.mockResolvedValue("csrf-token");
    mocks.teamMembershipFindMany.mockResolvedValue([
      { id: "membership-1", teamId: "team-1", team: { name: "Team One" } },
    ]);
    mocks.teamFunnelTemplateFindFirst.mockResolvedValue({
      id: "template-1",
      vendorId: "vendor-1",
      teamId: "team-1",
      name: "Owned Template",
      versions: [{
        id: "version-1",
        version: 1,
        headline: "Headline",
        subheadline: null,
        body: null,
        ctaLabel: "Go",
        ctaUrl: null,
        fieldLocks: [],
        productSlots: [],
      }],
    });
    mocks.productFindMany.mockResolvedValue([]);
    mocks.liveFindMany.mockResolvedValue([]);
    mocks.partnerFunnelPageFindFirst.mockResolvedValue(null);
  });

  it("只載入目前成員擁有的版本與 webinar", async () => {
    await EditTeamTemplatePage({ params: Promise.resolve({ id: "template-1" }) });

    expect(mocks.teamFunnelTemplateFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "template-1",
        vendorId: "vendor-1",
        versions: {
          some: {
            contentOwnerMembershipId: { in: ["membership-1"] },
          },
        },
      }),
      include: {
        versions: expect.objectContaining({
          where: {
            contentOwnerMembershipId: { in: ["membership-1"] },
          },
        }),
      },
    }));
    expect(mocks.liveFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        vendorId: "vendor-1",
        teamId: "team-1",
        seminarOwnerMembershipId: { in: ["membership-1"] },
      }),
    }));
  });
});
