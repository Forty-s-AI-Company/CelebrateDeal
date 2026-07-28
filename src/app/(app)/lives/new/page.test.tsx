import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  getCsrfToken: vi.fn(),
  videoFindMany: vi.fn(),
  productFindMany: vi.fn(),
  registrationFormFindMany: vi.fn(),
  messageTemplateFindMany: vi.fn(),
  interactionScriptFindMany: vi.fn(),
  affiliateFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireVendorManager: mocks.requireVendorManager,
}));
vi.mock("@/lib/csrf", () => ({
  getCsrfToken: mocks.getCsrfToken,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    video: { findMany: mocks.videoFindMany },
    product: { findMany: mocks.productFindMany },
    registrationForm: { findMany: mocks.registrationFormFindMany },
    messageTemplate: { findMany: mocks.messageTemplateFindMany },
    interactionScript: { findMany: mocks.interactionScriptFindMany },
    affiliate: { findMany: mocks.affiliateFindMany },
  }),
}));
vi.mock("@/components/live-stepper-form", () => ({
  LiveStepperForm: () => null,
}));

import NewLivePage from "./page";

describe("NewLivePage data minimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
    mocks.getCsrfToken.mockResolvedValue("csrf-token");
    for (const mock of [
      mocks.videoFindMany,
      mocks.productFindMany,
      mocks.registrationFormFindMany,
      mocks.messageTemplateFindMany,
      mocks.interactionScriptFindMany,
      mocks.affiliateFindMany,
    ]) {
      mock.mockResolvedValue([]);
    }
  });

  it("only serializes the video identifier and title into the client form", async () => {
    await NewLivePage({ searchParams: Promise.resolve({}) });

    expect(mocks.videoFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { vendorId: "vendor-1" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
  });
});
