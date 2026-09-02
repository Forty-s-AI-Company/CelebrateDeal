import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveInteractionScript: vi.fn() }));

vi.mock("@/app/actions/interaction-actions", () => ({
  saveInteractionScript: mocks.saveInteractionScript,
}));

import { POST } from "./route";

describe("interaction-script native upsert route", () => {
  beforeEach(() => mocks.saveInteractionScript.mockReset());

  it("redirects a successful same-origin form submission with 303", async () => {
    mocks.saveInteractionScript.mockResolvedValue("/interaction-scripts");
    const formData = new FormData();
    formData.set("status", "draft");
    const response = await POST(new Request("http://127.0.0.1:31023/api/interaction-scripts/upsert", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:31023" },
      body: formData,
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31023/interaction-scripts");
    expect(mocks.saveInteractionScript).toHaveBeenCalledWith(formData);
  });

  it("keeps the error destination bounded to the request origin", async () => {
    mocks.saveInteractionScript.mockResolvedValue("/interaction-scripts/new?error=invalid_event");
    const response = await POST(new Request("https://app.example.test/api/interaction-scripts/upsert", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/interaction-scripts/new?error=invalid_event");
  });
});
