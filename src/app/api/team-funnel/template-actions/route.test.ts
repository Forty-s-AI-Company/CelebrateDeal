import { beforeEach, describe, expect, it, vi } from "vitest";

const { manageTeamFunnelTemplateAction } = vi.hoisted(() => ({
  manageTeamFunnelTemplateAction: vi.fn(),
}));

vi.mock("@/app/actions/team-funnel-template-actions", () => ({ manageTeamFunnelTemplateAction }));

import { POST } from "@/app/api/team-funnel/template-actions/route";

function templateRequest(entries: Record<string, string>) {
  const formData = new FormData();
  Object.entries(entries).forEach(([key, value]) => formData.set(key, value));
  return new Request("https://app.example.test/api/team-funnel/template-actions", {
    method: "POST",
    headers: { origin: "https://app.example.test" },
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team-funnel/template-actions", () => {
  it("returns the safe success action state without caching it", async () => {
    manageTeamFunnelTemplateAction.mockResolvedValue({
      status: "success",
      message: "分享連結已建立。",
      shareUrl: "/team-template?share=tf1.test",
    });

    const response = await POST(templateRequest({ operation: "create-share", teamId: "team-1", pageId: "page-1" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      status: "success",
      message: "分享連結已建立。",
      shareUrl: "/team-template?share=tf1.test",
    });
    const [initialState, formData] = manageTeamFunnelTemplateAction.mock.calls[0] as [unknown, FormData];
    expect(initialState).toEqual({ status: "idle", message: "" });
    expect(formData.get("operation")).toBe("create-share");
  });

  it("returns action errors as a non-cacheable action-state response", async () => {
    manageTeamFunnelTemplateAction.mockResolvedValue({ status: "error", message: "安全驗證已失效。" });

    const response = await POST(templateRequest({ operation: "publish", teamId: "team-1" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ status: "error", message: "安全驗證已失效。" });
  });

  it("hides unexpected transport errors behind a safe response", async () => {
    manageTeamFunnelTemplateAction.mockRejectedValue(new Error("synthetic internal detail"));

    const response = await POST(templateRequest({ operation: "create", teamId: "team-1" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ status: "error", message: "操作未完成，請稍後再試一次。" });
  });
});
