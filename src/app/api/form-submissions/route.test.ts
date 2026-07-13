import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  registrationForm: { findUnique: vi.fn() },
  blacklist: { findFirst: vi.fn() },
  formSubmission: { create: vi.fn() },
  analyticsEvent: { create: vi.fn() },
  affiliateClick: { updateMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/form-submissions/route";

function nativeFormRequest(redirectTo: string) {
  const body = new URLSearchParams({
    formId: "form-1",
    name: "Test User",
    email: "test@example.test",
    redirectTo,
  });
  return new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.registrationForm.findUnique.mockResolvedValue({ id: "form-1", vendorId: "vendor-1", isActive: true });
  db.blacklist.findFirst.mockResolvedValue(null);
  db.formSubmission.create.mockResolvedValue({ id: "submission-1" });
  db.analyticsEvent.create.mockResolvedValue({ id: "event-1" });
  db.affiliateClick.updateMany.mockResolvedValue({ count: 0 });
});

describe("native form submission redirects", () => {
  it("keeps a root-relative redirect on the request origin", async () => {
    const response = await POST(nativeFormRequest("/forms/summer?source=landing"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/forms/summer?source=landing&submitted=1",
    );
  });

  it.each(["//attacker.example.test/collect", "/\\attacker.example.test/collect"])(
    "does not redirect a cross-origin relative-looking value (%s)",
    async (redirectTo) => {
      const response = await POST(nativeFormRequest(redirectTo));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      await expect(response.json()).resolves.toEqual({ ok: true });
    },
  );
});
