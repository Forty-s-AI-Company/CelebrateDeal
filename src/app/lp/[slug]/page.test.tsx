import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/landing-page-service", () => ({ loadPublicLandingPage: mocks.load }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/landing-pages/landing-page-renderer", () => ({ LandingPageRenderer: ({ content }: { content: { data: { root: { props: { title: string } } } } }) => <main>{content.data.root.props.title}</main> }));
import PublicPage, { generateMetadata } from "./page";
beforeEach(() => vi.clearAllMocks());
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
