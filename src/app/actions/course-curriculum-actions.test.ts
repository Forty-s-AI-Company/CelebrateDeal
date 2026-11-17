import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  security: vi.fn(async () => undefined),
  manager: vi.fn(async () => ({ id: "vendor-1", slug: "academy", enabledFeatureModules: [] as string[], betaFeatureGrants: ["courses"] })),
  rename: vi.fn(async () => "chapter-1"),
  moveChapter: vi.fn(async () => true),
  deleteChapter: vi.fn(async () => "chapter-1"),
  moveLesson: vi.fn(async () => true),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("@/lib/course-chapter-manage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/course-chapter-manage")>(),
  moveCourseChapter: mocks.moveChapter,
  deleteCourseChapter: mocks.deleteChapter,
  moveCourseLesson: mocks.moveLesson,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ synthetic: true }) }));
vi.mock("@/lib/course-curriculum", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/course-curriculum")>(),
  renameCourseChapter: mocks.rename,
}));

const { ChapterTitleTaken, CurriculumConflict } = await import("@/lib/course-curriculum");
const { ChapterNotEmpty } = await import("@/lib/course-chapter-manage");
const { deleteCourseChapterAction, moveCourseChapterAction, moveCourseLessonAction, renameCourseChapterAction } = await import("@/app/actions/course-curriculum-actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ productId: "course-1", chapterId: "chapter-1", revision: "4", title: "新章節", ...fields })) data.set(key, value);
  return data;
}

async function redirectOf(data: FormData) {
  try {
    await renameCourseChapterAction(data);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("The action did not redirect.");
}

const lessons = "/products/course-1/lessons";

describe("renameCourseChapterAction (F-5)", () => {
  beforeEach(() => {
    mocks.rename.mockReset();
    mocks.rename.mockResolvedValue("chapter-1");
    mocks.revalidatePath.mockReset();
  });

  it("renames with the session vendor and redirects with a saved notice", async () => {
    expect(await redirectOf(form({ vendorId: "vendor-2" }))).toBe(`redirect:${lessons}?chapterSaved=1`);
    expect(mocks.rename).toHaveBeenCalledWith({ synthetic: true }, "vendor-1", { productId: "course-1", chapterId: "chapter-1", revision: 4, title: "新章節" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(lessons);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/portal/academy", "layout");
  });

  it("maps a taken title, including a unique-index race, to the chapter's field error", async () => {
    mocks.rename.mockRejectedValueOnce(new ChapterTitleTaken("taken"));
    expect(await redirectOf(form({}))).toBe(`redirect:${lessons}?chapterError=duplicate&chapter=chapter-1#chapter-chapter-1`);
    mocks.rename.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
    expect(await redirectOf(form({}))).toBe(`redirect:${lessons}?chapterError=duplicate&chapter=chapter-1#chapter-chapter-1`);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps an invalid title to the field error and a stale course or chapter to the page conflict", async () => {
    mocks.rename.mockRejectedValueOnce(new ZodError([]));
    expect(await redirectOf(form({ title: "" }))).toBe(`redirect:${lessons}?chapterError=invalid&chapter=chapter-1#chapter-chapter-1`);
    mocks.rename.mockRejectedValueOnce(new CurriculumConflict("stale"));
    expect(await redirectOf(form({}))).toBe(`redirect:${lessons}?error=conflict`);
    mocks.rename.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("serialization", { code: "P2034", clientVersion: "test" }));
    expect(await redirectOf(form({}))).toBe(`redirect:${lessons}?error=conflict`);
  });

  it("treats a missing or malformed revision as a stale form, not a bad title", async () => {
    for (const revision of ["abc", "1.5", "-1", "", " 1", "1e3", "0x1", "9".repeat(20)]) {
      expect(await redirectOf(form({ revision }))).toBe(`redirect:${lessons}?error=conflict`);
    }
    const missing = form({});
    missing.delete("revision");
    expect(await redirectOf(missing)).toBe(`redirect:${lessons}?error=conflict`);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("encodes the echoed chapter id and drops an oversized one", async () => {
    mocks.rename.mockRejectedValue(new ChapterTitleTaken("taken"));
    expect(await redirectOf(form({ chapterId: "a b&c" }))).toBe(`redirect:${lessons}?chapterError=duplicate&chapter=a%20b%26c#chapter-a%20b%26c`);
    expect(await redirectOf(form({ chapterId: "x".repeat(161) }))).toBe(`redirect:${lessons}?chapterError=duplicate&chapter=#chapter-`);
  });

  it("rethrows unexpected failures", async () => {
    mocks.rename.mockRejectedValueOnce(new Error("database down"));
    expect(await redirectOf(form({}))).toBe("database down");
  });
});

type ManageAction = (form: FormData) => Promise<void>;

async function redirectOfAction(action: ManageAction, data: FormData) {
  try {
    await action(data);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("The action did not redirect.");
}

function manageForm(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ productId: "course-1", revision: "4", ...fields })) data.set(key, value);
  return data;
}

describe("chapter order, delete and lesson move actions (Q-15)", () => {
  beforeEach(() => {
    for (const mock of [mocks.moveChapter, mocks.deleteChapter, mocks.moveLesson, mocks.revalidatePath]) mock.mockReset();
    mocks.moveChapter.mockResolvedValue(true);
    mocks.deleteChapter.mockResolvedValue("chapter-1");
    mocks.moveLesson.mockResolvedValue(true);
  });

  it("binds every call to the session vendor, ignoring a vendorId in the form", async () => {
    expect(await redirectOfAction(moveCourseChapterAction, manageForm({ vendorId: "vendor-2", chapterId: "chapter-1", direction: "up" }))).toBe(`redirect:${lessons}?chapterMoved=1#chapter-chapter-1`);
    expect(mocks.moveChapter).toHaveBeenCalledWith({ synthetic: true }, "vendor-1", { productId: "course-1", chapterId: "chapter-1", direction: "up", revision: 4 });
    expect(await redirectOfAction(deleteCourseChapterAction, manageForm({ vendorId: "vendor-2", chapterId: "chapter-1" }))).toBe(`redirect:${lessons}?chapterDeleted=1`);
    expect(mocks.deleteChapter).toHaveBeenCalledWith({ synthetic: true }, "vendor-1", { productId: "course-1", chapterId: "chapter-1", revision: 4 });
    expect(await redirectOfAction(moveCourseLessonAction, manageForm({ vendorId: "vendor-2", lessonId: "lesson-1", targetChapterId: "chapter-2" }))).toBe(`redirect:${lessons}?lessonMoved=1#chapter-chapter-2`);
    expect(mocks.moveLesson).toHaveBeenCalledWith({ synthetic: true }, "vendor-1", { productId: "course-1", lessonId: "lesson-1", targetChapterId: "chapter-2", revision: 4 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/portal/academy", "layout");
  });

  it("shows a non-empty chapter as a field error, including the foreign-key backstop", async () => {
    mocks.deleteChapter.mockRejectedValueOnce(new ChapterNotEmpty("not empty"));
    expect(await redirectOfAction(deleteCourseChapterAction, manageForm({ chapterId: "chapter-1" }))).toBe(`redirect:${lessons}?chapterError=notEmpty&chapter=chapter-1#chapter-chapter-1`);
    mocks.deleteChapter.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" }));
    expect(await redirectOfAction(deleteCourseChapterAction, manageForm({ chapterId: "chapter-1" }))).toBe(`redirect:${lessons}?chapterError=notEmpty&chapter=chapter-1#chapter-chapter-1`);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps stale, unavailable and invalid input to the page errors and rethrows the rest", async () => {
    mocks.moveChapter.mockRejectedValueOnce(new CurriculumConflict("stale"));
    expect(await redirectOfAction(moveCourseChapterAction, manageForm({ chapterId: "chapter-1", direction: "up" }))).toBe(`redirect:${lessons}?error=conflict`);
    mocks.moveLesson.mockRejectedValueOnce(new CurriculumConflict("other course"));
    expect(await redirectOfAction(moveCourseLessonAction, manageForm({ lessonId: "lesson-1", targetChapterId: "chapter-9" }))).toBe(`redirect:${lessons}?error=conflict`);
    mocks.moveLesson.mockRejectedValueOnce(new ZodError([]));
    expect(await redirectOfAction(moveCourseLessonAction, manageForm({ lessonId: "", targetChapterId: "" }))).toBe(`redirect:${lessons}?error=invalid`);
    mocks.moveChapter.mockRejectedValueOnce(new Error("database down"));
    expect(await redirectOfAction(moveCourseChapterAction, manageForm({ chapterId: "chapter-1", direction: "up" }))).toBe("database down");
  });

  it("treats a missing or malformed revision as a stale form before touching the database", async () => {
    for (const action of [moveCourseChapterAction, deleteCourseChapterAction, moveCourseLessonAction]) {
      expect(await redirectOfAction(action, manageForm({ revision: "abc", chapterId: "chapter-1", lessonId: "lesson-1", targetChapterId: "chapter-2", direction: "up" }))).toBe(`redirect:${lessons}?error=conflict`);
    }
    expect(mocks.moveChapter).not.toHaveBeenCalled();
    expect(mocks.deleteChapter).not.toHaveBeenCalled();
    expect(mocks.moveLesson).not.toHaveBeenCalled();
  });
});
