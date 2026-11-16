import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import {
  APPLY_CONFIRMATION,
  CourseChapterRepairRefusedError,
  REMOTE_APPROVAL,
  parseCourseChapterRepairArguments,
  resolveCourseChapterRepairTarget,
  runCourseChapterRepair,
} from "./repair-course-chapter-links";

const db = getDb();
const vendorIds: string[] = [];
const confirmed = { REPAIR_CONFIRM: APPLY_CONFIRMATION };

/** A vendor with one course holding a lesson as pre-F-5 code writes it (no chapterId). */
async function legacyCourse() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic repair script vendor", slug: `repair-cli-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course", slug: `course-${suffix}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course" } });
  const lesson = await db.courseLesson.create({ data: { vendorId: vendor.id, productId: product.id, chapterTitle: " 第一章", title: "開場", position: 0 } });
  return { vendorId: vendor.id, lessonId: lesson.id };
}

const linkOf = async (lessonId: string) => (await db.courseLesson.findUniqueOrThrow({ where: { id: lessonId }, select: { chapterId: true } })).chapterId;

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

describe("scripts/repair-course-chapter-links (PostgreSQL)", () => {
  it("dry-runs by default: prints the two check counts and writes nothing", async () => {
    const f = await legacyCourse();
    const outcome = await runCourseChapterRepair(db, { apply: false, target: null, vendorId: f.vendorId }, confirmed);
    expect(outcome).toEqual({ mode: "plan", before: { unlinked: 1, staleLinks: 0 } });
    expect(await linkOf(f.lessonId)).toBeNull();
    expect(await db.courseChapter.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it("writes only with --apply and the confirmation value, limited to --vendor-id", async () => {
    const target = await legacyCourse();
    const other = await legacyCourse();
    const options = { apply: true, target: null, vendorId: target.vendorId } as const;
    await expect(runCourseChapterRepair(db, options, {})).rejects.toMatchObject({ category: "confirmation-missing" });
    expect(await linkOf(target.lessonId)).toBeNull();

    const outcome = await runCourseChapterRepair(db, options, confirmed);
    expect(outcome).toMatchObject({ mode: "apply", before: { unlinked: 1, staleLinks: 0 }, coursesRepaired: 1, lessonsRelinked: 1, chaptersCreated: 1, failedCourses: [], after: { unlinked: 0, staleLinks: 0 } });
    expect(await linkOf(target.lessonId)).not.toBeNull();
    expect(await linkOf(other.lessonId)).toBeNull();
    // A rerun is a no-op.
    expect(await runCourseChapterRepair(db, options, confirmed)).toMatchObject({ coursesRepaired: 0, lessonsRelinked: 0, after: { unlinked: 0, staleLinks: 0 } });
  });
});

describe("course chapter repair guards", () => {
  const loopback = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";
  const remote = "postgresql://user:pass@db.example.test:5432/celebratedeal?schema=public"; // secret-scan: allow-test-fixture (reserved .test host, fake credentials)

  it("parses only known arguments", () => {
    expect(parseCourseChapterRepairArguments([])).toEqual({ apply: false, target: null, vendorId: null });
    expect(parseCourseChapterRepairArguments(["--apply", "--target=production", "--vendor-id", "vendor-1"])).toEqual({ apply: true, target: "production", vendorId: "vendor-1" });
    for (const argv of [["--execute"], ["--target=prod"], ["--vendor-id"], ["--vendor-id", "a b"], ["--vendor-id", "--apply"]]) {
      expect(() => parseCourseChapterRepairArguments(argv)).toThrow(CourseChapterRepairRefusedError);
    }
  });

  it("allows loopback, needs an explicit remote target, and owner approval to write remotely", () => {
    const plan = { apply: false, target: null } as const;
    expect(resolveCourseChapterRepairTarget({ DATABASE_URL: loopback }, plan)).toEqual({ url: loopback, target: "loopback" });
    expect(resolveCourseChapterRepairTarget({ DATABASE_URL: loopback }, { apply: true, target: null })).toEqual({ url: loopback, target: "loopback" });
    expect(() => resolveCourseChapterRepairTarget({}, plan)).toThrow(expect.objectContaining({ category: "missing" }));
    expect(() => resolveCourseChapterRepairTarget({ DATABASE_URL: loopback }, { apply: false, target: "production" })).toThrow(expect.objectContaining({ category: "target-mismatch" }));
    expect(() => resolveCourseChapterRepairTarget({ DATABASE_URL: remote }, plan)).toThrow(expect.objectContaining({ category: "remote-without-target" }));
    expect(() => resolveCourseChapterRepairTarget({ DATABASE_URL: remote }, { apply: false, target: "staging" })).toThrow(expect.objectContaining({ category: "not-staging" }));
    expect(resolveCourseChapterRepairTarget({ DATABASE_URL: remote }, { apply: false, target: "production" })).toEqual({ url: remote, target: "production" });
    expect(() => resolveCourseChapterRepairTarget({ DATABASE_URL: remote }, { apply: true, target: "production" })).toThrow(expect.objectContaining({ category: "remote-not-approved" }));
    expect(() => resolveCourseChapterRepairTarget({ DATABASE_URL: remote, REPAIR_REMOTE_APPROVAL: "yes" }, { apply: true, target: "production" })).toThrow(expect.objectContaining({ category: "remote-not-approved" }));
    expect(resolveCourseChapterRepairTarget({ DATABASE_URL: remote, REPAIR_REMOTE_APPROVAL: REMOTE_APPROVAL }, { apply: true, target: "production" })).toEqual({ url: remote, target: "production" });
  });
});
