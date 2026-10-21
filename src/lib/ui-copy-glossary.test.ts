import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 使用者可見文案不得出現工程術語（詞彙表見 docs/product/glossary.md）。
 * 掃描 src/components/** 與 src/app/** 的非測試 .tsx：JSX 文字，以及含中文的字串。
 * 例外必須寫在下方 EXEMPTIONS（附理由）；新增例外要有人審查。
 */
const FORBIDDEN =
  /(provider|ledger|session|slug|payload|webhook|admission|heartbeat|fail[- ]closed|immutable|basis points?|workspace|release gate|release owner|\bSLA\b|streamKey|ISO 4217|\bref\b|\btoken\b|append-only|\bVOD\b|Live Input|\bF\/G\b)/i;
const CJK = /[一-鿿]/;

type Exemption = { path: string; reason: string; terms?: RegExp };

const EXEMPTIONS: Exemption[] = [
  { path: "src/app/admin/", reason: "平台營運人員專用後台，不是講師或買家看到的頁面" },
  { path: "src/app/(app)/billing/", reason: "封測期間隱藏的帳務模組；開放前與帳務文案一併改寫" },
  { path: "src/app/(app)/affiliates/", reason: "封測期間隱藏的聯盟模組；開放前一併改寫" },
  {
    path: "src/components/line-official-account-form.tsx",
    reason: "對照 LINE Developers Console 的英文欄位名稱，詞彙表規定此頁保留並說明",
    terms: /(provider|webhook|token)/i,
  },
];

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx") && !/\.test\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

function rel(file: string) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function findViolations() {
  const violations: string[] = [];
  for (const file of [...walk(path.join(process.cwd(), "src/components")), ...walk(path.join(process.cwd(), "src/app"))]) {
    const name = rel(file);
    const exemptions = EXEMPTIONS.filter((item) => name.startsWith(item.path));
    if (exemptions.some((item) => !item.terms)) continue;
    const source = readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      let text: string | null = null;
      if (ts.isJsxText(node)) text = node.text;
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
      if (text !== null && (CJK.test(text) || ts.isJsxText(node)) && FORBIDDEN.test(text)) {
        const match = text.match(FORBIDDEN)![0];
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        const partial = exemptions.some((item) => item.terms?.test(match));
        const marked = /glossary-allow:/.test(lines[line] ?? "") || /glossary-allow:/.test(lines[line - 1] ?? "");
        if (!partial && !marked) violations.push(`${name}:${line + 1} 「${match}」 ${text.trim().replace(/\s+/g, " ").slice(0, 60)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return violations;
}

describe("使用者可見文案不得使用工程術語", () => {
  it("src/components 與 src/app 的畫面文字沒有詞彙表禁用詞", () => {
    expect(findViolations()).toEqual([]);
  });

  it("每個例外都指向真實存在的路徑並寫明理由", () => {
    for (const item of EXEMPTIONS) {
      expect(item.reason.length).toBeGreaterThan(5);
      expect(() => statSync(path.join(process.cwd(), item.path))).not.toThrow();
    }
  });
});
