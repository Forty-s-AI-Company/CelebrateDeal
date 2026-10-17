import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manager: vi.fn(), context: vi.fn(), scope: vi.fn(), csrf: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager, requireVendorManagerContext: mocks.context }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.scope }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "formNonce", getCsrfToken: mocks.csrf }));
vi.mock("@/components/landing-pages/funnel-goal-picker", () => ({
  FunnelGoalPicker: ({ initialGoal }: { initialGoal?: string }) => <div data-picker>{initialGoal}</div>,
}));

import NewLandingPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ auth: { user: { id: "synthetic-user" } }, vendor: { id: "synthetic-vendor" } });
  mocks.csrf.mockResolvedValue("synthetic-form-nonce");
});

describe("new landing page project recovery", () => {
  it.each([false, true])("offers both recovery paths without a selected project (aggregate=%s)", async (isAggregate) => {
    mocks.scope.mockResolvedValue({ projectId: null, isAggregate });
    const html = renderToStaticMarkup(await NewLandingPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain('href="/projects"');
    expect(html).toContain("建立專案");
    expect(html).toContain("選擇既有專案");
    expect(html).not.toContain("data-picker");
    expect(mocks.csrf).not.toHaveBeenCalled();
  });

  it("keeps the picker and query choice for a selected project", async () => {
    mocks.scope.mockResolvedValue({ projectId: "synthetic-project" });
    const html = renderToStaticMarkup(await NewLandingPage({ searchParams: Promise.resolve({ goal: "webinar" }) }));
    expect(html).toContain("data-picker");
    expect(html).toContain("webinar");
    expect(html).not.toContain("尚未選擇專案");
  });

  it("does not show recovery actions before the existing manager guard passes", async () => {
    mocks.manager.mockRejectedValue(new Error("denied"));
    await expect(NewLandingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("denied");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
  });
});
