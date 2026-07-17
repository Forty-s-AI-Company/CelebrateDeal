import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicTeamFunnelPage: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("@/lib/team-funnel-public-page", () => ({ getPublicTeamFunnelPage: mocks.getPublicTeamFunnelPage }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import PublicPartnerFunnelPage from "./page";

describe("/p/[slug] route", () => {
  it("server-resolves the slug and passes the safe view to the reusable renderer", async () => {
    mocks.getPublicTeamFunnelPage.mockResolvedValueOnce({ state: "missing_webinar" });
    const result = await PublicPartnerFunnelPage({ params: Promise.resolve({ slug: "partner-b" }) });

    expect(mocks.getPublicTeamFunnelPage).toHaveBeenCalledWith("partner-b");
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(result.props.view).toEqual({ state: "missing_webinar" });
  });

  it("uses Next's 404 boundary only for absent slugs", async () => {
    mocks.getPublicTeamFunnelPage.mockResolvedValueOnce({ state: "not_found" });
    await expect(PublicPartnerFunnelPage({ params: Promise.resolve({ slug: "absent" }) })).rejects.toThrow("not found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
