/**
 * Repairs CourseLesson.chapterId links (F-5) before the migration that makes the
 * column NOT NULL. See docs/codex-goal/PRISMA_INVARIANTS.md, "課程章節獨立 model".
 *
 * While code older than F-5 can still write lessons, a lesson can be left without
 * a chapter link or with a stale one (its chapterTitle changed, chapterId kept).
 * Readers already place such lessons by title; this run rewrites the links with
 * repairCourseChapterLinks (src/lib/course-chapter-repair.ts) so that both
 * read-only checks return 0. It never changes chapterTitle, lesson order or what
 * learners see.
 *
 * Running it against staging or production needs the owner's separate, explicit
 * authorization for that run, the dry run included. The flags below are a guard
 * against mistakes, not an access control.
 *
 * Safety:
 * - Dry run by default: prints the two read-only check counts and writes nothing.
 * - Writing needs `--apply` AND REPAIR_CONFIRM=REPAIR_COURSE_CHAPTER_LINKS.
 * - Target: a loopback `celebratedeal_*` database is always allowed. Staging
 *   needs `--target=staging` and a URL that is the staging database. Any other
 *   database needs `--target=production`. Writing to staging or production also
 *   needs REPAIR_REMOTE_APPROVAL=OWNER_APPROVED_COURSE_CHAPTER_REPAIR, which the
 *   operator sets only with the owner's explicit approval. The validated URL is
 *   pinned into the Prisma client.
 * - `--vendor-id <id>` limits the counts and the repair to one tenant.
 * - Every write is a compare-and-set on the title and link that were read, one
 *   Serializable transaction per course; a rerun is a no-op and an interrupted
 *   run can simply be started again. Courses that keep failing are listed (vendor
 *   and course IDs only) and make the run exit with status 1.
 * - Prints IDs and counts only, never lesson or chapter titles.
 *
 * Usage:
 *   DATABASE_URL=<loopback> node --import tsx scripts/repair-course-chapter-links.ts
 *   REPAIR_CONFIRM=REPAIR_COURSE_CHAPTER_LINKS DATABASE_URL=<loopback> \
 *     node --import tsx scripts/repair-course-chapter-links.ts --apply [--vendor-id <id>]
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { courseChapterLinkCounts, repairCourseChapterLinks } from "../src/lib/course-chapter-repair";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const APPLY_CONFIRMATION = "REPAIR_COURSE_CHAPTER_LINKS";
export const REMOTE_APPROVAL = "OWNER_APPROVED_COURSE_CHAPTER_REPAIR";

type Environment = Readonly<Record<string, string | undefined>>;

export class CourseChapterRepairRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Course chapter link repair refused.");
    this.name = "CourseChapterRepairRefusedError";
  }
}

export type CourseChapterRepairCliOptions = {
  apply: boolean;
  target: "loopback" | "staging" | "production" | null;
  vendorId: string | null;
};

export function parseCourseChapterRepairArguments(argv: readonly string[]): CourseChapterRepairCliOptions {
  const options: CourseChapterRepairCliOptions = { apply: false, target: null, vendorId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--apply") options.apply = true;
    else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (target !== "loopback" && target !== "staging" && target !== "production") throw new CourseChapterRepairRefusedError("invalid-target");
      options.target = target;
    } else if (argument === "--vendor-id") {
      const value = argv[index + 1]?.trim();
      if (!value || value.startsWith("--") || value.length > 191 || /[\s\p{Cc}]/u.test(value)) throw new CourseChapterRepairRefusedError("invalid-vendor-id");
      options.vendorId = value;
      index += 1;
    } else {
      throw new CourseChapterRepairRefusedError("unknown-argument");
    }
  }
  return options;
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveCourseChapterRepairTarget(env: Environment, options: Pick<CourseChapterRepairCliOptions, "apply" | "target">) {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new CourseChapterRepairRefusedError("missing");
  if (classifyLocalTestDatabase(url).safe) {
    if (options.target !== null && options.target !== "loopback") throw new CourseChapterRepairRefusedError("target-mismatch");
    return { url, target: "loopback" as const };
  }
  let target: "staging" | "production";
  if (options.target === "staging") {
    if (!isStagingDatabaseUrl(url)) throw new CourseChapterRepairRefusedError("not-staging");
    target = "staging";
  } else if (options.target === "production") {
    if (isStagingDatabaseUrl(url)) throw new CourseChapterRepairRefusedError("target-mismatch");
    target = "production";
  } else {
    throw new CourseChapterRepairRefusedError("remote-without-target");
  }
  if (options.apply && env.REPAIR_REMOTE_APPROVAL !== REMOTE_APPROVAL) throw new CourseChapterRepairRefusedError("remote-not-approved");
  return { url, target };
}

export async function runCourseChapterRepair(db: PrismaClient, options: CourseChapterRepairCliOptions, env: Environment) {
  const scope = options.vendorId ? { vendorId: options.vendorId } : {};
  const before = await courseChapterLinkCounts(db, scope);
  if (!options.apply) return { mode: "plan" as const, before };
  if (env.REPAIR_CONFIRM !== APPLY_CONFIRMATION) throw new CourseChapterRepairRefusedError("confirmation-missing");
  const result = await repairCourseChapterLinks(db, scope);
  const after = await courseChapterLinkCounts(db, scope);
  return { mode: "apply" as const, before, ...result, after };
}

async function main() {
  let category = "unexpected";
  try {
    const options = parseCourseChapterRepairArguments(process.argv.slice(2));
    const { url, target } = resolveCourseChapterRepairTarget(process.env, options);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      category = "run";
      const outcome = await runCourseChapterRepair(db, options, process.env);
      const incomplete = outcome.mode === "apply" && (outcome.failedCourses.length > 0 || outcome.after.unlinked > 0 || outcome.after.staleLinks > 0);
      console.log(JSON.stringify({ status: incomplete ? "incomplete" : "ok", target, vendorId: options.vendorId, ...outcome, secretDetailsEmitted: false }));
      if (incomplete) process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (error instanceof CourseChapterRepairRefusedError) category = error.category;
    console.error(JSON.stringify({ status: "failed", safeCategory: `course-chapter-repair:${category}`, secretDetailsEmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
