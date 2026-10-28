/**
 * Webinar／一頁式網站範本「不跑版」自動檢查（docs/product/webinar-templates/qa-standards.md）。
 *
 * 用法：
 *   node scripts/funnel-template-layout-qa.mjs --templates=id1,id2 [--widths=1440,390] [--stress] [--out=資料夾] [--base-url=http://127.0.0.1:3000]
 *   node scripts/funnel-template-layout-qa.mjs --all --stress
 *   node scripts/funnel-template-layout-qa.mjs --templates=id --schedule=sample,far,live,replay,ended
 *     （harness 合成活動排程，驗證倒數、活動資訊列、截止提示與 webinar_state；每種排程各跑一輪，截圖檔名加 ~排程）
 *   --jpeg：截圖存成 JPEG（品質 72），給要放進 repo 的證據
 *
 * 沒有 --base-url 時，會把 src／public 複製到暫存鏡像目錄（排除所有 .env*），只傳安全環境變數，
 * 在 127.0.0.1 的未使用 port（預設 31027 起）啟動 `next dev --webpack`，跑完即關閉。
 * 有失敗時 exit code 為 1。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";
import { runLayoutChecks } from "./funnel-template-layout-checks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WIDTHS = [1440, 1280, 1024, 768, 390, 375, 360, 320];
const DEGRADED_RULES = ["L-1", "L-3", "L-5", "L-11"];
const FULL_RULES = ["L-1", "L-2", "L-3", "L-4", "L-5", "L-6", "L-10", "L-11", "F-3.1"];
/** qa-standards §4: stress copy must still pass L-1～L-5 (320 keeps its degraded subset). */
const STRESS_RULES = ["L-1", "L-2", "L-3", "L-4", "L-5"];
const HARNESS_PATH = "/browser-qa/funnel-design";
const SCHEDULES = ["sample", "far", "live", "replay", "ended"];
const allowedFiles = ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts"];

function parseArgs(argv) {
  const args = { templates: [], widths: null, stress: false, all: false, out: null, baseUrl: null, schedules: [null], jpeg: false };
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/u, "").split("=");
    const value = rest.join("=");
    if (key === "templates") args.templates = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (key === "widths") args.widths = value.split(",").map(Number).filter((item) => Number.isInteger(item) && item >= 200 && item <= 4000);
    else if (key === "stress") args.stress = value !== "false";
    else if (key === "all") args.all = true;
    else if (key === "jpeg") args.jpeg = true;
    else if (key === "out") args.out = value;
    else if (key === "schedule") args.schedules = value.split(",").map((item) => item.trim()).filter((item) => SCHEDULES.includes(item));
    else if (key === "base-url") args.baseUrl = value.replace(/\/+$/u, "");
    else throw new Error(`未知的參數：${arg}`);
  }
  if (!args.all && !args.templates.length) throw new Error("請提供 --templates=id1,id2 或 --all");
  return args;
}

const heightFor = (width) => (width < 640 ? 844 : 900);
function userAgentFor(width) {
  if (width < 640) return { ua: devices["iPhone 13"].userAgent, touch: true };
  if (width < 1080) return { ua: devices["iPad (gen 7)"].userAgent, touch: true };
  return { ua: devices["Desktop Chrome"].userAgent, touch: false };
}

async function findFreePort(start) {
  for (let port = start; port < start + 50; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`找不到 ${start} 起的可用 port`);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

async function startMirrorServer() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-template-layout-"));
  const mirror = path.join(work, "app");
  fs.mkdirSync(mirror, { recursive: true });
  // 鏡像目錄不含任何 .env*；node_modules 只是唯讀的相依套件 junction。
  for (const directory of ["src", "public"]) {
    fs.cpSync(path.join(root, directory), path.join(mirror, directory), { recursive: true, filter: (candidate) => !path.basename(candidate).startsWith(".env") });
  }
  for (const file of allowedFiles) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), "junction");
  const port = await findFreePort(31027);
  const environment = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: work,
    TMP: work,
    CI: "true",
    CHECKPOINT_DISABLE: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    E2E_TEST_MODE: "true",
    FUNNEL_ELEMENTS_E2E: "true",
  };
  const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextCli, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: mirror, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const remember = (chunk) => { log = (log + chunk.toString()).slice(-6000); };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`dev server 提前結束（exit ${child.exitCode}）：\n${log}`);
    try {
      const response = await fetch(`${baseUrl}${HARNESS_PATH}`);
      if (response.status < 500) break;
      if (Date.now() > deadline) throw new Error(`dev server 編譯失敗（HTTP ${response.status}）：\n${log}`);
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`dev server 在 240 秒內沒有就緒：${error instanceof Error ? error.message : error}\n${log}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const stop = () => {
    killTree(child);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { fs.rmSync(work, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); }
    }
  };
  return { baseUrl, stop };
}

async function listAllTemplateIds(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}${HARNESS_PATH}`, { waitUntil: "load", timeout: 180_000 });
  await page.waitForSelector('[data-design-harness-ready="true"]', { timeout: 30_000 });
  const ids = await page.$$eval("nav a[href^='?template=']", (links) => links.map((link) => new URL(link.href).searchParams.get("template")).filter(Boolean));
  await context.close();
  return [...new Set(ids)];
}

/** 一個「範本 × 寬度 × 文案」的檢查回合。 */
async function runCase(context, { baseUrl, template, width, height, stress, rules, screenshot, schedule }) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const failures = [];
  try {
    const url = `${baseUrl}${HARNESS_PATH}?template=${encodeURIComponent(template)}&viewport=responsive${stress ? "&stress=1" : ""}${schedule ? `&schedule=${schedule}` : ""}`;
    const response = await page.goto(url, { waitUntil: "load", timeout: 180_000 });
    if (!response || response.status() >= 400) failures.push({ rule: "LOAD", nodeId: null, nodeType: null, detail: `HTTP ${response ? response.status() : "無回應"}` });
    try {
      await page.waitForSelector('[data-design-harness="template"][data-design-harness-ready="true"]', { timeout: 30_000 });
    } catch {
      failures.push({ rule: "LOAD", nodeId: null, nodeType: null, detail: "找不到範本（harness 沒有渲染 template，或超過 30 秒未就緒）" });
      return { failures, consoleErrors };
    }
    await page.evaluate(() => document.fonts.ready);
    // 逐段捲動，載入 lazy 圖片與觸發進場內容，再回到頂端。
    await page.evaluate(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((resolve) => setTimeout(resolve, 60)); }
      window.scrollTo(0, 0);
      await Promise.all(Array.from(document.images).map((image) => image.complete ? null : new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); setTimeout(resolve, 5000); })));
      await document.fonts.ready;
    });
    await page.waitForTimeout(250);
    failures.push(...await page.evaluate(runLayoutChecks, { width, height, rules }));
    if (screenshot) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: screenshot, fullPage: true, ...(screenshot.endsWith(".jpg") ? { type: "jpeg", quality: 72 } : {}) });
    }
    const hydration = consoleErrors.filter((message) => /hydrat/iu.test(message));
    if (hydration.length) failures.push({ rule: "HYDRATION", nodeId: null, nodeType: null, detail: hydration[0].slice(0, 1200) });
  } finally {
    await page.close();
  }
  return { failures, consoleErrors };
}

function summarize(results) {
  const lines = [];
  const pad = (value, size) => String(value).padEnd(size);
  const total = (result) => result.failures.reduce((sum, item) => sum + (item.omitted ?? 1), 0);
  lines.push(`${pad("範本", 34)}${pad("寬度", 12)}${pad("文案", 6)}${pad("排程", 8)}${pad("失敗", 6)}規則`);
  for (const result of results) {
    const byRule = {};
    for (const item of result.failures) byRule[item.rule] = (byRule[item.rule] ?? 0) + (item.omitted ?? 1);
    const rules = Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([rule, count]) => `${rule}×${count}`).join(" ");
    lines.push(`${pad(result.template, 34)}${pad(`${result.width}${result.label ? `(${result.label})` : ""}`, 12)}${pad(result.stress ? "壓力" : "一般", 6)}${pad(result.schedule ?? "-", 8)}${pad(total(result), 6)}${rules || "通過"}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const widths = args.widths?.length ? args.widths : DEFAULT_WIDTHS;
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const outDir = path.resolve(root, args.out ?? path.join("artifacts", "funnel-template-qa", stamp));
  fs.mkdirSync(outDir, { recursive: true });

  const server = args.baseUrl ? { baseUrl: args.baseUrl, stop: () => {} } : await startMirrorServer();
  const browser = await chromium.launch();
  const results = [];
  try {
    const templates = args.all ? await listAllTemplateIds(browser, server.baseUrl) : args.templates;
    if (!templates.length) throw new Error("沒有可檢查的範本");
    const runs = []; // { width, height, rules, label?, screenshot }
    for (const width of widths) {
      runs.push({ width, height: heightFor(width), rules: width <= 320 ? DEGRADED_RULES : [...FULL_RULES, ...(width === 390 ? ["L-7"] : [])], screenshot: true });
    }
    if (widths.includes(375)) runs.push({ width: 375, height: 667, rules: ["L-7"], label: "375x667", screenshot: false });

    for (const run of runs) {
      const { ua, touch } = userAgentFor(run.width);
      // 不用 isMobile：避免行動版瀏覽器為了容納溢出內容而放大版面，掩蓋水平捲動。
      const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, userAgent: ua, hasTouch: touch, deviceScaleFactor: 1, reducedMotion: "reduce" });
      for (const template of templates) {
        for (const schedule of args.schedules) for (const stress of args.stress ? [false, true] : [false]) {
          if (stress && run.label) continue;
          const rules = stress ? run.rules.filter((rule) => STRESS_RULES.includes(rule)) : run.rules;
          const screenshot = run.screenshot ? path.join(outDir, `${template}@${run.width}${stress ? "-stress" : ""}${schedule ? `~${schedule}` : ""}.${args.jpeg ? "jpg" : "png"}`) : null;
          const options = { baseUrl: server.baseUrl, template, width: run.width, height: run.height, stress, rules, screenshot, schedule };
          let { failures, consoleErrors } = await runCase(context, options);
          // A dev-server compile can race the first hydration; retry once and keep the retry's result.
          if (failures.some((item) => item.rule === "HYDRATION")) ({ failures, consoleErrors } = await runCase(context, options));
          const result = { template, width: run.width, height: run.height, label: run.label ?? null, stress, schedule, rules, failures, consoleErrors: consoleErrors.slice(0, 5), screenshot: screenshot ? path.relative(root, screenshot) : null };
          results.push(result);
          const count = failures.reduce((sum, item) => sum + (item.omitted ?? 1), 0);
          console.log(`${count ? "FAIL" : "PASS"} ${template}@${run.width}${run.label ? `(${run.label})` : ""}${stress ? " stress" : ""}${schedule ? ` ~${schedule}` : ""}${count ? ` — ${count} 項` : ""}`);
          for (const item of failures) console.log(`  [${item.rule}] node=${item.nodeId ?? "-"} type=${item.nodeType ?? "-"} ${item.detail}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }

  const failureCount = results.reduce((sum, result) => sum + result.failures.reduce((inner, item) => inner + (item.omitted ?? 1), 0), 0);
  const report = { generatedAt: new Date().toISOString(), widths, stress: args.stress, failureCount, results };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${summarize(results)}`);
  console.log(`\n共 ${results.length} 個回合，${failureCount} 項失敗。`);
  console.log(`截圖與報告資料夾：${outDir}`);
  process.exitCode = failureCount ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
