// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), findFirst: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/app/actions/course-curriculum-actions", () => ({
  deleteCourseChapterAction: vi.fn(), moveCourseChapterAction: vi.fn(), moveCourseLessonAction: vi.fn(),
  renameCourseChapterAction: vi.fn(), saveCourseLessonAction: vi.fn(),
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="t" /> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findFirst: mocks.findFirst } }) }));
vi.mock("@/lib/feature-gates", () => ({ requireFeatureOrNotFound: vi.fn() }));

import CourseLessonsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.findFirst.mockResolvedValue({
    id: "p1", name: "課程", revision: 3,
    courseChapters: [{ id: "c1", title: "第一章" }],
    courseLessons: [{ id: "l1", position: 0, chapterId: "c1", chapterTitle: "第一章", title: "開場", videoUrl: "https://v.example.test/1", durationSeconds: 90, publishedAt: new Date(0) }],
  });
});

async function html() {
  return renderToStaticMarkup(await CourseLessonsPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));
}

describe("/products/[id]/lessons 單元表單", () => {
  it("只查目前 vendor 的課程", async () => {
    await html();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", vendorId: "vendor-1", fulfillmentType: "course" } }));
  });

  it("單元欄位以 label 包住控制項，且保留 name、限制與預設值", async () => {
    const doc = new DOMParser().parseFromString(await html(), "text/html");
    const lessonForm = Array.from(doc.querySelectorAll("form")).find((f) => f.querySelector('input[name="lessonId"]'))!;
    const get = (label: string) => Array.from(lessonForm.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
    const chapter = get("章節");
    expect([chapter.name, chapter.required, chapter.maxLength, chapter.value]).toEqual(["chapterTitle", true, 120, "第一章"]);
    const title = get("單元名稱");
    expect([title.name, title.required, title.maxLength, title.value]).toEqual(["title", true, 180, "開場"]);
    const url = get("影片網址");
    expect([url.name, url.type, url.required, url.maxLength, url.placeholder, url.value]).toEqual(["videoUrl", "url", false, 2048, "https://", "https://v.example.test/1"]);
    const secs = get("影片秒數");
    expect([secs.name, secs.type, secs.required, secs.min, secs.max, secs.step, secs.value]).toEqual(["durationSeconds", "number", true, "0", "86400", "1", "90"]);
  });
});
