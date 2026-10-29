// Go/No-Go 瀏覽器檢查共用工具。不含任何帳密：帳號與密碼只從目前行程的環境變數讀取。
//   STAGING_URL      staging 網址
//   QA_EMAIL / QA_PASSWORD  合成測試商家帳號（不得啟用 MFA）
//   EVIDENCE_DIR     截圖輸出資料夾（預設 docs/ai-team/evidence/go-nogo-20261031）
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

export const base = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
export const evidenceDir = process.env.EVIDENCE_DIR ?? "docs/ai-team/evidence/go-nogo-20261031";
mkdirSync(evidenceDir, { recursive: true });

export const results = [];
export function record(id, name, ok, detail) {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}  -- ${detail}`);
}

export async function launch() {
  if (!base) throw new Error("請設定環境變數 STAGING_URL");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "zh-TW", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { browser, context, page };
}

export async function login(page) {
  const email = process.env.QA_EMAIL;
  const password = process.env.QA_PASSWORD;
  if (!email || !password) throw new Error("請設定 QA_EMAIL 與 QA_PASSWORD（只存在目前行程）");
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 }), page.click('button[type="submit"]')]);
}

export async function shot(page, name) {
  const file = `${evidenceDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 項，失敗 ${failed.length} 項`);
  process.exit(failed.length ? 1 : 0);
}
