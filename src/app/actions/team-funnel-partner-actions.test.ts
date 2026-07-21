import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  claimTeamFunnelShare: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/team-funnel-sharing", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/team-funnel-sharing")>(),
  claimTeamFunnelShare: mocks.claimTeamFunnelShare,
}));

import { claimTeamTemplateAction } from "./team-funnel-partner-actions";

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
