import { z } from "zod";

/**
 * Schema and pure helpers for the zh-TW AI assistant evaluation set
 * (`docs/ai/eval/zh-tw-v1.json`). Nothing here touches the network, the
 * database or the filesystem; callers hand in already-loaded data.
 */

export const EVAL_CATEGORIES = ["A1", "A2", "A4", "GUARDRAIL"] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

/** Number of cases each category must contain in the v1 set. */
export const EVAL_CATEGORY_QUOTAS: Readonly<Record<EvalCategory, number>> = {
  A1: 12,
  A2: 6,
  A4: 4,
  GUARDRAIL: 8,
};

export const EVAL_EXPECTED_BEHAVIORS = [
  "answer",
  "draft_only",
  "rewrite",
  "refuse",
  "ignore_embedded_instructions",
] as const;
export type EvalExpectedBehavior = (typeof EVAL_EXPECTED_BEHAVIORS)[number];

const nonEmptyText = z.string().trim().min(1);
const textList = z.array(nonEmptyText);

const EvalContextSchema = z
  .object({
    /** Simulated member role of the asker: owner / admin / accountant / support. */
    role: z.enum(["owner", "admin", "accountant", "support"]),
    /** One-sentence description of the synthetic merchant state. */
    summary: nonEmptyText,
    /** Flat synthetic signals (counts, flags, ids). Never real data. */
    signals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])).default({}),
  })
  .strict();

const FieldConstraintSchema = z
  .object({
    /** Key of the Live Studio draft payload (see `src/lib/live-studio-draft.ts`). */
    field: nonEmptyText,
    /** Constraint on the value; describes a rule, never a fixed string. */
    rule: nonEmptyText,
  })
  .strict();

export const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^(A1|A2|A4|G)-\d{2}$/u),
    category: z.enum(EVAL_CATEGORIES),
    prompt: nonEmptyText,
    context: EvalContextSchema,
    mustInclude: textList.min(1),
    /** App paths the answer must link to; `:param` marks a dynamic segment. */
    expectedLinks: z.array(z.string().regex(/^\/[^\s?#]*$/u)),
    mustNotInclude: textList,
    expectedBehavior: z.enum(EVAL_EXPECTED_BEHAVIORS),
    sourceRefs: z.array(z.string().regex(/^[A-Za-z0-9_.@()[\]/-]+$/u)).min(1),
    /** A2 only: constraints on the generated Live Studio draft fields. */
    fieldConstraints: z.array(FieldConstraintSchema).optional(),
    /** A4 only: template variables the draft must keep, exactly as written. */
    requiredVariables: z.array(z.string().regex(/^[a-z_]+$/u)).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const idPrefix = value.id.split("-")[0];
    const expectedPrefix = value.category === "GUARDRAIL" ? "G" : value.category;
    if (idPrefix !== expectedPrefix) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "id prefix must match category" });
    }
    if (value.category === "A2" && !(value.fieldConstraints && value.fieldConstraints.length > 0)) {
      ctx.addIssue({ code: "custom", path: ["fieldConstraints"], message: "A2 cases need fieldConstraints" });
    }
    if (value.category !== "A2" && value.fieldConstraints) {
      ctx.addIssue({ code: "custom", path: ["fieldConstraints"], message: "only A2 cases use fieldConstraints" });
    }
    if (value.category === "A4" && !(value.requiredVariables && value.requiredVariables.length > 0)) {
      ctx.addIssue({ code: "custom", path: ["requiredVariables"], message: "A4 cases need requiredVariables" });
    }
    if (value.category !== "A4" && value.requiredVariables) {
      ctx.addIssue({ code: "custom", path: ["requiredVariables"], message: "only A4 cases use requiredVariables" });
    }
    if (value.category === "GUARDRAIL" && value.expectedBehavior === "answer") {
      ctx.addIssue({ code: "custom", path: ["expectedBehavior"], message: "guardrail cases must not expect a plain answer" });
    }
    if (value.category === "A2" || value.category === "A4") {
      if (value.expectedBehavior !== "draft_only" && value.expectedBehavior !== "rewrite") {
        ctx.addIssue({ code: "custom", path: ["expectedBehavior"], message: "drafting cases must be draft_only or rewrite" });
      }
    }
  });

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalSetSchema = z
  .object({
    version: z.literal(1),
    locale: z.literal("zh-TW"),
    description: nonEmptyText,
    cases: z.array(EvalCaseSchema).min(1),
  })
  .strict();

export type EvalSet = z.infer<typeof EvalSetSchema>;

/** Parses raw JSON data; throws a ZodError with the failing paths. */
export function parseEvalSet(raw: unknown): EvalSet {
  return EvalSetSchema.parse(raw);
}

export function countByCategory(cases: readonly Pick<EvalCase, "category">[]): Record<EvalCategory, number> {
  const counts: Record<EvalCategory, number> = { A1: 0, A2: 0, A4: 0, GUARDRAIL: 0 };
  for (const item of cases) counts[item.category] += 1;
  return counts;
}

export function findDuplicateIds(cases: readonly Pick<EvalCase, "id">[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

/** Returns an error message per category whose size differs from its quota. */
export function checkCategoryQuotas(cases: readonly Pick<EvalCase, "category">[]): string[] {
  const counts = countByCategory(cases);
  return EVAL_CATEGORIES.flatMap((category) =>
    counts[category] === EVAL_CATEGORY_QUOTAS[category]
      ? []
      : [`${category}: expected ${EVAL_CATEGORY_QUOTAS[category]}, got ${counts[category]}`],
  );
}

// ---------------------------------------------------------------------------
// App Router path matching
// ---------------------------------------------------------------------------

export type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "dynamic" }
  | { kind: "catchAll"; optional: boolean };

export type RoutePattern = RouteSegment[];

const ROUTE_FILE = /(?:^|\/)(?:page|route)\.(?:tsx|ts|jsx|js|mdx)$/u;

/**
 * Converts a file path relative to `src/app` (such as
 * `(app)/lives/[id]/edit/page.tsx`) to a URL pattern. Returns null for files
 * that are not routable entry points, or that live in a parallel (`@slot`) or
 * intercepting (`(.)x`) folder, which never answer a direct link on their own.
 */
export function routePatternFromFile(relativeFile: string): RoutePattern | null {
  const normalized = relativeFile.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!ROUTE_FILE.test(normalized)) return null;
  const directories = normalized.split("/").slice(0, -1);
  const pattern: RoutePattern = [];
  for (const directory of directories) {
    if (directory.startsWith("@") || /^\(\.{1,3}\)/u.test(directory)) return null;
    if (/^\([^)]*\)$/u.test(directory)) continue; // route group
    if (directory.startsWith("_")) return null; // private folder
    const optionalCatchAll = /^\[\[\.\.\.[^\]]+\]\]$/u.test(directory);
    if (optionalCatchAll || /^\[\.\.\.[^\]]+\]$/u.test(directory)) {
      pattern.push({ kind: "catchAll", optional: optionalCatchAll });
    } else if (/^\[[^\]]+\]$/u.test(directory)) {
      pattern.push({ kind: "dynamic" });
    } else {
      pattern.push({ kind: "static", value: directory });
    }
  }
  return pattern;
}

export function routePatternsFromFiles(relativeFiles: readonly string[]): RoutePattern[] {
  return relativeFiles.flatMap((file) => {
    const pattern = routePatternFromFile(file);
    return pattern ? [pattern] : [];
  });
}

function segmentsOfLink(link: string): string[] | null {
  if (!link.startsWith("/")) return null;
  const path = link.split(/[?#]/u)[0]!;
  return path.split("/").filter((segment) => segment.length > 0);
}

function matchesPattern(segments: readonly string[], pattern: RoutePattern): boolean {
  const walk = (segmentIndex: number, patternIndex: number): boolean => {
    if (patternIndex === pattern.length) return segmentIndex === segments.length;
    const part = pattern[patternIndex]!;
    if (part.kind === "catchAll") {
      const remaining = segments.length - segmentIndex;
      if (remaining === 0) return part.optional && patternIndex === pattern.length - 1;
      return patternIndex === pattern.length - 1;
    }
    if (segmentIndex >= segments.length) return false;
    if (part.kind === "static") {
      return part.value === segments[segmentIndex] && walk(segmentIndex + 1, patternIndex + 1);
    }
    // A dynamic folder accepts any concrete value or a `:param` placeholder.
    return walk(segmentIndex + 1, patternIndex + 1);
  };
  return walk(0, 0);
}

/**
 * True when `link` resolves to a page or route handler. `:param` segments in
 * the link stand for dynamic values, but never satisfy a static folder.
 */
export function linkMatchesRoutes(link: string, patterns: readonly RoutePattern[]): boolean {
  const segments = segmentsOfLink(link);
  if (!segments) return false;
  return patterns.some((pattern) => matchesPattern(segments, pattern));
}
