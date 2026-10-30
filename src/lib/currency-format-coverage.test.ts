import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// F-120：使用者看得到的台幣金額一律走 formatTwd()／formatCurrency()（src/lib/format.ts），
// 輸出 NT$1,234。這個輕量掃描擋下 src/components 與 src/app 新增的手刻金額格式。
const HAND_ROLLED_CURRENCY: Array<{ name: string; pattern: RegExp }> = [
  { name: "寫死的 NT$ 前綴", pattern: /NT\$/ },
  { name: "Intl.NumberFormat", pattern: /Intl\.NumberFormat/ },
  { name: "toLocaleString 的 currency 樣式", pattern: /style:\s*["']currency["']/ },
  { name: "金額欄位直接 toLocaleString", pattern: /\b\w*(?:amount|price|cents|total|fee|revenue|commission|payout|refund)\w*(?:\)|\?)?\.toLocaleString\(/i },
  { name: "分轉元後 toFixed", pattern: /\/\s*100\)?\s*\.toFixed\(/ },
  { name: "動態數字後接「元」", pattern: /[}\)]\s*元/ },
];

// 檔案層級例外，需寫明理由。`src/lib/format.ts` 本身在掃描範圍外。
const ALLOWED_FILES: Record<string, string> = {
  "src/components/product-form-client.tsx": "centsToMajor 是填入編輯欄位的原始數字，不是顯示金額",
  "src/components/landing-pages/funnel-webinar-elements.tsx": "編輯器範例項目的固定文案 NT$0，不是計算出的金額",
  "src/app/(app)/affiliates/payout-policy/page.tsx": "欄位說明文字「100 分＝NT$1」，是單位換算的靜態說明",
};

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function violations(source: string) {
  const found: string[] = [];
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const { name, pattern } of HAND_ROLLED_CURRENCY) {
      if (pattern.test(line)) found.push(`${index + 1}: ${name}`);
    }
  });
  return found;
}

describe("F-120 金額格式", () => {
  it("掃描規則抓得到手刻金額，放過 formatTwd", () => {
    expect(violations("const a = `NT$${n}`;")).toHaveLength(1);
    expect(violations("new Intl.NumberFormat('zh-TW').format(n)")).toHaveLength(1);
    expect(violations("{(row.priceCents / 100).toFixed(2)}")).toHaveLength(1);
    expect(violations("{order.totalAmount.toLocaleString()}")).toHaveLength(1);
    expect(violations("<p>{formatNumber(x)} 元</p>")).toHaveLength(1);
    expect(violations("{formatTwd(order.amountCents)}")).toHaveLength(0);
    expect(violations("{used.toLocaleString()} 分鐘")).toHaveLength(0);
    expect(violations("// NT$1,234 範例")).toHaveLength(0);
  });

  it("src/components 與 src/app 沒有手刻的金額格式", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const base of ["src/components", "src/app"]) {
      for (const file of listSources(path.join(root, base))) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (ALLOWED_FILES[relative]) continue;
        for (const hit of violations(readFileSync(file, "utf8"))) offenders.push(`${relative}:${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
