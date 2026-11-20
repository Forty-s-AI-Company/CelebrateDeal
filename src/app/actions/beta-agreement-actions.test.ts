import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  record: vi.fn(),
  security: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ synthetic: true }) }));
vi.mock("@/lib/beta-agreement", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/beta-agreement")>(),
  recordBetaAgreementAcceptance: mocks.record,
}));

import { acceptBetaAgreementAction } from "./beta-agreement-actions";
import { BETA_AGREEMENT_VERSION } from "@/lib/beta-agreement-content";

function authFor(role = "owner", overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "user-1", email: "owner@example.test" },
    vendor: { id: "vendor-1", name: "合成商家" },
    member: { id: "member-1", role, status: "active" },
    suspendedVendor: null,
    isPlatformAdmin: false,
    partnerPortalOnly: false,
    ...overrides,
  };
}

function form(values: Record<string, string | undefined> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ vendorId: "vendor-1", agreementVersion: BETA_AGREEMENT_VERSION, acceptBetaAgreement: "on", ...values })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

async function outcome(data: FormData) {
  try {
    await acceptBetaAgreementAction(data);
    return "completed";
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(authFor());
  mocks.record.mockResolvedValue("recorded");
});

describe("acceptBetaAgreementAction", () => {
  it("records the session vendor and account, then returns to a safe path", async () => {
    await expect(outcome(form({ next: "/welcome" }))).resolves.toBe("redirect:/welcome");
    expect(mocks.security).toHaveBeenCalledOnce();
    expect(mocks.record).toHaveBeenCalledWith({ synthetic: true }, { userId: "user-1", vendorId: "vendor-1", vendorName: "合成商家" });
    await expect(outcome(form({ next: "https://evil.example" }))).resolves.toBe("redirect:/dashboard");
  });

  it("is idempotent for the caller: an earlier acceptance also continues", async () => {
    mocks.record.mockResolvedValue("already_recorded");
    await expect(outcome(form())).resolves.toBe("redirect:/dashboard");
  });

  it("refuses a stale or forged version without writing", async () => {
    for (const agreementVersion of ["beta-2026.11.19", "", undefined]) {
      await expect(outcome(form({ agreementVersion, next: "/welcome" }))).resolves.toBe("redirect:/beta-agreement?error=agreement_updated&next=%2Fwelcome");
    }
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("requires the box to be ticked, whatever the page's scroll state", async () => {
    await expect(outcome(form({ acceptBetaAgreement: undefined }))).resolves.toBe("redirect:/beta-agreement?error=consent_required");
    await expect(outcome(form({ acceptBetaAgreement: "yes" }))).resolves.toBe("redirect:/beta-agreement?error=consent_required");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each(["admin", "accountant", "support", "member"])("refuses a %s member without writing", async (role) => {
    mocks.requireAuth.mockResolvedValue(authFor(role));
    await expect(outcome(form())).resolves.toBe("redirect:/beta-agreement?error=owner_required");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses an inactive owner and an owner who lost the role inside the transaction", async () => {
    mocks.requireAuth.mockResolvedValue(authFor("owner", { member: { id: "member-1", role: "owner", status: "inactive" } }));
    await expect(outcome(form())).resolves.toBe("redirect:/beta-agreement?error=owner_required");
    expect(mocks.record).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(authFor());
    mocks.record.mockResolvedValue("not_owner");
    await expect(outcome(form())).resolves.toBe("redirect:/beta-agreement?error=owner_required");
  });

  it("never accepts for a vendor other than the session's, and uses the form's id only as a check", async () => {
    await expect(outcome(form({ vendorId: "vendor-2" }))).resolves.toBe("redirect:/beta-agreement?error=vendor_changed");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("sends suspended, partner-only and platform accounts where they belong", async () => {
    mocks.requireAuth.mockResolvedValue(authFor("owner", { vendor: null, member: null, suspendedVendor: { id: "vendor-1" } }));
    await expect(outcome(form())).resolves.toBe("redirect:/vendor-suspended");
    mocks.requireAuth.mockResolvedValue(authFor("owner", { vendor: null, member: null, partnerPortalOnly: true }));
    await expect(outcome(form())).resolves.toBe("redirect:/affiliate-portal");
    mocks.requireAuth.mockResolvedValue(authFor("owner", { isPlatformAdmin: true }));
    await expect(outcome(form({ next: "/orders" }))).resolves.toBe("redirect:/orders");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("reports a failed write without claiming success", async () => {
    mocks.record.mockRejectedValue(new Error("synthetic database failure"));
    await expect(outcome(form())).resolves.toBe("redirect:/beta-agreement?error=temporarily_unavailable");
  });
});
