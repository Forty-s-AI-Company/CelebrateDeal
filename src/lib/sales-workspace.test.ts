import { describe, expect, it } from "vitest";
import {
  ProjectScopeError,
  assertProjectBelongsToVendor,
  canPublishSalesProject,
  evaluateProjectOnboarding,
  evaluateWorkspaceOnboarding,
  parseSalesWorkspaceQuestionnaire,
  projectOnboardingTasks,
  recommendSalesWorkspaceMode,
} from "./sales-workspace";

describe("sales workspace recommendation", () => {
  it("recommends a live course, consultation, or flagship mode from the questionnaire", () => {
    expect(recommendSalesWorkspaceMode({ sellingApproach: "live" })).toBe("live_course");
    expect(recommendSalesWorkspaceMode({ sellingApproach: "consultation" })).toBe("consulting");
    expect(recommendSalesWorkspaceMode({ sellingApproach: "both" })).toBe("flagship");
    expect(recommendSalesWorkspaceMode({ sellingApproach: "unsure", requiredFeatures: ["booking"] })).toBe("consulting");
  });

  it("accepts only the four-question contract and removes duplicate selected features", () => {
    expect(parseSalesWorkspaceQuestionnaire({ requiredFeatures: ["booking", "booking"] }).requiredFeatures).toEqual(["booking"]);
    expect(() => parseSalesWorkspaceQuestionnaire({ unknown: true })).toThrow();
  });
});

describe("onboarding task evaluator", () => {
  const workspaceSignals = {
    hasBasicProfile: true, hasLogo: false, hasPaymentMethod: false,
    hasSupportContact: true, hasInvitedTeamMember: false, hasTestOrder: false,
  };

  it("uses real signals for completion and preserves a skipped payment impact", () => {
    const progress = evaluateWorkspaceOnboarding(workspaceSignals, [
      { taskKey: "workspace_payment", status: "skipped" },
      // A stale manual completed value must not manufacture a test order.
      { taskKey: "workspace_test_order", status: "completed" },
    ]);
    expect(progress.completedCount).toBe(2);
    expect(progress.tasks.find((task) => task.key === "workspace_payment")).toMatchObject({
      status: "skipped", impact: "已略過付款設定，目前無法接受線上付款。",
    });
    expect(progress.tasks.find((task) => task.key === "workspace_test_order")?.status).toBe("not_started");
    expect(progress.isComplete).toBe(false);
  });

  it("does not report skipped tasks as completed setup", () => {
    const progress = evaluateWorkspaceOnboarding(
      { ...workspaceSignals, hasBasicProfile: false, hasSupportContact: false },
      [
        { taskKey: "workspace_profile", status: "skipped" },
        { taskKey: "workspace_logo", status: "skipped" },
        { taskKey: "workspace_payment", status: "skipped" },
        { taskKey: "workspace_support", status: "skipped" },
        { taskKey: "workspace_team", status: "skipped" },
        { taskKey: "workspace_test_order", status: "skipped" },
      ],
    );
    expect(progress.completedCount).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it("selects one progressive project flow instead of showing flagship tasks at once", () => {
    const live = projectOnboardingTasks("live");
    const consulting = projectOnboardingTasks("consultation");
    expect(live.some((task) => task.key === "project_live")).toBe(true);
    expect(live.some((task) => task.key === "project_consultation")).toBe(false);
    expect(consulting.some((task) => task.key === "project_consultation")).toBe(true);
    expect(consulting.some((task) => task.key === "project_live")).toBe(false);
  });

  it("marks a project as complete only after its source-of-truth publish signal", () => {
    const progress = evaluateProjectOnboarding("live", {
      exists: true, hasLinkedProduct: true, hasPricedProduct: true, hasFunnelTemplate: true,
      hasLiveSession: true, hasConsultationService: false, hasAvailability: false,
      hasPaymentMethod: true, hasPreviewableFlow: true, isPublished: false,
    });
    expect(progress.isComplete).toBe(false);
    expect(progress.nextTask?.key).toBe("project_publish");
  });
});

describe("tenant project scope", () => {
  it("rejects a cross-workspace project before an action can persist it", () => {
    expect(() => assertProjectBelongsToVendor({ id: "project-2", vendorId: "vendor-2" }, "vendor-1")).toThrow(ProjectScopeError);
    expect(assertProjectBelongsToVendor({ id: "project-1", vendorId: "vendor-1" }, "vendor-1").id).toBe("project-1");
  });
});

describe("sales project publish gate", () => {
  const ready = {
    exists: true, hasLinkedProduct: true, hasPricedProduct: true, hasFunnelTemplate: true,
    hasLiveSession: true, hasConsultationService: false, hasAvailability: false,
    hasPaymentMethod: true, hasPreviewableFlow: true, isPublished: false,
  };

  it("requires a real flow and payment before publishing", () => {
    expect(canPublishSalesProject("live", ready)).toBe(true);
    expect(canPublishSalesProject("live", { ...ready, hasPaymentMethod: false })).toBe(false);
    expect(canPublishSalesProject("consultation", { ...ready, hasLiveSession: false, hasConsultationService: true, hasAvailability: true })).toBe(true);
    expect(canPublishSalesProject("consultation", { ...ready, hasLiveSession: false, hasConsultationService: true })).toBe(false);
  });
});
