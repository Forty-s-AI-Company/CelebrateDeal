import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ load: vi.fn(), runtime: vi.fn(), recordVisit: vi.fn() }));
vi.mock("@/lib/landing-page-service", () => ({ loadPublicLandingPage: mocks.load }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "visitor-12345678901234567890" }) })) }));
vi.mock("@/lib/funnel-runtime", () => ({
  FUNNEL_VISITOR_COOKIE: "celebratedeal_funnel_visitor",
  resolveFunnelVisitorId: vi.fn((value) => value),
  resolvePublicFunnelRuntime: mocks.runtime,
  recordPublicFunnelVisit: mocks.recordVisit,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/landing-pages/landing-page-renderer", () => ({ LandingPageRenderer: ({ content }: { content: { data: { root: { props: { title: string } } } } }) => <main>{content.data.root.props.title}</main> }));
vi.mock("@/components/landing-pages/funnel-webinar-experience", () => ({ FunnelWebinarExperience: ({ stepId, resource }: { stepId: string; resource?: unknown }) => <main data-resource={Boolean(resource)}>{stepId}</main> }));
import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import PublicStepPage from "./[stepPath]/page";
import PublicPage, { generateMetadata } from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockImplementation(async ({ pageId, requestedStepId }) => ({
    page: { id: pageId, vendorId: "vendor-1", operations: null },
    decision: { status: "render", requestedStepId, renderedStepId: requestedStepId, experiment: null },
  }));
});
describe("published landing route", () => {
  it("renders only the published snapshot and its SEO metadata", async () => {
    mocks.load.mockResolvedValue({ id: "page1", content: { schemaVersion: 1, data: { root: { props: { title: "已發布標題", description: "活動說明", shareImage: "https://cdn.example.test/share.png" } }, content: [] } }, context: { forms: [] } });
    const params = Promise.resolve({ slug: "webinar" });
    expect(renderToStaticMarkup(await PublicPage({ params }))).toContain("已發布標題");
    expect(await generateMetadata({ params })).toMatchObject({ title: "已發布標題", description: "活動說明", openGraph: { images: ["https://cdn.example.test/share.png"] } });
    expect(mocks.load).toHaveBeenCalledWith("webinar");
  });
  it("does not expose unavailable pages or index their metadata", async () => {
    mocks.load.mockResolvedValue(null);
    const params = Promise.resolve({ slug: "draft" });
    await expect(PublicPage({ params })).rejects.toThrow("NOT_FOUND");
    expect(await generateMetadata({ params })).toMatchObject({ robots: { index: false, follow: false } });
  });
});


it("routes a published Webinar to the registration and broadcast experiences", async () => {
  const content = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
  mocks.load.mockResolvedValue({ id: "page1", slug: "webinar", content, context: { forms: [] } });
  expect(renderToStaticMarkup(await PublicPage({ params: Promise.resolve({ slug: "webinar" }) }))).toContain("webinar_registration");
  expect(renderToStaticMarkup(await PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: "broadcast" }) }))).toContain("webinar_broadcast");
  await expect(PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: "foreign" }) })).rejects.toThrow("NOT_FOUND");
});
