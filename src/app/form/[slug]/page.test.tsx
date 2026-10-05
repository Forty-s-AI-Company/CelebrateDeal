import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicRegistrationForm: vi.fn(),
  findForm: vi.fn(),
  findSessions: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findFirst: mocks.findForm }, live: { findMany: mocks.findSessions } }) }));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/public-registration-form", () => ({ getPublicRegistrationForm: mocks.getPublicRegistrationForm }));
vi.mock("next/image", () => ({ default: ({ alt, ...props }: { alt: string } & Record<string, unknown>) => <span role="img" aria-label={alt} {...props} /> }));
vi.mock("@/components/promo-video-player", () => ({ PromoVideoPlayer: ({ title }: { title: string }) => <div data-testid="promo-video">{title}</div> }));
vi.mock("@/components/lead-form", () => ({
  FORM_SUBMISSION_VERIFICATION_MESSAGE: "請到 Email 開啟確認連結；完成確認後才會列入正式名單。",
  LeadForm: ({ fields, sessions, successMessage }: { fields: Array<{ key: string }>; sessions: Array<{ id: string }>; successMessage: string }) => (
    <div data-testid="lead-form" data-sessions={sessions.map((session) => session.id).join(",")}>{`${fields.map((field) => field.key).join(",")}|${successMessage}`}</div>
  ),
}));

import PublicFormPage, { generateMetadata, generateViewport } from "./page";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

const publicForm = {
  id: "form-1",
  slug: "summer",
  headline: "立即報名",
  description: "活動說明",
  submitLabel: "送出",
  successMessage: "完成",
  fields: validFields,
  heroImageUrl: "https://cdn.example.test/hero.jpg",
  backgroundImageUrl: "https://cdn.example.test/background.jpg",
  themeColor: "#123456",
  stickyText: "名額有限",
  bodyContent: "活動內容\n第二段",
  notice: "請提前入場",
  seoTitle: "夏季活動報名",
  seoDescription: "夏季活動說明",
  promoVideo: { title: "活動預告", videoUrl: "https://cdn.example.test/promo.mp4" },
  vendor: { name: "測試商家" },
  sessions: [{ id: "live-1", title: "第一場", description: null, scheduledAt: "2026-08-20T01:00:00.000Z", status: "scheduled" as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPublicRegistrationForm.mockResolvedValue(publicForm);
});

describe("public registration form", () => {
  it("honors a selected session without mutating the shared form result", async () => {
    const form = { ...publicForm, sessions: [...publicForm.sessions, { ...publicForm.sessions[0]!, id: "live-2" }] };
    mocks.getPublicRegistrationForm.mockResolvedValue(form);
    const html = renderToStaticMarkup(await PublicFormPage({ params: Promise.resolve({ slug: "summer" }), searchParams: Promise.resolve({ liveId: "live-2" }) }));
    expect(html).toContain('data-sessions="live-2"');
    expect(form.sessions).toHaveLength(2);
    await expect(PublicFormPage({ params: Promise.resolve({ slug: "summer" }), searchParams: Promise.resolve({ liveId: "foreign-live" }) })).rejects.toThrow("NOT_FOUND");
  });
  it("renders stored presentation settings, safe media, promo and public sessions", async () => {
    const html = renderToStaticMarkup(await PublicFormPage({
      params: Promise.resolve({ slug: "summer" }),
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.getPublicRegistrationForm).toHaveBeenCalledWith("summer");
    expect(html).toContain("立即報名");
    expect(html).toContain("活動內容");
    expect(html).toContain("名額有限");
    expect(html).toContain("活動預告");
    expect(html).toContain("live-1");
    expect(html).toContain("#123456");
  });

  it("renders constrained rich text without injecting authored HTML", async () => {
    mocks.getPublicRegistrationForm.mockResolvedValue({
      ...publicForm,
      bodyContent: "## 課程重點\n\n**立即** [查看課程](https://example.test/course)\n\n<script>不執行</script>",
    });
    const html = renderToStaticMarkup(await PublicFormPage({
      params: Promise.resolve({ slug: "summer" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("課程重點");
    expect(html).toContain("<strong>立即</strong>");
    expect(html).toContain('href="https://example.test/course"');
    expect(html).toContain("&lt;script&gt;不執行&lt;/script&gt;");
    expect(html).not.toContain("<script>不執行</script>");
  });

  it("renders both the custom success copy and fixed verification gate", async () => {
    const html = renderToStaticMarkup(await PublicFormPage({
      params: Promise.resolve({ slug: "summer" }),
      searchParams: Promise.resolve({ submitted: "verification_required" }),
    }));

    expect(html).toContain("完成");
    expect(html).toContain("請到 Email 開啟確認連結");
    expect(html).not.toContain('data-testid="lead-form"');
  });

  it("fails closed when registration fields are invalid", async () => {
    mocks.getPublicRegistrationForm.mockResolvedValue({ ...publicForm, fields: null });
    const html = renderToStaticMarkup(await PublicFormPage({
      params: Promise.resolve({ slug: "legacy" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("暫停接收資料");
    expect(html).not.toContain('data-testid="lead-form"');
  });

  it("returns noindex metadata and no theme for missing or inactive forms", async () => {
    mocks.getPublicRegistrationForm.mockResolvedValue(null);
    await expect(PublicFormPage({ params: Promise.resolve({ slug: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();

    await expect(generateMetadata({ params: Promise.resolve({ slug: "missing" }) })).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
    await expect(generateViewport({ params: Promise.resolve({ slug: "missing" }) })).resolves.toEqual({});
  });

  it("uses the validated SEO and theme values for metadata", async () => {
    await expect(generateMetadata({ params: Promise.resolve({ slug: "summer" }) })).resolves.toMatchObject({
      title: "夏季活動報名",
      description: "夏季活動說明",
      openGraph: { images: ["https://cdn.example.test/hero.jpg"] },
      robots: { index: true, follow: true },
    });
    await expect(generateViewport({ params: Promise.resolve({ slug: "summer" }) })).resolves.toEqual({ themeColor: "#123456" });
  });
});

// Exercise the real loader together with every public projection, not only a null stub.
it.each([
  { vendorId: "vendor-1", status: "draft", publishedAt: null },
  { vendorId: "vendor-1", status: "archived", publishedAt: new Date() },
  { vendorId: "vendor-other", status: "published", publishedAt: new Date() },
])("hides unpublished or foreign project data from page, SEO and viewport: %j", async (salesProject) => {
  const { loadPublicRegistrationForm } = await vi.importActual<typeof import("@/lib/public-registration-form")>("@/lib/public-registration-form");
  mocks.findForm.mockResolvedValue({ ...publicForm, vendorId: "vendor-1", projectId: "project-1", salesProject });
  mocks.getPublicRegistrationForm.mockImplementation(loadPublicRegistrationForm);
  const params = Promise.resolve({ slug: "summer" });
  await expect(PublicFormPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  const metadata = await generateMetadata({ params });
  expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
  expect(JSON.stringify(metadata)).not.toContain(publicForm.seoTitle);
  expect(JSON.stringify(metadata)).not.toContain(publicForm.heroImageUrl);
  expect(await generateViewport({ params })).toEqual({});
  expect(mocks.findSessions).not.toHaveBeenCalled();
});
