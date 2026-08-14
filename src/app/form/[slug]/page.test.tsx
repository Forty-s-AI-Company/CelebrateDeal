import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicRegistrationForm: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

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
