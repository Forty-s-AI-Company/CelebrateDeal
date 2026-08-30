import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  assertTeamFunnelAccess: vi.fn(),
  claimTeamFunnelShare: vi.fn(),
  requireTeamFunnelActor: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  teamMembershipRelationshipFindMany: vi.fn(),
  partnerFunnelPageFindFirst: vi.fn(),
  partnerFunnelPageUpdateMany: vi.fn(),
  partnerFunnelPageShareSettingUpsert: vi.fn(),
  upsertTeamFunnelPartnerProductSlotOverride: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    teamMembership: { findMany: mocks.teamMembershipFindMany },
    teamMembershipRelationship: { findMany: mocks.teamMembershipRelationshipFindMany },
    partnerFunnelPage: {
      findFirst: mocks.partnerFunnelPageFindFirst,
      updateMany: mocks.partnerFunnelPageUpdateMany,
    },
    partnerFunnelPageShareSetting: { upsert: mocks.partnerFunnelPageShareSettingUpsert },
  }),
}));
vi.mock("@/lib/team-funnel-access", () => ({
  assertTeamFunnelAccess: mocks.assertTeamFunnelAccess,
  requireTeamFunnelActor: mocks.requireTeamFunnelActor,
  TeamFunnelAccessDeniedError: class TeamFunnelAccessDeniedError extends Error {},
}));
vi.mock("@/lib/team-funnel-product-slots", () => ({
  upsertTeamFunnelPartnerProductSlotOverride: mocks.upsertTeamFunnelPartnerProductSlotOverride,
}));
vi.mock("@/lib/team-funnel-sharing", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/team-funnel-sharing")>(),
  claimTeamFunnelShare: mocks.claimTeamFunnelShare,
}));

import { claimTeamTemplateAction, savePartnerPageAction, setPartnerPagePublishAction } from "./team-funnel-partner-actions";

const partnerPage = {
  id: "page-1",
  slug: "partner-page",
  vendorId: "vendor-1",
  teamId: "team-1",
  promoterMembershipId: "member-b",
  contentOwnerMembershipId: "member-a",
  templateVersion: {
    fieldLocks: [],
    productSlots: [
      { slotKey: "main_product" },
      { slotKey: "bundle_product" },
      { slotKey: "join_member" },
      { slotKey: "consultation" },
    ],
  },
};

function pageFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("teamId", "team-1");
  formData.set("pageId", "page-1");
  formData.set("headline", "B 的活動標題");
  formData.set("subheadline", "B 的副標題");
  formData.set("body", "活動內容");
  formData.set("ctaLabel", "立即購買");
  formData.set("ctaUrl", "https://app.example.test/products/product-1");
  formData.set("product_main_product", "product-1");
  formData.set("url_main_product", "https://app.example.test/products/product-1");
  formData.set("product_bundle_product", "");
  formData.set("url_bundle_product", "");
  formData.set("product_join_member", "member-plan");
  formData.set("url_join_member", "https://app.example.test/join");
  formData.set("product_consultation", "");
  formData.set("url_consultation", "");
  for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
  return formData;
}

function claimFormData() {
  const formData = new FormData();
  formData.set("teamId", "team-1");
  formData.set("shareCode", "tf1.valid-share-code-with-sufficient-entropy");
  formData.set("mode", "QUICK_APPLY");
  formData.set("slug", "partner-page");
  formData.set("confirmed", "yes");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.claimTeamFunnelShare.mockResolvedValue({ page: { id: "page-1" }, duplicate: false });
  mocks.requireTeamFunnelActor.mockResolvedValue({ id: "member-b", vendorId: "vendor-1", teamId: "team-1" });
  mocks.teamMembershipFindMany.mockResolvedValue([
    {
      id: "member-a",
      vendorId: "vendor-1",
      teamId: "team-1",
      vendorMemberId: "vendor-member-a",
      status: "ACTIVE",
      leftAt: null,
      vendorMember: { userId: "user-a", status: "active", deactivatedAt: null },
    },
    {
      id: "member-b",
      vendorId: "vendor-1",
      teamId: "team-1",
      vendorMemberId: "vendor-member-b",
      status: "ACTIVE",
      leftAt: null,
      vendorMember: { userId: "user-b", status: "active", deactivatedAt: null },
    },
  ]);
  mocks.teamMembershipRelationshipFindMany.mockResolvedValue([]);
  mocks.partnerFunnelPageFindFirst.mockResolvedValue(partnerPage);
  mocks.partnerFunnelPageUpdateMany.mockResolvedValue({ count: 1 });
  mocks.partnerFunnelPageShareSettingUpsert.mockResolvedValue({ id: "share-setting-1" });
  mocks.upsertTeamFunnelPartnerProductSlotOverride.mockResolvedValue({ id: "slot-override-1" });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("claimTeamTemplateAction", () => {
  it("redirects from the server after a successful claim instead of returning a client navigation effect", async () => {
    await expect(claimTeamTemplateAction({ status: "idle", message: "" }, claimFormData())).rejects.toThrow(
      "redirect:/partner-pages/page-1/edit",
    );

    expect(mocks.claimTeamFunnelShare).toHaveBeenCalledWith({
      teamId: "team-1",
      shareCode: "tf1.valid-share-code-with-sufficient-entropy",
      mode: "QUICK_APPLY",
      slug: "partner-page",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/partner-pages");
  });

  it("returns a generic error state without redirecting when the claim service fails", async () => {
    mocks.claimTeamFunnelShare.mockRejectedValue(new Error("sensitive provider detail"));

    await expect(claimTeamTemplateAction({ status: "idle", message: "" }, claimFormData())).resolves.toEqual({
      status: "error",
      message: "操作未完成，請檢查資料後再試一次。",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("savePartnerPageAction", () => {
  it("persists editable copy and delegates every exposed product slot to the scoped service", async () => {
    await expect(savePartnerPageAction({ status: "idle", message: "" }, pageFormData())).resolves.toEqual({
      status: "success",
      message: "夥伴頁已儲存。",
    });

    expect(mocks.partnerFunnelPageUpdateMany).toHaveBeenCalledWith({
      where: { id: "page-1", vendorId: "vendor-1", teamId: "team-1", promoterMembershipId: "member-b" },
      data: {
        headline: "B 的活動標題",
        subheadline: "B 的副標題",
        body: "活動內容",
        ctaLabel: "立即購買",
        ctaUrl: "https://app.example.test/products/product-1",
      },
    });
    expect(mocks.upsertTeamFunnelPartnerProductSlotOverride).toHaveBeenCalledTimes(4);
    expect(mocks.upsertTeamFunnelPartnerProductSlotOverride).toHaveBeenCalledWith({
      teamId: "team-1",
      pageId: "page-1",
      slotKey: "main_product",
      productId: "product-1",
      overrideUrl: "https://app.example.test/products/product-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/p/partner-page");
  });

  it("rejects an invalid CTA URL before any copy or slot write", async () => {
    const result = await savePartnerPageAction(
      { status: "idle", message: "" },
      pageFormData({ ctaUrl: "not-a-url" }),
    );

    expect(result).toEqual({ status: "error", message: "CTA 連結必須是有效的完整網址。" });
    expect(mocks.partnerFunnelPageUpdateMany).not.toHaveBeenCalled();
    expect(mocks.upsertTeamFunnelPartnerProductSlotOverride).not.toHaveBeenCalled();
  });

  it("fails closed when the page is not owned by the current promoter", async () => {
    mocks.partnerFunnelPageFindFirst.mockResolvedValue(null);

    await expect(savePartnerPageAction({ status: "idle", message: "" }, pageFormData())).resolves.toEqual({
      status: "error",
      message: "你沒有存取這個夥伴頁的權限，或它已不再可用。",
    });
    expect(mocks.partnerFunnelPageUpdateMany).not.toHaveBeenCalled();
  });
});

describe("setPartnerPagePublishAction", () => {
  it.each([
    ["true", "PUBLIC", true, "夥伴頁已發布。"],
    ["false", "DISABLED", false, "夥伴頁已停止公開。"],
  ])("sets the page visibility to %s through the scoped share setting", async (publish, accessMode, isEnabled, message) => {
    await expect(setPartnerPagePublishAction(
      { status: "idle", message: "" },
      pageFormData({ publish }),
    )).resolves.toEqual({ status: "success", message });

    expect(mocks.partnerFunnelPageShareSettingUpsert).toHaveBeenCalledWith({
      where: { pageId: "page-1" },
      create: { pageId: "page-1", accessMode, isEnabled },
      update: { accessMode, isEnabled },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/p/partner-page");
  });
});
