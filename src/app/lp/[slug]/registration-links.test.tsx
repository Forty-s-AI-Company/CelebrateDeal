import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ load: vi.fn(), runtime: vi.fn(), recordVisit: vi.fn(), readDraft: vi.fn(), verifyResult: vi.fn() }));
vi.mock("@/lib/registration-form-retry", async (original) => ({ ...await original<typeof import("@/lib/registration-form-retry")>(), readRegistrationRetryDraft: mocks.readDraft }));
vi.mock("@/lib/registration-submission-receipt", async (original) => ({ ...await original<typeof import("@/lib/registration-submission-receipt")>(), verifyRegistrationResult: mocks.verifyResult }));
vi.mock("@/lib/landing-page-service", () => ({ loadPublicLandingPage: mocks.load }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "app.example.test" })), cookies: vi.fn(async () => ({ get: () => ({ value: "visitor-12345678901234567890" }) })) }));
vi.mock("@/lib/funnel-runtime", () => ({
  FUNNEL_VISITOR_COOKIE: "celebratedeal_funnel_visitor",
  resolveFunnelVisitorId: vi.fn((value) => value),
  resolvePublicFunnelRuntime: mocks.runtime,
  recordPublicFunnelVisit: mocks.recordVisit,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import { createFunnelFlow } from "@/lib/funnel-flow";
import type { FunnelNode } from "@/lib/funnel-page-document";
import { createFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import PublicStepPage from "./[stepPath]/page";
import PublicPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockImplementation(async ({ pageId, requestedStepId }) => ({
    page: { id: pageId, vendorId: "vendor-1", operations: null },
    decision: { status: "render", requestedStepId, renderedStepId: requestedStepId, experiment: null },
  }));
});

const context = { pageId: "page1", forms: [{ id: "form-1", slug: "signup", name: "報名表" }], live: { id: "live-1", slug: "autumn", title: "秋季直播", status: "scheduled" as const, formId: "form-1", scheduledAt: "2030-01-01T00:00:00.000Z" } };

/** Puts a registration button on one step's page. */
function withRegistrationButton(steps: FunnelStepPages, stepId: string): FunnelStepPages {
  const button: FunnelNode = { schemaVersion: 1, id: "register_cta", type: "button", props: { label: "前往報名" }, style: {}, overrides: {}, visible: true, actions: [{ type: "registration", formId: "form-1", useBoundLive: true }], attributes: {} };
  const row: FunnelNode = { schemaVersion: 1, id: "register_row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [button] };
  const section: FunnelNode = { schemaVersion: 1, id: "register_section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [row] };
  const page = steps.pages[stepId]!;
  return { ...steps, pages: { ...steps.pages, [stepId]: { ...page, root: [...page.root, section] } } };
}

const registrationLink = /<a [^>]*href="\/form\/signup\?liveId=live-1&amp;lp=page1"[^>]*>前往報名<\/a>/u;

describe("registration buttons on every public funnel surface", () => {
  it("resolves on a non-root step of a multi-step funnel", async () => {
    const base = createFunnelStepPages(createFunnelFlow({ id: "audience", name: "名單", goal: "audience", domain: "audience" })!)!;
    const step = base.flow.steps.filter((candidate) => !candidate.isSystem)[1]!;
    mocks.load.mockResolvedValue({ id: "page1", slug: "audience", content: withRegistrationButton(base, step.id), context });
    const html = renderToStaticMarkup(await PublicStepPage({ params: Promise.resolve({ slug: "audience", stepPath: step.path }) }));
    expect(html).toMatch(registrationLink);
    expect(html).not.toContain("disabled");
  });

  it("resolves on the webinar registration page, at the root and as a step", async () => {
    const base = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
    const registration = base.flow.steps.find((candidate) => candidate.type === "webinar_registration_page")!;
    mocks.load.mockResolvedValue({ id: "page1", slug: "webinar", content: withRegistrationButton(base, registration.id), context });
    expect(renderToStaticMarkup(await PublicPage({ params: Promise.resolve({ slug: "webinar" }) }))).toMatch(registrationLink);
    expect(renderToStaticMarkup(await PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: registration.path }) }))).toMatch(registrationLink);
  });

  it("resolves in the editor's webinar preview, which inherits the workspace links", () => {
    const base = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
    const registration = base.flow.steps.find((candidate) => candidate.type === "webinar_registration_page")!;
    const html = renderToStaticMarkup(<FunnelRegistrationLinkProvider value={{ forms: context.forms, live: context.live }}><FunnelWebinarExperience state={withRegistrationButton(base, registration.id)} stepId={registration.id} slug="webinar" preview /></FunnelRegistrationLinkProvider>);
    expect(html).toMatch(/<a [^>]*href="\/form\/signup\?liveId=live-1"[^>]*>前往報名<\/a>/u);
  });
});
