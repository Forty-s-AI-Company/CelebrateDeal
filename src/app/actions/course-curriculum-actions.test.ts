import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  security: vi.fn(async () => undefined),
  manager: vi.fn(async () => ({ id: "vendor-1", slug: "academy", enabledFeatureModules: [] as string[], betaFeatureGrants: ["courses"] })),
  rename: vi.fn(async () => "chapter-1"),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ synthetic: true }) }));
vi.mock("@/lib/course-curriculum", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/course-curriculum")>(),
  renameCourseChapter: mocks.rename,
}));

const { ChapterTitleTaken, CurriculumConflict } = await import("@/lib/course-curriculum");
const { renameCourseChapterAction } = await import("@/app/actions/course-curriculum-actions");

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
