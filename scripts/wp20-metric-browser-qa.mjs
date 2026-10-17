import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const root = process.cwd();
const evidence = path.join(root, 'docs/ai-team/evidence/product-audit-20261011/WP-20/player-browser');
fs.mkdirSync(evidence, { recursive: true });
const receipt = { status: 'FAIL', scope: 'Owned loopback page, generated canvas video, synthetic transport; no application credentials', checks: {}, metrics: null };
let browser; let server;
try {
 const bundle = await build({ stdin: { contents: 'export { createMetricCollector } from "./src/lib/live-metric-collector.ts";', resolveDir: root, loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', globalName: 'MetricTest', write: false, logLevel: 'silent' });
 server = http.createServer((req, res) => {
  if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(bundle.outputFiles[0].text); }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><video muted playsinline></video><script src="/bundle.js"></script>'); }
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 browser = await chromium.launch({ headless: true });
 const context = await browser.newContext();
 await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
 const page = await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 receipt.metrics = await page.evaluate(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30); const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  recorder.ondataavailable = event => chunks.push(event.data);
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  let frame = 0; const draw = setInterval(() => { ctx.fillStyle = frame++ % 2 ? 'red' : 'blue'; ctx.fillRect(0, 0, 160, 90); }, 33);
  recorder.start(); await wait(4000); recorder.stop(); await stopped; clearInterval(draw); stream.getTracks().forEach(track => track.stop());
  const video = document.querySelector('video'); const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); video.src = url;
  await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('synthetic-media-failed')); });
  const rows = []; const closes = []; let timeupdates = 0; video.addEventListener('timeupdate', () => timeupdates++);
  const collector = MetricTest.createMetricCollector({
   open: async () => ({ ok: true, sessionId: 'synthetic', versionId: 'synthetic', anchorAtMs: 10000, serverNowAtMs: 10000, expiresAtMs: 100000, lastSequence: -1, lastElapsedMs: 0, durationMs: null }),
   session: () => ({ append: async batch => { rows.push(...batch); return { ok: true, lastSequence: batch.at(-1).sequence }; }, close: async sequence => { closes.push(sequence); return { terminal: true }; } }),
  }, 'de305d54-75b4-431b-adb2-eb6b9e546014', video, () => performance.now());
  await collector.tick(); await video.play(); await wait(2400); video.pause(); const pausedAt = video.currentTime;
  await collector.tick(); const rowsBeforePause = rows.length; await wait(500); await collector.tick();
  const rowsAfterPause = rows.length; await collector.finish();
  const completeRows = []; const completeCloses = [];
  const seeked = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true })); video.currentTime = 0; await seeked;
  const completeCollector = MetricTest.createMetricCollector({
   open: async () => ({ ok: true, sessionId: 'complete', versionId: 'synthetic', anchorAtMs: 10000, serverNowAtMs: 10000, expiresAtMs: 100000, lastSequence: -1, lastElapsedMs: 0, durationMs: null }),
   session: () => ({ append: async batch => { completeRows.push(...batch); return { ok: true, lastSequence: batch.at(-1).sequence }; }, close: async sequence => { completeCloses.push(sequence); return { terminal: true }; } }),
  }, 'de305d54-75b4-431b-adb2-eb6b9e546014', video, () => performance.now());
  await completeCollector.tick(); const ended = new Promise(resolve => video.addEventListener('ended', resolve, { once: true })); await video.play(); await ended; await completeCollector.finish();
  const completeMediaMs = Math.round(video.currentTime * 1000); const completeRecordedMs = completeRows.reduce((sum, row) => sum + row.mediaEndMs - row.mediaStartMs, 0);
  URL.revokeObjectURL(url);
  return { completeMediaMs, completeRecordedMs, completeCloseCount: completeCloses.length, timeupdates, segments: rows.length, observedMediaMs: Math.round(pausedAt * 1000), recordedMs: rows.reduce((sum, row) => sum + row.endElapsedMs - row.startElapsedMs, 0), rowsBeforePause, rowsAfterPause, closeCount: closes.length, terminal: collector.state().delivery?.terminal === true };
 });
 const m = receipt.metrics;
 receipt.checks = { fullPlaybackReaches90PercentCoverage: m.completeRecordedMs >= m.completeMediaMs * 0.9, fullPlaybackClosesOnce: m.completeCloseCount === 1, producesSegments: m.segments > 0, capturesAtLeast80PercentOfContinuousPlayback: m.recordedMs >= m.observedMediaMs * 0.8, pauseAddsNoSegments: m.rowsBeforePause === m.rowsAfterPause, closesOnce: m.closeCount === 1 && m.terminal };
 receipt.status = Object.values(receipt.checks).every(Boolean) ? 'PASS' : 'FAIL';
} catch (error) { receipt.failure = error?.name ?? 'UnknownError'; }
finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
