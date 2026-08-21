import { beforeEach, describe, expect, it, vi } from "vitest";

const { savePartnerPageAction, setPartnerPagePublishAction } = vi.hoisted(() => ({
  savePartnerPageAction: vi.fn(),
  setPartnerPagePublishAction: vi.fn(),
}));

vi.mock("@/app/actions/team-funnel-partner-actions", () => ({
  savePartnerPageAction,
  setPartnerPagePublishAction,
}));

import { POST } from "@/app/api/team-funnel/partner-page-actions/route";

function partnerRequest(entries: Record<string, string>) {
  const formData = new FormData();
  Object.entries(entries).forEach(([key, value]) => formData.set(key, value));
  return new Request("https://app.example.test/api/team-funnel/partner-page-actions", {
    method: "POST",
    headers: { origin: "https://app.example.test" },
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team-funnel/partner-page-actions", () => {
  it("dispatches save operations to the existing save action", async () => {
    savePartnerPageAction.mockResolvedValue({ status: "success", message: "夥伴頁已儲存。" });

    const response = await POST(partnerRequest({ operation: "save", teamId: "team-1", pageId: "page-1" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ status: "success", message: "夥伴頁已儲存。" });
    expect(savePartnerPageAction).toHaveBeenCalledOnce();
    expect(setPartnerPagePublishAction).not.toHaveBeenCalled();
  });

  it("dispatches publish operations to the existing publish action", async () => {
    setPartnerPagePublishAction.mockResolvedValue({ status: "success", message: "夥伴頁已發布。" });

    const response = await POST(partnerRequest({ operation: "publish", teamId: "team-1", pageId: "page-1", publish: "true" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "success", message: "夥伴頁已發布。" });
    expect(setPartnerPagePublishAction).toHaveBeenCalledOnce();
    expect(savePartnerPageAction).not.toHaveBeenCalled();
  });

  it("rejects an unknown operation without calling a write action", async () => {
    const response = await POST(partnerRequest({ operation: "delete", teamId: "team-1", pageId: "page-1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "error", message: "不支援的夥伴頁操作。" });
    expect(savePartnerPageAction).not.toHaveBeenCalled();
    expect(setPartnerPagePublishAction).not.toHaveBeenCalled();
  });

  it("hides unexpected action errors behind a safe response", async () => {
    savePartnerPageAction.mockRejectedValue(new Error("synthetic internal detail"));

    const response = await POST(partnerRequest({ operation: "save", teamId: "team-1", pageId: "page-1" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ status: "error", message: "操作未完成，請稍後再試一次。" });
  });
});
