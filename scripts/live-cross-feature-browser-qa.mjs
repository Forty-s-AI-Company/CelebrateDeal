import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

// Executed only by the owning disposable runner. Real components -> HTTP routes -> domain -> DB.
// The HTTP adapter replaces Next routing; manager login, trusted IP and limiter are synthetic.
const root = process.cwd();
const client = process.env.LIVE_QA_PRISMA_CLIENT;
const marker = process.env.LIVE_QA_DATABASE_MARKER;
const videoFixture = process.argv.find(arg => arg.startsWith('--video-fixture='))?.slice('--video-fixture='.length);
if (!videoFixture || !path.resolve(videoFixture).startsWith(path.join(root, 'tmp') + path.sep)) throw new Error('SYNTHETIC_VIDEO_REQUIRED');
const videoBytes = fs.readFileSync(videoFixture);
if (!client || !path.resolve(client).startsWith(path.join(root, 'tmp') + path.sep) || !/^live-integration:[a-f0-9-]+$/.test(marker ?? '')) throw new Error('OWNED_RUNNER_REQUIRED');
const out = path.join(root, 'docs/live-feature-handoffs/integration-20260912');
const temp = fs.mkdtempSync(path.join(root, 'tmp/live-browser-'));
const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(client, 'index.js'));
const db = new PrismaClient();
const [{ marker: actual }] = await db.$queryRaw`SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
assert.equal(actual, marker, 'fresh database ownership marker');
const authContext = new AsyncLocalStorage();
globalThis.__liveIntegrationQa = { db, authContext };
const backend = await build({ stdin: { contents: `
export * as chat from './src/app/api/live-chat/messages/route';
export * as instructor from './src/app/api/live-chat/instructor/route';
export * as cards from './src/app/api/live-interactions/cards/route';
export * as legacy from './src/app/api/live-interactions/route';
export * as danmaku from './src/app/api/live-danmaku/route';
export * as roles from './src/app/api/live-danmaku/scripted/route';
export {createFormSubmissionChatSessionToken,FORM_SUBMISSION_CHAT_SESSION_COOKIE} from './src/lib/form-submission-chat-session';
export {hashLiveViewerToken,LIVE_VIEWER_SESSION_COOKIE} from './src/lib/live-quota-admission';`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', alias: { '@prisma/client': path.join(client, 'index.js') }, plugins: [{ name: 'explicit-boundaries', setup(b) {
  const mocks = {
    '@/lib/db': 'export const getDb=()=>globalThis.__liveIntegrationQa.db;',
    '@/lib/auth': 'export const getCurrentAuth=async()=>globalThis.__liveIntegrationQa.authContext.getStore()??null;',
    '@/lib/rate-limit': 'export const checkRateLimit=async()=>null;',
    '@/lib/request-client-ip': `export * from ${JSON.stringify(path.join(root, 'src/lib/request-client-ip.ts'))}; export const getRequestClientIp=()=>"203.0.113.7";`,
  };
  b.onResolve({ filter: /^@\// }, args => args.path in mocks ? { path: args.path, namespace: 'qa' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: mocks[args.path], resolveDir: root }));
} }] });
const backendPath = path.join(temp, 'backend.cjs'); fs.writeFileSync(backendPath, backend.outputFiles[0].text);
const api = require(backendPath);
const id = randomUUID();
const vendor = await db.vendor.create({ data: { name: 'Integration browser', slug: id, email: `${id}@example.test`, passwordHash: 'synthetic' } });
const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: 'Fixture', slug: randomUUID(), headline: 'Fixture', fields: [] } });
const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: 'Integrated live', slug: randomUUID(), scheduledAt: new Date(), streamMode: 'live', status: 'live' } });
const scope = { vendorId: vendor.id, liveId: live.id };
const identities = await Promise.all(['A', 'B'].map(async name => {
  const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name, email: `${name}-${id}@example.test`, verificationStatus: 'VERIFIED' } });
  const token = randomBytes(32).toString('base64url'); const now = new Date();
  await db.liveViewerSession.create({ data: { ...scope, tokenHash: api.hashLiveViewerToken(token), lastSeenAt: now, expiresAt: new Date(now.getTime() + 600000) } });
  return { submission, token, chat: api.createFormSubmissionChatSessionToken({ submissionId: submission.id, now }) };
}));
const ui = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
import{InstructorChatPanel}from'./src/components/instructor-chat-panel';import{LivePlayback}from'./src/components/live-playback';
const scope=${JSON.stringify(scope)};
const live={id:scope.liveId,vendorId:scope.vendorId,title:'Integrated live',slug:'integration',status:'live',runtimeState:'playing',admissionRequired:false,chatEnabled:true,videoUrl:location.origin+'/video.mp4',orientation:'landscape',description:null,accentCopy:null,heroImageUrl:null,brand:{name:'CelebrateDeal',logoUrl:null,primaryColor:'#2563eb',ctaColor:'#fff'},form:null,interactionEvents:[],products:[]};
function App(){return location.pathname==='/instructor'?<InstructorChatPanel liveId={scope.liveId}/>:<LivePlayback live={live}/>};
const root=createRoot(document.getElementById('root'));root.render(<App/>);window.qaUnmount=()=>root.unmount();`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, tsconfigRaw: { compilerOptions: { paths: { '@/*': ['./src/*'] } } }, plugins: [{ name: 'outer-shell-boundaries', setup(b) {
  b.onResolve({ filter: /^(next\/(navigation|image)|@\/components\/(lead-form|live-advanced-interactions|live-purchase-ticker))$/ }, args => ({ path: args.path, namespace: 'outer' }));
  b.onLoad({ filter: /.*/, namespace: 'outer' }, args => ({ contents: args.path === 'next/navigation' ? "const router={refresh(){},back(){},push(){}};export const useRouter=()=>router;export const usePathname=()=>'/live/integration';" : args.path === 'next/image' ? 'export default function Image(){return null}' : 'export const LeadForm=()=>null;export const LiveAdvancedInteractions=()=>null;export const LivePurchaseTicker=()=>null;' }));
} }] });
// Restrict scanning to these real components; temporary source mirrors must not multiply CSS work.
const style = fs.readFileSync('src/app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none); @source "../components/live-chat-panel.tsx"; @source "../components/instructor-chat-panel.tsx"; @source "../components/live-interaction-card.tsx"; @source "../components/live-danmaku.tsx"; @source "../components/live-viewing-shell.tsx"; @source "../components/live-playback.tsx";');
const css = await postcss([tailwind()]).process(style, { from: path.join(root, 'src/app/globals.css') });
const routes = { '/api/live-chat/messages': api.chat, '/api/live-chat/instructor': api.instructor, '/api/live-interactions/cards': api.cards, '/api/live-interactions': api.legacy, '/api/live-danmaku': api.danmaku, '/api/live-danmaku/scripted': api.roles };
const receipt = { startedAt: new Date().toISOString(), status: 'FAIL', boundary: 'real LivePlayback + local MP4 + HTTP adapter + app chat/cards/danmaku API/domain + owned PostgreSQL; synthetic manager auth/IP/limiter and precreated admission; mocked Next navigation/image, ancillary form/advanced interactions/purchase ticker and analytics/usage/attribution; no full Next login/external media E2E', videoSha256: createHash('sha256').update(videoBytes).digest('hex'), checks: [], pageErrors: [] };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/video.mp4') { res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Content-Length', videoBytes.length); res.end(videoBytes); return; }
    if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(ui.outputFiles[0].text); return; }
    if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
    if (url.pathname.startsWith('/api/')) {
      if (['/api/analytics', '/api/stream-usage', '/api/affiliate-attribution/direct-entry'].includes(url.pathname)) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, allowed: true })); return; }
      const route = routes[url.pathname]; if (!route?.[req.method]) { res.writeHead(404); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const role = req.headers['x-qa-role'];
      const auth = role ? { vendor: { id: vendor.id }, user: { id: 'synthetic-manager' }, member: { id: 'synthetic-manager', role, status: 'active' } } : null;
      const response = await authContext.run(auth, () => route[req.method](request));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  } catch { res.writeHead(500); res.end('QA_HANDLER_FAILED'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const executablePath = process.argv.find(arg => arg.startsWith('--browser-executable='))?.slice('--browser-executable='.length);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'msedge' }), headless: true });
  receipt.browser = { engine: 'Chromium', version: browser.version(), executable: executablePath ?? 'msedge channel' };
  const viewerContexts = await Promise.all(identities.map(async identity => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // These are newly generated fixture identities; no user browser state is read.
    await context.addCookies([{ name: api.LIVE_VIEWER_SESSION_COOKIE, value: identity.token, url: base }, { name: api.FORM_SUBMISSION_CHAT_SESSION_COOKIE, value: identity.chat, url: base }]);
    return context;
  }));
  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-qa-role': 'owner' } });
  const [a, b] = await Promise.all(viewerContexts.map(context => context.newPage()));
  const manager = await managerContext.newPage();
  for (const page of [a, b, manager]) { page.on('pageerror', e => receipt.pageErrors.push(e.message)); await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort()); }
  await Promise.all([a.goto(base), b.goto(base), manager.goto(`${base}/instructor`)]);
  for (const page of [a, b]) {
    await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.2);
  }
  receipt.checks.push('real LivePlayback decodes and advances local synthetic MP4 in both viewer contexts');
  const post = async (endpoint, body) => {
    const response = await managerContext.request.post(`${base}${endpoint}`, { headers: { origin: base, 'x-celebratedeal-client': 'web' }, data: body });
    assert.equal(response.status(), 200, `manager ${endpoint}`); return response.json();
  };
  for (const [page, name] of [[a, 'A'], [b, 'B']]) {
    const input = page.getByRole('textbox', { name: '輸入直播留言' }); await input.fill(`PRIVATE ${name}`);
    await page.getByRole('button', { name: '送出', exact: true }).click();
    await page.getByRole('log').getByText(`PRIVATE ${name}`, { exact: true }).waitFor();
    await manager.getByRole('button', { name, exact: true }).click();
    await manager.getByRole('textbox', { name: '私人回覆' }).fill(`REPLY ${name}`);
    await manager.getByRole('button', { name: '送出回覆' }).click();
    await page.getByRole('log').getByText(`REPLY ${name}`, { exact: true }).waitFor();
  }
  for (const [page, other] of [[a, 'B'], [b, 'A']]) assert.equal(await page.getByRole('log').getByText(new RegExp(`PRIVATE ${other}|REPLY ${other}`)).count(), 0);
  receipt.checks.push('two real browser contexts: private chat and instructor replies persist in DB and remain isolated');
  const config = { version: 1, kind: 'interaction_card', answerType: 'text', visibility: 'instructor_only', options: [] };
  const card = async (title, configuration) => {
    const result = await post('/api/live-interactions/cards?mode=instructor', { action: 'create', liveId: live.id, title, configuration });
    await post('/api/live-interactions/cards?mode=instructor', { action: 'start', liveId: live.id, runId: result.card.id }); return result.card;
  };
  const privateCard = await card('私人問題', config);
  await a.getByLabel('你的回答').fill('PRIVATE CARD A'); await a.getByRole('button', { name: '送出回答' }).click();
  await a.getByText('已回答：PRIVATE CARD A', { exact: true }).waitFor();
  await b.getByText('私人問題', { exact: true }).waitFor(); assert.equal(await b.getByText('PRIVATE CARD A', { exact: false }).count(), 0);
  const legacy = await viewerContexts[1].request.post(`${base}/api/live-interactions`, { headers: { origin: base, 'x-celebratedeal-client': 'web' }, data: { ...scope, action: 'respond', runId: privateCard.id, value: 'bypass' } });
  assert.equal(legacy.status(), 409);
  receipt.checks.push('private card isolation and real legacy API bypass rejection');
  // A request that never replies used to keep inFlight=true forever. Abort must allow polling to recover.
  let hangs = 0;
  await a.route('**/api/live-interactions/cards?*', async route => { if (hangs++ === 0) await new Promise(resolve => setTimeout(resolve, 15000)); await route.continue().catch(() => {}); });
  await a.reload();
  await a.getByText('已回答：PRIVATE CARD A', { exact: true }).waitFor({ timeout: 9000 });
  assert.ok(hangs >= 2, 'stalled card request must time out and a subsequent poll must succeed');
  await a.unroute('**/api/live-interactions/cards?*');
  receipt.checks.push('stalled card GET cancelled; subsequent poll recovers persisted own answer');
  await post('/api/live-danmaku?mode=instructor', { liveId: live.id, enabled: true });
  await b.getByText('公開卡片回答與暖場角色會在這裡出現', { exact: true }).waitFor();
  const publicCard = await card('公開問題', { ...config, visibility: 'public_display' });
  await a.getByText('公開問題', { exact: true }).waitFor(); await a.getByLabel('你的回答').fill('PUBLIC ENCOURAGEMENT');
  await a.getByRole('button', { name: '送出回答' }).click();
  await b.locator('.danmaku-message').getByText('觀眾：PUBLIC ENCOURAGEMENT', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await db.liveInteractionResponse.count({ where: { runId: publicCard.id } }), 1);
  assert.equal(await b.locator('.danmaku-message').getByText(/PRIVATE|REPLY/).count(), 0);
  await b.getByRole('button', { name: '隱藏彈幕', exact: true }).click(); await b.reload();
  await b.getByRole('button', { name: '顯示彈幕', exact: true }).waitFor();
  await post('/api/live-danmaku?mode=instructor', { liveId: live.id, enabled: false });
  await a.getByText('全場彈幕尚未開啟或正在同步', { exact: true }).waitFor();
  receipt.checks.push('public answer travels through real DB feed; private data excluded; instructor and persistent viewer switches');
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await a.setViewportSize(viewport); await a.getByRole('button', { name: '頁內全螢幕', exact: true }).click();
    await a.getByRole('button', { name: '退出頁內全螢幕', exact: true }).waitFor();
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.keyboard.press('Escape');
  }
  await a.screenshot({ path: path.join(out, 'integrated-viewer.png'), fullPage: true });
  await manager.screenshot({ path: path.join(out, 'integrated-instructor.png'), fullPage: true });
  receipt.checks.push('390x844, 844x390, 1440x900 real composed UI and page fullscreen without overflow');
  await Promise.all([a, b, manager].map(page => page.evaluate(() => window.qaUnmount())));
  assert.deepEqual(receipt.pageErrors, []); receipt.status = 'PASS';
} catch (error) { receipt.failure = error.message; process.exitCode = 1; }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.$disconnect();
  delete globalThis.__liveIntegrationQa;
  receipt.finishedAt = new Date().toISOString();
  const file = path.join(out, `integrated-browser-${Date.now()}.json`); fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
