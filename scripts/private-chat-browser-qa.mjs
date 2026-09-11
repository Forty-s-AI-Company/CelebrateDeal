import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

// 真實 React 元件 + 合成 API 邊界；此證據只代表瀏覽器互動，不取代資料庫隔離測試。
const root = process.cwd();
const out = path.join(root, 'docs/live-feature-handoffs');
await fs.mkdir(out, { recursive: true });
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {LiveChatPanel} from './src/components/live-chat-panel';
import {InstructorChatPanel} from './src/components/instructor-chat-panel';
const instructor = location.pathname === '/instructor';
createRoot(document.getElementById('root')).render(instructor ? <InstructorChatPanel liveId="live-a" /> :
<LiveChatPanel enabled admissionStatus="admitted" liveId="live-a" vendorId="tenant-a" scheduledMessages={[]} />);`,
  resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  absWorkingDir: root, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  plugins: [{ name: 'node-resolution', setup(builder) { builder.onResolve({ filter: /.*/ }, args => {
    const resolver = createRequire(path.isAbsolute(args.importer) ? args.importer : path.join(root, 'package.json'));
    const target = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : args.path;
    try { return { path: resolver.resolve(target) }; } catch {
      if (target.startsWith('.') || path.isAbsolute(target)) {
        const base = path.resolve(args.resolveDir || root, target);
        for (const extension of ['.ts', '.tsx']) { try { return { path: resolver.resolve(base + extension) }; } catch {} }
      }
    }
  }); } }],
  define: { 'process.env.NODE_ENV': '"production"' } });
const css = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/live-chat-panel.tsx"; @source "./src/components/instructor-chat-panel.tsx";', { from: path.join(root, 'private-chat-qa.css') });
const rows = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
  if (url.pathname.startsWith('/api/')) {
    const instructor = url.pathname.endsWith('/instructor');
    const owner = instructor ? url.searchParams.get('submissionId') : 'a';
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      const target = instructor ? input.submissionId : 'a';
      let row = rows.find(row => row.id === input.clientMessageId);
      if (!row) { row = { id: input.clientMessageId, owner: target, source: instructor ? 'instructor' : 'viewer',
        body: input.body, createdAt: new Date().toISOString(), actor: { name: instructor ? '講師' : '觀眾 A' } }; rows.push(row); }
      res.end(JSON.stringify(row)); return;
    }
    res.end(JSON.stringify({ conversations: [{ id: 'a', name: '觀眾 A' }, { id: 'b', name: '觀眾 B' }],
      messages: rows.filter(row => row.owner === owner), nextCursor: null, nextConversationCursor: null,
      viewer: { canPost: true, displayName: '觀眾 A', reason: null } })); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;${url.pathname === '/instructor' ? '' : 'background:#172033;color:white'}"><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const receipt = { boundary: 'real-components-synthetic-api', status: 'FAIL', checks: [], consoleErrors: 0 };
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', () => receipt.consoleErrors++);
  await page.goto(base);
  const input = page.getByRole('textbox', { name: '輸入直播留言' });
  await input.waitFor();
  await input.fill('手機私人問題');
  await page.getByRole('button', { name: '送出', exact: true }).click();
  await page.getByRole('log').getByText('手機私人問題', { exact: true }).waitFor();
  await page.waitForTimeout(3200);
  assert.equal(await page.getByRole('log').getByText('手機私人問題', { exact: true }).count(), 1);
  await page.reload();
  await page.getByRole('log').getByText('手機私人問題', { exact: true }).waitFor();
  receipt.checks.push('mobile-send-poll-dedup-reload');
  const manager = await context.newPage();
  manager.on('pageerror', () => receipt.consoleErrors++);
  await manager.goto(`${base}/instructor`);
  await manager.getByRole('button', { name: '觀眾 A', exact: true }).click();
  await manager.getByRole('log').getByText('手機私人問題', { exact: true }).waitFor();
  await manager.getByRole('textbox', { name: '私人回覆' }).fill('只給 A 的回覆');
  await manager.getByRole('button', { name: '送出回覆' }).click();
  await page.getByRole('log').getByText('只給 A 的回覆', { exact: true }).waitFor();
  await manager.getByRole('button', { name: '觀眾 B', exact: true }).click();
  await manager.getByRole('heading', { name: '回覆 觀眾 B' }).waitFor();
  assert.equal(await manager.getByRole('log').getByText('手機私人問題', { exact: true }).count(), 0);
  await manager.getByRole('textbox', { name: '私人回覆' }).fill('只給 B 的回覆');
  await manager.getByRole('button', { name: '送出回覆' }).click();
  await manager.getByRole('log').getByText('只給 B 的回覆', { exact: true }).waitFor();
  await page.waitForTimeout(3200);
  assert.equal(await page.getByRole('log').getByText('只給 B 的回覆', { exact: true }).count(), 0);
  receipt.checks.push('instructor-select-reply-and-switch-reset');
  await context.setOffline(true);
  await input.fill('斷線保留草稿');
  await page.getByRole('button', { name: '送出', exact: true }).click();
  await page.getByRole('button', { name: '重試', exact: true }).waitFor();
  await context.setOffline(false);
  await page.getByRole('button', { name: '重試', exact: true }).click();
  await page.waitForTimeout(3200);
  assert.equal(await page.getByRole('log').getByText('斷線保留草稿', { exact: true }).count(), 1);
  receipt.checks.push('offline-draft-retry');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await input.evaluate(el => getComputedStyle(el).fontSize), '16px');
  await page.screenshot({ path: path.join(out, 'private-chat-mobile.png'), fullPage: true });
  await manager.screenshot({ path: path.join(out, 'private-chat-instructor.png'), fullPage: true });
  assert.equal(receipt.consoleErrors, 0);
  receipt.checks.push('390px-no-horizontal-overflow-16px-input-no-page-errors');
  receipt.status = 'PASS';
} catch (error) { receipt.failure = error.message; process.exitCode = 1; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(out, 'private-chat-browser-evidence.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
