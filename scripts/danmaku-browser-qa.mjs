import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

// Real client components, synthetic HTTP boundary, no external service or credentials.
const root = process.cwd();
const out = path.join(root, 'docs/live-feature-handoffs');
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {LiveDanmaku,InstructorDanmakuSwitch} from './src/components/live-danmaku';
import {LiveInteractionCard} from './src/components/live-interaction-card';
import {LiveViewingShell} from './src/components/live-viewing-shell';
createRoot(document.getElementById('root')).render(location.pathname.startsWith('/instructor') ? <InstructorDanmakuSwitch liveId="live-a"/> :
<LiveViewingShell checkout={false} orientation={location.search ? "landscape" : "portrait"} className="bg-slate-950 text-white"><video controls playsInline className="live-viewing-player" style={{background:'#172033'}} aria-label="播放器"/><div className="browser-live-interactions relative flex flex-col"><LiveDanmaku enabled vendorId="tenant-a" liveId="live-a"/><LiveInteractionCard enabled vendorId="tenant-a" liveId="live-a"/></div></LiveViewingShell>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic', absWorkingDir: root,
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  plugins: [{ name: 'resolve', setup(builder) { builder.onResolve({ filter: /.*/ }, args => {
    const resolver = createRequire(path.isAbsolute(args.importer) ? args.importer : path.join(root, 'package.json'));
    const target = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : args.path;
    try { return { path: resolver.resolve(target) }; } catch {
      if (target.startsWith('.') || path.isAbsolute(target)) for (const extension of ['.ts', '.tsx']) { try { return { path: resolver.resolve(path.resolve(args.resolveDir || root, target) + extension) }; } catch {} }
    }
  }); } }], define: { 'process.env.NODE_ENV': '"production"' } });
const globals = await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8');
const css = await postcss([tailwind()]).process(globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none); @source "./src/components/live-danmaku.tsx"; @source "./src/components/live-interaction-card.tsx"; @source "./src/components/live-viewing-shell.tsx"; @source "./src/components/live-playback.tsx";'), { from: path.join(root, 'danmaku-qa.css') });
let state = { enabled: false, epoch: 'off', since: new Date().toISOString() };
let items = []; let offline = false; let serial = 0;
const publish = (value) => { items.push({ id: String(++serial), value, displayName: '觀眾', createdAt: new Date().toISOString() }); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.includes('cards')) { res.end(JSON.stringify({ card: { id: 'card', title: '互動卡片安全區', status: 'active', configuration: { version: 1, kind: 'interaction_card', answerType: 'text', visibility: 'instructor_only', options: [] }, ownValue: null } })); return; }
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      state = { enabled: JSON.parse(raw).enabled, epoch: String(++serial), since: new Date().toISOString() }; items = [];
      res.end(JSON.stringify({ state })); return;
    }
    if (offline && url.searchParams.get('mode') !== 'instructor') { res.statusCode = 503; res.end('{}'); return; }
    const cursor = url.searchParams.get('cursor');
    res.end(JSON.stringify({ state, cursor: new Date().toISOString(), items: state.enabled && cursor && url.searchParams.get('epoch') === state.epoch ? items.filter(item => item.createdAt >= cursor).slice(-20) : [] })); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const receipt = { boundary: 'real React components; synthetic API; Edge mobile viewport, not physical devices', status: 'FAIL', checks: [], pageErrors: 0 };
try { receipt.previousAttempts = [JSON.parse(await fs.readFile(path.join(out, 'danmaku-browser-evidence.json'), 'utf8'))]; } catch { /* First run. */ }
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const viewer = await context.newPage(); const manager = await context.newPage(); const studio = await context.newPage();
  for (const page of [viewer, manager, studio]) page.on('pageerror', () => receipt.pageErrors++);
  await viewer.goto(base); await manager.goto(`${base}/instructor`); await studio.goto(`${base}/instructor-studio`);
  await manager.getByRole('button', { name: '開啟全場彈幕' }).click();
  await studio.getByRole('button', { name: '關閉全場彈幕' }).waitFor();
  await viewer.getByText('公開卡片回答會在這裡出現').waitFor();
  publish('手機公開鼓勵'); await viewer.getByText('觀眾：手機公開鼓勵').waitFor();
  const strip = await viewer.getByRole('complementary', { name: '公開互動彈幕' }).boundingBox();
  const video = await viewer.getByLabel('播放器').boundingBox();
  const card = await viewer.getByRole('complementary', { name: '畫面內互動卡片' }).boundingBox();
  receipt.bounds = { strip, video, card };
  await viewer.screenshot({ path: path.join(out, 'danmaku-mobile.png') });
  assert.ok(strip.y >= video.y + video.height); assert.ok(strip.y + strip.height <= card.y);
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await viewer.screenshot({ path: path.join(out, 'danmaku-mobile.png') });
  receipt.checks.push('mobile-public-message-no-overlap-with-video-controls-or-card');
  await viewer.getByRole('button', { name: '隱藏彈幕' }).click();
  await studio.getByRole('button', { name: '關閉全場彈幕' }).click();
  await manager.getByRole('button', { name: '開啟全場彈幕' }).waitFor();
  await manager.getByRole('button', { name: '開啟全場彈幕' }).click();
  await studio.getByRole('button', { name: '關閉全場彈幕' }).waitFor();
  publish('hidden'); await viewer.waitForTimeout(2200);
  assert.equal(await viewer.locator('.danmaku-message').count(), 0);
  await viewer.reload(); await viewer.getByRole('button', { name: '顯示彈幕' }).waitFor();
  await viewer.getByRole('button', { name: '顯示彈幕' }).click();
  await viewer.waitForTimeout(4300); assert.equal(await viewer.locator('.danmaku-message').count(), 0);
  receipt.checks.push('two-instructor-entrances-sync-and-personal-preference-persists-through-reopen-and-reload');
  for (let i = 0; i < 100; i++) publish(`burst-${i}`);
  await viewer.locator('.danmaku-message').waitFor(); assert.equal(await viewer.locator('.danmaku-message').count(), 1);
  await studio.getByRole('button', { name: '關閉全場彈幕' }).click();
  await viewer.getByText('全場彈幕尚未開啟或正在同步').waitFor(); assert.equal(await viewer.locator('.danmaku-message').count(), 0);
  await studio.getByRole('button', { name: '開啟全場彈幕' }).click();
  await viewer.getByText('公開卡片回答會在這裡出現').waitFor(); await viewer.waitForTimeout(4000);
  assert.equal(await viewer.locator('.danmaku-message').count(), 0);
  receipt.checks.push('burst-density-one-off-clears-backlog-reopen-no-old-messages');
  offline = true; await viewer.getByText('全場彈幕尚未開啟或正在同步').waitFor(); publish('offline-old'); offline = false;
  await viewer.getByText('公開卡片回答會在這裡出現').waitFor(); await viewer.waitForTimeout(4000);
  assert.equal(await viewer.locator('.danmaku-message').count(), 0);
  await viewer.emulateMedia({ reducedMotion: 'reduce' }); await viewer.setViewportSize({ width: 844, height: 390 });
  publish('減少動態效果'); await viewer.getByText('觀眾：減少動態效果').waitFor();
  assert.equal(await viewer.locator('.danmaku-message').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await viewer.screenshot({ path: path.join(out, 'danmaku-landscape.png') });
  receipt.checks.push('reconnect-drops-history-landscape-reduced-motion-no-overflow');
  await viewer.goto(`${base}?orientation=landscape`); await viewer.getByText('公開卡片回答會在這裡出現').waitFor();
  publish('長'.repeat(160)); await viewer.locator('.danmaku-message').waitFor();
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const target = await viewer.getByRole('button', { name: '隱藏彈幕' }).boundingBox(); assert.ok(target.height >= 44);
  await viewer.getByRole('button', { name: '頁內全螢幕', exact: true }).click();
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await viewer.screenshot({ path: path.join(out, 'danmaku-horizontal-fullscreen.png') });
  receipt.checks.push('horizontal-source-160-character-message-page-fullscreen-44px-controls');
  assert.equal(receipt.pageErrors, 0); receipt.status = 'PASS';
} catch (error) { receipt.error = error.message; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.writeFile(path.join(out, 'danmaku-browser-evidence.json'), JSON.stringify(receipt, null, 2)); }
console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
