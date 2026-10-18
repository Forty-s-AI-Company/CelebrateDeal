import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(), security: vi.fn(), manager: vi.fn(), revalidate: vi.fn(),
  preferenceFind: vi.fn(), preferenceUpdate: vi.fn(), preferenceUpsert: vi.fn(),
  count: vi.fn(), create: vi.fn(), tasks: vi.fn(), transaction: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/csrf", () => ({ assertServerActionOrigin: mocks.origin, assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  userOnboardingPreference: { findUnique: mocks.preferenceFind, upsert: mocks.preferenceUpsert },
  salesProject: { count: mocks.count }, $transaction: mocks.transaction,
}) }));

import { completePersonalizedOnboardingAction, createSalesProjectAction, persistTaskPanelCollapsedAction, controlOnboardingGuideAction } from "./sales-workspace-actions";

function projectForm(flow: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: "合成專案", slug: "synthetic-project", mode: "flagship", primaryFlow: flow, creationPath: "guided", vendorId: "foreign-vendor" })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.manager.mockResolvedValue({ auth: { user: { id: "synthetic-user" } }, vendor: { id: "synthetic-vendor" } });
  mocks.preferenceFind.mockResolvedValue({ questionnaireAnswers: {
    sellingApproach: "consultation", productType: "consulting_service", requiredFeatures: ["booking"], progressStage: "starting",
  } });
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: "synthetic-project" });
  mocks.transaction.mockImplementation(async (callback) => callback({
    userOnboardingPreference: { update: mocks.preferenceUpdate, upsert: mocks.preferenceUpsert },
    salesProject: { count: mocks.count, create: mocks.create },
    onboardingTaskState: { createMany: mocks.tasks },
  }));
});

describe("onboarding action guards", () => {
  it.each(["origin", "manager"] as const)("stops onboarding before writes when %s rejects", async (guard) => {
    mocks[guard].mockRejectedValue(new Error("denied"));
    await expect(completePersonalizedOnboardingAction()).rejects.toThrow("denied");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["security", "manager"] as const)("stops project creation before writes when %s rejects", async (guard) => {
    mocks[guard].mockRejectedValue(new Error("denied"));
    await expect(createSalesProjectAction(projectForm("consultation"))).rejects.toThrow("denied");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects incomplete onboarding without writes", async () => {
    mocks.preferenceFind.mockResolvedValue(null);
    await expect(completePersonalizedOnboardingAction()).rejects.toThrow("redirect:/welcome?error=incomplete");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("task panel preference initialization", () => {
  it("preserves an existing manual preference when completing the questionnaire", async () => {
    await expect(completePersonalizedOnboardingAction()).rejects.toThrow("redirect:/welcome/preparing");
    for (const [call] of mocks.preferenceUpdate.mock.calls) {
      expect(call.data).not.toHaveProperty("taskPanelCollapsed");
    }
  });
  it("defaults a new project preference to collapsed without overwriting saved preferences", async () => {
    await expect(createSalesProjectAction(projectForm("live"))).rejects.toThrow("redirect:/onboarding");
    const call = mocks.preferenceUpsert.mock.calls[0][0];
    expect(call.create.taskPanelCollapsed).toBe(true);
    expect(call.update).not.toHaveProperty("taskPanelCollapsed");
  });
});

describe("explicit task panel choices", () => {
  it.each([true, false])("persists the user's collapsed=%s choice", async (collapsed) => {
    await persistTaskPanelCollapsedAction(collapsed);
    expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ taskPanelCollapsed: collapsed }),
      update: { taskPanelCollapsed: collapsed },
    }));
  });
  it("lets an explicit restart expand the panel even for a newly created preference", async () => {
    await controlOnboardingGuideAction("restart");
    expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ taskPanelCollapsed: false }),
      update: expect.objectContaining({ taskPanelCollapsed: false }),
    }));
  });
});
