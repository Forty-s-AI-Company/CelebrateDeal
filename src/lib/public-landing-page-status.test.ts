import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("tests inject the database"); } }));

import { defaultFunnelOperations } from "./funnel-operations";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";
import { assignFunnelExperiment } from "./funnel-runtime";
import { publicFunnelRouteOutcome, publicFunnelRouteStatus, publicLandingPageStatus, representativeFunnelVisitorIds } from "./public-landing-page-status";

const visitor = "synthetic-visitor-1234567890";
const funnel = (goal: "audience" | "webinar" = "audience") => createFunnelStepPages(createFunnelFlow({ id: "fixture", name: "合成", goal, domain: "fixture" })!)!;
const publicSteps = (content: ReturnType<typeof funnel>) => content.flow.steps.filter((step) => !step.isSystem);
const expired = (behavior: "closed" | "redirect", redirectPath = "") => ({ ...defaultFunnelOperations(), deadline: { enabled: true, timezone: "Asia/Taipei", expiresAt: "2020-01-01T00:00:00+08:00", behavior, redirectPath } });

const findMany = vi.fn();
const database = { landingPage: { findMany } } as never;

beforeEach(() => {
  vi.resetAllMocks();
  findMany.mockResolvedValue([{ id: "page-1" }]);
});

describe("public pre-stream status (content-free, F-015)", () => {
  it.each(["/lp/", "/lp/a/b/c", "/lp/%zz", "/lp/a/%zz", "/other/a", "/lp/not%20a%20slug"])("rejects malformed path %s before a database read", async (path) => {
    expect(await publicLandingPageStatus(path, database)).toBe(404);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("selects only slug -> id under both publication layers: no content, version or live rows are returned", async () => {
    expect(await publicLandingPageStatus("/lp/Fall-Launch", database)).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        slug: "fall-launch", status: "published", publishedVersionId: { not: null }, archivedAt: null,
        // Owner decision 2026-10-24: a lead-only audience Funnel of a project
        // that is not archived opens without a published project.
        OR: [
          { project: { is: { status: "published", publishedAt: { not: null } } } },
          {
            project: { is: { status: { not: "archived" } } },
            publishedVersion: { is: {
              content: { path: ["flow", "goal"], equals: "audience" },
              NOT: ["sales_page", "order_form", "upsell", "downsell", "thank_you_page", "webinar_registration_page", "webinar_thank_you_page", "webinar_broadcast_page"]
                .map((type) => ({ content: { path: ["flow", "steps"], array_contains: [{ type }] } })),
            } },
          },
        ],
      },
      take: 2,
      select: { id: true },
    });
  });

  it("returns 404 for an unknown, unpublished, archived or project-unpublished slug and for an ambiguous slug", async () => {
    findMany.mockResolvedValueOnce([]);
    expect(await publicLandingPageStatus("/lp/example", database)).toBe(404);
    findMany.mockResolvedValueOnce([{ id: "page-1" }, { id: "page-2" }]);
    expect(await publicLandingPageStatus("/lp/example", database)).toBe(404);
  });

  it("leaves step paths and every content or binding decision to the page", async () => {
    // The page answers these with notFound() before streaming, which is a real
    // HTTP 404 (reports/review-2026Q4/F-015-lp-load.md,
    // tests/e2e/public-url-availability.spec.ts).
    expect(await publicLandingPageStatus("/lp/example/any-step", database)).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("propagates an infrastructure failure for a distinct 503 response", async () => {
    findMany.mockRejectedValue(new Error("synthetic-read-failure"));
    await expect(publicLandingPageStatus("/lp/example", database)).rejects.toThrow("synthetic-read-failure");
  });
});

describe("public Funnel route decision", () => {
  it("requires a valid visitor identifier like the runtime", () => {
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: funnel(), operations: null, visitorId: "short" })).toBe(404);
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: funnel(), operations: null, visitorId: visitor })).toBe(200);
  });

  it("returns 404 when the first public step has no page document", () => {
    const content = funnel();
    const first = content.flow.steps.find((step) => !step.isSystem)!;
    const pages = { ...content.pages };
    delete pages[first.id];
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: { ...content, pages }, operations: null, visitorId: visitor })).toBe(404);
  });
});

describe("false-404-prone runtime branches", () => {
  function experiment(content: ReturnType<typeof funnel>) {
    const [control, variant] = publicSteps(content);
    return { ...defaultFunnelOperations(), experiment: { id: "exp-1", status: "running", controlStepId: control!.id, variantStepId: variant!.id, controlWeight: 50, variantWeight: 50, winner: null } };
  }

  it("renders the A/B arm each visitor is assigned and 404s only the arm that cannot render", () => {
    const content = funnel();
    const operations = experiment(content);
    const visitors = representativeFunnelVisitorIds("page-1", operations);
    expect(visitors).toHaveLength(2);
    expect(representativeFunnelVisitorIds("page-1", operations)).toEqual(visitors);
    const arms = visitors.map((visitorId) => assignFunnelExperiment("page-1", operations.experiment as never, visitorId)?.arm);
    expect(arms.sort()).toEqual(["control", "variant"]);
    for (const visitorId of visitors) expect(publicFunnelRouteStatus({ pageId: "page-1", content, operations, visitorId })).toBe(200);

    // Same experiment identity and weights, but the variant points at the system step.
    const system = content.flow.steps.find((step) => step.isSystem)!;
    const broken = { ...operations, experiment: { ...operations.experiment, variantStepId: system.id } };
    const byArm = Object.fromEntries(visitors.map((visitorId) => [assignFunnelExperiment("page-1", broken.experiment as never, visitorId)?.arm, publicFunnelRouteStatus({ pageId: "page-1", content, operations: broken, visitorId })]));
    expect(byArm).toEqual({ control: 200, variant: 404 });
  });

  it("uses a single deterministic visitor when no experiment is running", () => {
    expect(representativeFunnelVisitorIds("page-1", null)).toEqual(["diagnosis-visitor-000000"]);
  });

  it("keeps a post-deadline redirect at 200 and names its target", () => {
    const content = funnel();
    const target = publicSteps(content)[1]!;
    const operations = expired("redirect", target.path);
    expect(publicFunnelRouteOutcome({ pageId: "page-1", content, operations, visitorId: visitor })).toEqual({ status: 200, redirectPath: target.path });
  });

  it("serves the deadline redirect target step itself with 200", () => {
    const content = funnel();
    const target = publicSteps(content)[1]!;
    const operations = expired("redirect", target.path);
    expect(publicFunnelRouteOutcome({ pageId: "page-1", content, operations, stepPath: target.path, visitorId: visitor })).toEqual({ status: 200 });
  });

  it("keeps a webinar root at 200 because the webinar experience renders without a step document", () => {
    const content = funnel("webinar");
    expect(content.flow.goal).toBe("webinar");
    const first = publicSteps(content)[0]!;
    const pages = { ...content.pages };
    delete pages[first.id];
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: { ...content, pages }, operations: null, visitorId: visitor })).toBe(200);
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: { ...content, pages }, operations: null, stepPath: first.path, visitorId: visitor })).toBe(404);
  });

  it("keeps a closed deadline at 200 on a step path as well", () => {
    const content = funnel();
    expect(publicFunnelRouteStatus({ pageId: "page-1", content, operations: expired("closed"), stepPath: publicSteps(content)[1]!.path, visitorId: visitor })).toBe(200);
  });
});
