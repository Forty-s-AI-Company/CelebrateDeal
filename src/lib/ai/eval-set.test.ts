import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_TEMPLATE_VARIABLES } from "@/lib/message-template";
import {
  checkCategoryQuotas,
  countByCategory,
  EVAL_CATEGORY_QUOTAS,
  EvalCaseSchema,
  findDuplicateIds,
  linkMatchesRoutes,
  parseEvalSet,
  routePatternFromFile,
  routePatternsFromFiles,
  type EvalCase,
} from "./eval-set";

const repoRoot = path.resolve(__dirname, "../../..");
const appDir = path.join(repoRoot, "src/app");
const evalJsonPath = path.join(repoRoot, "docs/ai/eval/zh-tw-v1.json");

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

const evalSet = parseEvalSet(JSON.parse(readFileSync(evalJsonPath, "utf8")));
const appRoutes = routePatternsFromFiles(walk(appDir));

function validCase(overrides: Partial<EvalCase> = {}): unknown {
  return {
    id: "A1-01",
    category: "A1",
    prompt: "問題",
    context: { role: "owner", summary: "合成商家" },
    mustInclude: ["要點"],
    expectedLinks: ["/lives/new"],
    mustNotInclude: [],
    expectedBehavior: "answer",
    sourceRefs: ["src/lib/live-studio-steps.ts"],
    ...overrides,
  };
}

describe("zh-tw-v1 evaluation set", () => {
  it("matches the schema and has unique ids", () => {
    expect(evalSet.cases).toHaveLength(30);
    expect(findDuplicateIds(evalSet.cases)).toEqual([]);
  });

  it("keeps the planned category mix", () => {
    expect(countByCategory(evalSet.cases)).toEqual(EVAL_CATEGORY_QUOTAS);
    expect(checkCategoryQuotas(evalSet.cases)).toEqual([]);
  });

  it("links only to routes that exist under src/app", () => {
    const missing = evalSet.cases.flatMap((item) =>
      item.expectedLinks.filter((link) => !linkMatchesRoutes(link, appRoutes)).map((link) => `${item.id}: ${link}`),
    );
    expect(missing).toEqual([]);
  });

  it("cites source files that exist", () => {
    const missing = evalSet.cases.flatMap((item) =>
      item.sourceRefs.filter((ref) => !existsSync(path.join(repoRoot, ref))).map((ref) => `${item.id}: ${ref}`),
    );
    expect(missing).toEqual([]);
  });

  it("only requires supported template variables in A4 cases", () => {
    const supported = new Set<string>(MESSAGE_TEMPLATE_VARIABLES);
    for (const item of evalSet.cases.filter((c) => c.category === "A4")) {
      for (const variable of item.requiredVariables ?? []) expect(supported.has(variable), `${item.id} ${variable}`).toBe(true);
      // A draft must never be told to use a variable that the renderer rejects.
      for (const banned of item.mustNotInclude) {
        const match = /^\{\{(\w+)\}\}$/u.exec(banned);
        if (match) expect(supported.has(match[1]!), `${item.id} bans a supported variable ${banned}`).toBe(false);
      }
    }
  });

  it("targets real Live Studio draft fields in A2 cases", () => {
    const draftSource = readFileSync(path.join(repoRoot, "src/lib/live-studio-draft.ts"), "utf8");
    for (const item of evalSet.cases.filter((c) => c.category === "A2")) {
      for (const { field } of item.fieldConstraints ?? []) {
        expect(new RegExp(`\\b${field}\\b`, "u").test(draftSource), `${item.id} field ${field}`).toBe(true);
      }
    }
  });

  it("never lets an A1 case link into admin-only pages or hide mustNotInclude overlap", () => {
    for (const item of evalSet.cases) {
      expect(item.expectedLinks.some((link) => link.startsWith("/admin")), item.id).toBe(false);
      for (const link of item.expectedLinks) {
        expect(item.mustNotInclude.includes(link), `${item.id} ${link}`).toBe(false);
      }
    }
  });

  it("is written in Traditional Chinese prompts without secrets or real addresses", () => {
    const raw = readFileSync(evalJsonPath, "utf8");
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9]/u);
    for (const item of evalSet.cases) expect(item.prompt).toMatch(/[一-鿿]/u);
  });
});

describe("EvalCaseSchema", () => {
  it("accepts a minimal valid case", () => {
    expect(EvalCaseSchema.safeParse(validCase()).success).toBe(true);
  });

  it.each([
    ["a mismatched id prefix", { id: "A2-01" }],
    ["an A2 case without fieldConstraints", { id: "A2-01", category: "A2", expectedBehavior: "draft_only" }],
    ["an A4 case without requiredVariables", { id: "A4-01", category: "A4", expectedBehavior: "draft_only" }],
    ["fieldConstraints on a non-A2 case", { fieldConstraints: [{ field: "title", rule: "x" }] }],
    ["requiredVariables on a non-A4 case", { requiredVariables: ["name"] }],
    ["a guardrail case expecting a plain answer", { id: "G-01", category: "GUARDRAIL", expectedBehavior: "answer" }],
    ["a drafting case that expects a plain answer", { id: "A2-02", category: "A2", expectedBehavior: "answer", fieldConstraints: [{ field: "title", rule: "x" }] }],
    ["an empty mustInclude", { mustInclude: [] }],
    ["a link without a leading slash", { expectedLinks: ["lives/new"] }],
    ["a link carrying a query string", { expectedLinks: ["/lives/new?x=1"] }],
    ["no sourceRefs", { sourceRefs: [] }],
    ["an unknown field", { extra: true }],
  ])("rejects %s", (_name, overrides) => {
    expect(EvalCaseSchema.safeParse(validCase(overrides as Partial<EvalCase>)).success).toBe(false);
  });

  it("rejects a wrong category quota and duplicate ids", () => {
    const cases = [{ category: "A1" as const, id: "A1-01" }, { category: "A1" as const, id: "A1-01" }];
    expect(findDuplicateIds(cases)).toEqual(["A1-01"]);
    expect(checkCategoryQuotas(cases)).toContain("A1: expected 12, got 2");
    expect(checkCategoryQuotas(cases)).toHaveLength(4);
  });

  it("throws from parseEvalSet on bad input", () => {
    expect(() => parseEvalSet({ version: 2 })).toThrow();
  });
});

describe("routePatternFromFile", () => {
  it("drops route groups and keeps static and dynamic segments", () => {
    expect(routePatternFromFile("(app)/lives/[id]/edit/page.tsx")).toEqual([
      { kind: "static", value: "lives" },
      { kind: "dynamic" },
      { kind: "static", value: "edit" },
    ]);
  });

  it("maps the root page to an empty pattern and accepts route handlers", () => {
    expect(routePatternFromFile("page.tsx")).toEqual([]);
    expect(routePatternFromFile("api/health/route.ts")).toEqual([
      { kind: "static", value: "api" },
      { kind: "static", value: "health" },
    ]);
  });

  it("normalizes Windows separators", () => {
    expect(routePatternFromFile("(app)\\forms\\new\\page.tsx")).toEqual([
      { kind: "static", value: "forms" },
      { kind: "static", value: "new" },
    ]);
  });

  it("ignores non-route files, parallel slots, intercepting folders and private folders", () => {
    expect(routePatternFromFile("(app)/lives/layout.tsx")).toBeNull();
    expect(routePatternFromFile("@checkout/page.tsx")).toBeNull();
    expect(routePatternFromFile("@checkout/(.)checkout/[id]/page.tsx")).toBeNull();
    expect(routePatternFromFile("feed/(..)photo/page.tsx")).toBeNull();
    expect(routePatternFromFile("_internal/page.tsx")).toBeNull();
  });

  it("recognizes catch-all and optional catch-all segments", () => {
    expect(routePatternFromFile("docs/[...slug]/page.tsx")).toEqual([
      { kind: "static", value: "docs" },
      { kind: "catchAll", optional: false },
    ]);
    expect(routePatternFromFile("docs/[[...slug]]/page.tsx")).toEqual([
      { kind: "static", value: "docs" },
      { kind: "catchAll", optional: true },
    ]);
  });
});

describe("linkMatchesRoutes", () => {
  const patterns = routePatternsFromFiles([
    "page.tsx",
    "(app)/lives/page.tsx",
    "(app)/lives/new/page.tsx",
    "(app)/lives/[id]/edit/page.tsx",
    "docs/[...slug]/page.tsx",
    "help/[[...slug]]/page.tsx",
    "@modal/(.)secret/page.tsx",
    "(app)/lives/layout.tsx",
  ]);

  it("matches static, root and dynamic routes", () => {
    expect(linkMatchesRoutes("/", patterns)).toBe(true);
    expect(linkMatchesRoutes("/lives", patterns)).toBe(true);
    expect(linkMatchesRoutes("/lives/new", patterns)).toBe(true);
    expect(linkMatchesRoutes("/lives/abc123/edit", patterns)).toBe(true);
    expect(linkMatchesRoutes("/lives/:id/edit", patterns)).toBe(true);
  });

  it("ignores query, hash and a trailing slash", () => {
    expect(linkMatchesRoutes("/lives/new?x=1#top", patterns)).toBe(true);
    expect(linkMatchesRoutes("/lives/", patterns)).toBe(true);
  });

  it("rejects unknown paths, wrong depth, relative links and layout-only folders", () => {
    expect(linkMatchesRoutes("/lives/abc123", patterns)).toBe(false);
    expect(linkMatchesRoutes("/lives/abc/edit/extra", patterns)).toBe(false);
    expect(linkMatchesRoutes("/video", patterns)).toBe(false);
    expect(linkMatchesRoutes("lives", patterns)).toBe(false);
    expect(linkMatchesRoutes("/secret", patterns)).toBe(false);
  });

  it("does not let a placeholder satisfy a static folder", () => {
    expect(linkMatchesRoutes("/:section/new", patterns)).toBe(false);
  });

  it("handles catch-all routes", () => {
    expect(linkMatchesRoutes("/docs/a", patterns)).toBe(true);
    expect(linkMatchesRoutes("/docs/a/b/c", patterns)).toBe(true);
    expect(linkMatchesRoutes("/docs", patterns)).toBe(false);
    expect(linkMatchesRoutes("/help", patterns)).toBe(true);
    expect(linkMatchesRoutes("/help/x/y", patterns)).toBe(true);
  });
});
