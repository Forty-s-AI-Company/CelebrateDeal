import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ affiliate: vi.fn(), live: vi.fn(), form: vi.fn() }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  affiliate: { findFirst: mocks.affiliate },
  live: { findFirst: mocks.live },
  registrationForm: { findFirst: mocks.form },
}) }));

import { GET } from "@/app/r/[code]/route";

describe("stable affiliate referral route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an active code to the latest public live with referral attribution", async () => {
    mocks.affiliate.mockResolvedValue({ vendorId: "vendor-a", code: "A-CODE" });
    mocks.live.mockResolvedValue({ slug: "launch" });
    mocks.form.mockResolvedValue({ slug: "signup" });
    const response = await GET(new Request("https://app.example.test/r/a-code"), { params: Promise.resolve({ code: "a-code" }) });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.test/live/launch?ref=A-CODE");
  });

  it("falls back to an active form and rejects unknown codes", async () => {
    mocks.affiliate.mockResolvedValueOnce({ vendorId: "vendor-a", code: "A-CODE" }).mockResolvedValueOnce(null);
    mocks.live.mockResolvedValue(null);
    mocks.form.mockResolvedValue({ slug: "signup" });
    const redirect = await GET(new Request("https://app.example.test/r/a-code"), { params: Promise.resolve({ code: "a-code" }) });
    expect(redirect.headers.get("location")).toBe("https://app.example.test/form/signup?ref=A-CODE");
    const missing = await GET(new Request("https://app.example.test/r/missing"), { params: Promise.resolve({ code: "missing" }) });
    expect(missing.status).toBe(404);
  });
});
