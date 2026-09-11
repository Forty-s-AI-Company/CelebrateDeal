import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 真實 LivePlayback、卡片、HTML video 解碼/seek；僅 API 與非本功能的側欄為合成邊界。
const root = process.cwd();
const out = path.join(root, 'docs/live-feature-handoffs');
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {LivePlayback} from './src/components/live-playback';
import {InstructorInteractionCards} from './src/components/instructor-interaction-cards';
const live={id:'live-a',vendorId:'tenant-a',title:'Timeline video',slug:'timeline',status:'ended',runtimeState:'replay',videoUrl:location.origin+'/media.webm',description:null,accentCopy:null,heroImageUrl:null,brand:{name:'Timeline',logoUrl:null,primaryColor:'#111',ctaColor:'#fff'},form:null,interactionEvents:[],products:[]};
createRoot(document.getElementById('root')).render(location.pathname==='/instructor'?<InstructorInteractionCards liveId='live-a'/>:<LivePlayback live={live}/>);`,
  resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  absWorkingDir: root, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  plugins: [{ name: 'fixture-resolution', setup(builder) {
    builder.onResolve({ filter: /^(next\/(navigation|image)|@\/components\/(lead-form|live-chat-panel|live-advanced-interactions|live-purchase-ticker))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'next/navigation'
      ? "const router={refresh(){},back(){},push(){}}; export const useRouter=()=>router; export const usePathname=()=>'/live/timeline';"
      : args.path === 'next/image' ? 'export default function Image(){return null}'
        : 'export const LeadForm=()=>null; export const LiveChatPanel=()=>null; export const LiveAdvancedInteractions=()=>null; export const LivePurchaseTicker=()=>null;' }));
    builder.onResolve({ filter: /.*/ }, args => {
      const resolver = createRequire(path.isAbsolute(args.importer) ? args.importer : path.join(root, 'package.json'));
      const target = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : args.path;
      try { return { path: resolver.resolve(target) }; } catch {
        if (target.startsWith('.') || path.isAbsolute(target)) {
          const base = path.resolve(args.resolveDir || root, target);
          for (const extension of ['.ts', '.tsx']) { try { return { path: resolver.resolve(base + extension) }; } catch {} }
        }
      }
    });
  } }], define: { 'process.env.NODE_ENV': '"production"' } });
const config = { version: 1, kind: 'interaction_card', answerType: 'text', visibility: 'instructor_only', options: [], schedule: { enabled: true, startSeconds: 1, durationSeconds: 1 } };
const scheduled = { id: 'scheduled', title: '影片一秒題', status: 'draft', configuration: config, ownValue: null, startsAt: null, endsAt: null, answers: [], options: [], responseCount: 0 };
let manual = null; let mode = 'personal'; let sharedPosition = 1.2; let unavailable = false; let responseCount = 0; let media = Buffer.alloc(0);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === '/media.webm') {
    res.setHeader('Content-Type', 'video/webm'); res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    const start = range ? Number(range[1]) : 0; const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${media.length}`); }
    const chunk = media.subarray(start, end + 1); res.setHeader('Content-Length', chunk.length); res.end(chunk); return;
  }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (!url.pathname.includes('/cards')) { res.end('{}'); return; }
    if (unavailable) { res.statusCode = 503; res.end('{}'); return; }
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      if (input.action === 'schedule') scheduled.configuration.schedule = input.schedule;
      else if (input.action === 'end') scheduled.status = 'closed';
      else if (!input.action) {
        assert.ok(input.positionSeconds >= 1 && input.positionSeconds < 2);
        if (scheduled.ownValue === null) { responseCount++; scheduled.ownValue = input.value; }
      }
      res.end(JSON.stringify({ card: scheduled })); return;
    }
    res.end(JSON.stringify(url.searchParams.get('mode') === 'instructor'
      ? { cards: [scheduled], timelineCapability: { enabled: true, durationSeconds: 4 } }
      : { card: manual, timeline: { clock: { mode, positionSeconds: mode === 'synchronized' ? sharedPosition : null }, cards: [scheduled] } })); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const receipt = { boundary: 'real LivePlayback, HTMLVideoElement decoded WebM and card components; synthetic API and unrelated panels; Edge desktop', status: 'FAIL', checks: [], pageErrors: 0 };
let browser; let page;
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const maker = await browser.newPage();
  const bytes = await maker.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }); const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => recorder.onstop = resolve);
    recorder.start(); let frame = 0;
    const timer = setInterval(() => { ctx.fillStyle = '#172033'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = 'white'; ctx.fillText(`Timeline ${frame++}`, 20, 90); }, 100);
    await new Promise(resolve => setTimeout(resolve, 4100)); recorder.stop(); await stopped; clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  media = Buffer.from(bytes); await maker.close();
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', () => receipt.pageErrors++);
  await page.goto(base);
  receipt.phase = 'metadata';
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  const visible = page.getByRole('complementary', { name: '畫面內互動卡片' });
  async function seek(seconds) {
    receipt.phase = `seek-${seconds}`;
    await page.locator('video').evaluate((video, time) => { video.pause(); video.currentTime = time; }, seconds);
    await page.waitForFunction(time => { const video = document.querySelector('video'); return !video.seeking && Math.abs(video.currentTime - time) < 0.1; }, seconds);
  }
  await seek(0); await page.waitForTimeout(1700); assert.equal(await visible.count(), 0);
  await seek(1.2); await visible.waitFor(); await page.waitForTimeout(1700); assert.equal(await visible.count(), 1);
  receipt.checks.push('real media seek triggers; paused position does not advance with wall time');
  await page.getByRole('textbox', { name: '你的回答' }).fill('保留同一回答'); await page.getByRole('button', { name: '送出回答' }).click();
  await page.getByText('已回答：保留同一回答').waitFor(); await seek(2.5); await visible.waitFor({ state: 'detached' });
  await seek(1.3); await page.getByText('已回答：保留同一回答').waitFor(); assert.equal(responseCount, 1);
  await seek(0); await visible.waitFor({ state: 'detached' }); await seek(1.2); await visible.waitFor();
  receipt.checks.push('fast forward expires; rewind/replay preserve the single recorded answer');
  unavailable = true; await visible.waitFor({ state: 'detached', timeout: 8000 }); unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await visible.waitFor();
  receipt.checks.push('offline lease hides stale cards; reconnect samples current media');
  mode = 'synchronized'; sharedPosition = 1.2; await seek(0); await visible.waitFor();
  await page.waitForTimeout(1700); assert.equal(await visible.count(), 1);
  sharedPosition = 2.5; await visible.waitFor({ state: 'detached', timeout: 5000 });
  receipt.checks.push('synchronized selection follows server position despite paused media at zero; late expiration');
  mode = 'personal'; await seek(1.2); await visible.waitFor();
  manual = { ...scheduled, id: 'manual', title: '手動優先', status: 'active', configuration: { ...config, schedule: undefined } };
  await page.getByText('手動優先', { exact: true }).waitFor();
  manual = null; await page.getByText('影片一秒題', { exact: true }).waitFor();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await visible.waitFor();
  receipt.checks.push('manual precedence and resume valid schedule; visibility restore refreshes');
  const manager = await browser.newPage(); manager.on('pageerror', () => receipt.pageErrors++); await manager.goto(`${base}/instructor`);
  await manager.getByLabel('出現時間', { exact: true }).fill('00:02');
  await manager.getByLabel('持續時間', { exact: true }).fill('1');
  await manager.getByLabel('預覽播放時間').fill('2'); await manager.getByText('預覽卡片：影片一秒題').waitFor();
  await manager.getByRole('button', { name: '儲存並啟用排程' }).click(); await manager.getByText('已儲存：2～3 秒 · 已啟用').waitFor();
  await manager.reload(); await manager.getByText('已儲存：2～3 秒 · 已啟用').waitFor();
  await manager.getByLabel('持續時間', { exact: true }).fill('99'); assert.equal(await manager.getByRole('button', { name: '儲存並啟用排程' }).isDisabled(), true);
  await manager.getByRole('button', { name: '停用排程', exact: true }).click(); await manager.getByText('已儲存：2～3 秒 · 已停用').waitFor();
  receipt.checks.push('instructor preview, save, reload, validation and disable use existing cards');
  assert.equal(receipt.pageErrors, 0); receipt.status = 'PASS';
} catch (error) { receipt.failure = error.message; receipt.media = await page?.locator('video').evaluate(video => ({ readyState: video.readyState, currentTime: video.currentTime, duration: video.duration, seeking: video.seeking, error: video.error?.code, ranges: Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)]) })).catch(() => null); }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.writeFile(path.join(out, 'interaction-timeline-browser-evidence.json'), JSON.stringify(receipt, null, 2)); }
console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
