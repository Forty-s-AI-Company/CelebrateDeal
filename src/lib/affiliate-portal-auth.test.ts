import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  affiliateFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: mocks.authenticateUser,
  getCurrentAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ affiliate: { findFirst: mocks.affiliateFindFirst } }),
}));

import { authenticateAffiliatePortal } from "@/lib/affiliate-portal-auth";

describe("affiliate portal authentication", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the password owner to be explicitly bound to the active affiliate code", async () => {
    mocks.authenticateUser.mockResolvedValue({ user: { id: "user-a" } });
    mocks.affiliateFindFirst.mockResolvedValue({ id: "affiliate-a", vendorId: "vendor-a", code: "A-CODE" });

    await expect(authenticateAffiliatePortal(" A@EXAMPLE.TEST ", "password", "a-code")).resolves.toEqual({
      user: { id: "user-a" },
      affiliate: { id: "affiliate-a", vendorId: "vendor-a", code: "A-CODE" },
    });
    expect(mocks.authenticateUser).toHaveBeenCalledWith("a@example.test", "password");
    expect(mocks.affiliateFindFirst).toHaveBeenCalledWith({
      where: { userId: "user-a", code: "A-CODE", isActive: true },
      select: { id: true, vendorId: true, name: true, code: true },
    });
  });

  it("does not query affiliate data after invalid credentials", async () => {
    mocks.authenticateUser.mockResolvedValue(null);
    await expect(authenticateAffiliatePortal("x@example.test", "bad", "X")).resolves.toBeNull();
    expect(mocks.affiliateFindFirst).not.toHaveBeenCalled();
  });
});

