import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";

// 真實 React 元件搭配受控合成回應；不連線資料庫或外部 API。
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LiveAdvancedInteractions} from './src/components/live-advanced-interactions';
window.requests=[];
window.checkouts=[];
window.fetch=(url,init={})=>new Promise(resolve=>window.requests.push({url,init,resolve}));
window.answer=(index,payload,status=200)=>window.requests[index].resolve({ok:status<400,status,json:async()=>payload});
const root=createRoot(document.getElementById('root'));
window.renderInteractions=(props)=>root.render(<LiveAdvancedInteractions vendorId="vendor-1" liveId="live-1" currentSeconds={0} events={[]} enabled={false} onCheckout={(productId)=>window.checkouts.push(productId)} {...props}/>);
window.renderInteractions({});
`;
const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html; charset=utf-8");
  response.end(request.url === "/bundle.js" ? built.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const run = (id, title) => ({ id, title, eventType: "poll", status: "active", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 120_000).toISOString(), metadata: { kind: "poll", question: title, durationSec: 120, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, responseCount: 0, responded: false, ownValue: null, pollResults: [{ id: "a", label: "A", votes: 0, percentage: 0 }, { id: "b", label: "B", votes: 0, percentage: 0 }], winner: null, winnerIsViewer: false });
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole("button", { name: "提問", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.requests.length)).toBe(0);
    await page.evaluate(() => window.renderInteractions({ enabled: true }));
    await expect.poll(() => page.evaluate(() => window.requests.length)).toBe(1);
    // 保持第一個請求未完成，跨過輪詢週期，確認沒有重疊請求。
    await page.waitForTimeout(2_200);
    expect(await page.evaluate(() => window.requests.length)).toBe(1);
    await page.evaluate(() => window.renderInteractions({ enabled: true, liveId: "live-2" }));
    await expect.poll(() => page.evaluate(() => window.requests.length)).toBe(2);
    expect(await page.evaluate(() => window.requests[0].init.signal.aborted)).toBe(true);
    await page.evaluate(payload => window.answer(1, payload), { runs: [run("new", "新直播投票")] });
    await expect(page.getByRole("heading", { name: "新直播投票" })).toBeVisible();
    // 即使傳輸層忽略 abort，舊回應也不可覆蓋另一場直播。
    await page.evaluate(payload => window.answer(0, payload), { runs: [run("old", "舊直播投票")] });
    await expect(page.getByRole("heading", { name: "新直播投票" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "舊直播投票" })).toHaveCount(0);
    await page.getByRole("button", { name: /^A\s*0%$/u }).click();
    const responseIndex = await page.evaluate(() => window.requests.findIndex(request => request.init.method === "POST"));
    expect(responseIndex).toBeGreaterThanOrEqual(0);
    const body = await page.evaluate(index => JSON.parse(window.requests[index].init.body), responseIndex);
    expect(body).toEqual({ action: "respond", vendorId: "vendor-1", liveId: "live-2", runId: "new", value: "a" });
    await expect.poll(() => page.evaluate(() => window.requests.findIndex((request, index) => index > 1 && !request.init.method))).toBeGreaterThan(1);
    const pollIndex = await page.evaluate(() => window.requests.findIndex((request, index) => index > 1 && !request.init.method));
    await page.evaluate(({ index, payload }) => window.answer(index, payload), { index: pollIndex, payload: { runs: [run("next", "下一個互動")] } });
    await expect(page.getByRole("heading", { name: "下一個互動" })).toBeVisible();
    expect(await page.evaluate(index => window.requests[index].init.signal.aborted, responseIndex)).toBe(true);
    await page.evaluate(({ index, payload }) => window.answer(index, payload), { index: responseIndex, payload: { run: { ...run("new", "新直播投票"), responded: true, ownValue: "a" } } });
    await expect(page.getByRole("heading", { name: "下一個互動" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "新直播投票" })).toHaveCount(0);
    await page.getByRole("button", { name: /^A\s*0%$/u }).click();
    const nextResponseIndex = await page.evaluate(() => window.requests.findLastIndex(request => request.init.method === "POST"));
    await page.evaluate(({ index, payload }) => window.answer(index, payload), { index: nextResponseIndex, payload: { run: { ...run("next", "下一個互動"), responded: true, ownValue: "a" } } });
    await expect(page.getByRole("button", { name: /^A\s*0%$/u })).toBeDisabled();
    await page.evaluate(() => window.renderInteractions({ enabled: false, liveId: "live-2" }));
    await expect(page.getByTestId("live-advanced-interaction")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "提問", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    results.push({ width, status: "PASS", checks: ["disabled admission", "no overlapping polls", "live switch abort", "stale response ignored", "stale submission ignored", "poll submission", "admission loss unmount"] });
    await page.close();
    const fallbackPage = await browser.newPage({ viewport: { width, height: 900 } });
    await fallbackPage.goto(`http://127.0.0.1:${server.address().port}`);
    await fallbackPage.evaluate(() => window.renderInteractions({ enabled: true, events: [{ id: "script-1", eventType: "poll", title: "Script", triggerSec: 0, metadata: { kind: "poll", durationSec: 120 } }] }));
    await expect.poll(() => fallbackPage.evaluate(() => window.requests.length)).toBe(1);
    await fallbackPage.evaluate(() => window.answer(0, {}, 409));
    await expect.poll(() => fallbackPage.evaluate(() => window.requests.length)).toBe(2);
    await fallbackPage.evaluate(payload => window.answer(1, payload), { runs: [run("manual", "手動投票")], spotlight: { id: "question", body: "精選問題", displayName: "合成觀眾", spotlightedAt: null } });
    await expect(fallbackPage.getByRole("heading", { name: "手動投票" })).toBeVisible();
    await expect(fallbackPage.getByTestId("live-question-spotlight")).toContainText("精選問題");
    await expect.poll(() => fallbackPage.evaluate(() => window.requests.length)).toBe(3);
    await fallbackPage.evaluate(() => window.answer(2, {}, 409));
    await expect.poll(() => fallbackPage.evaluate(() => window.requests.length)).toBe(4);
    await fallbackPage.evaluate(() => window.answer(3, {}, 401));
    await expect(fallbackPage.getByRole("alert")).toContainText("入場驗證已失效");
    await expect(fallbackPage.getByTestId("live-question-spotlight")).toHaveCount(0);
    await expect(fallbackPage.getByTestId("live-advanced-interaction")).toHaveCount(0);
    await expect(fallbackPage.getByRole("button", { name: "提問", exact: true })).toHaveCount(0);
    await fallbackPage.waitForTimeout(2_200);
    expect(await fallbackPage.evaluate(() => window.requests.length)).toBe(4);
    results.push({ width, status: "PASS", checks: ["script 409 still reads manual run and spotlight", "GET 401 immediately hides interactions", "401 stops polling and exposes re-admission"] });
    await fallbackPage.close();
    const salePage = await browser.newPage({ viewport: { width, height: 900 } });
    await salePage.goto(`http://127.0.0.1:${server.address().port}`);
    await salePage.evaluate(() => window.renderInteractions({ enabled: true }));
    await expect.poll(() => salePage.evaluate(() => window.requests.length)).toBe(1);
    const sale = { ...run("sale", "限時商品"), eventType: "flash_sale", metadata: { kind: "flash_sale", durationSec: 120, productId: "bound-product" } };
    await salePage.evaluate(payload => window.answer(0, payload), { runs: [sale] });
    await salePage.getByRole("button", { name: "立即搶購特惠方案" }).click();
    await expect.poll(() => salePage.evaluate(() => window.requests.length)).toBe(2);
    expect(await salePage.evaluate(() => window.checkouts)).toEqual([]);
    await salePage.evaluate(payload => window.answer(1, payload), { run: { ...sale, responded: true } });
    await expect.poll(() => salePage.evaluate(() => window.checkouts)).toEqual(["bound-product"]);
    await salePage.getByRole("button", { name: "立即搶購特惠方案" }).click();
    await expect.poll(() => salePage.evaluate(() => window.checkouts)).toEqual(["bound-product", "bound-product"]);
    expect(await salePage.evaluate(() => window.requests.filter(request => request.init.method === "POST").length)).toBe(1);
    results.push({ width, status: "PASS", checks: ["sale invokes bound product checkout only after successful response", "repeat navigation does not duplicate participation"], limitation: "Checkout callback tested; final server price and stock enforcement pending" });
    await salePage.close();
  }
  fs.mkdirSync(".ai-team/tmp", { recursive: true });
  fs.writeFileSync(".ai-team/tmp/live-advanced-interactions-browser-results.json", JSON.stringify({ scope: "Actual React component in Chromium with controlled synthetic fetch; excludes full server/payment chain and CSS acceptance", results }, null, 2));
  console.log(JSON.stringify({ status: "PASS", scenarios: results.length }));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
