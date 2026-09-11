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
import {LiveInteractionCard} from './src/components/live-interaction-card';
import {InstructorInteractionCards} from './src/components/instructor-interaction-cards';
const instructor = location.pathname === '/instructor';
createRoot(document.getElementById('root')).render(instructor ? <InstructorInteractionCards liveId="live-a" /> :
<div style={{position:'relative',height:'100dvh',background:'#172033'}}><video playsInline aria-label="頁內影片" style={{width:'100%',height:'100%',objectFit:'contain'}} /><LiveInteractionCard enabled liveId="live-a" vendorId="tenant-a" /></div>);`,
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
const css = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/live-interaction-card.tsx"; @source "./src/components/instructor-interaction-cards.tsx";', { from: path.join(root, 'interaction-card-qa.css') });
const cards = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      if (input.action === 'create') cards.unshift({id: String(cards.length + 1), title: input.title, configuration: input.configuration, status:'draft', ownValue:null, answers:[], responseCount:0, options:[]});
      const card = cards.find(c => c.id === input.runId);
      if (input.action === 'start') { cards.forEach(c => {if(c.status === 'active') c.status='closed';}); card.status='active'; }
      if (input.action === 'end') card.status='closed';
      if (!input.action) { if (card.status !== 'active') {res.statusCode=409;} else {card.ownValue=input.value;card.answers=[{id:'a',value:input.value,createdAt:new Date().toISOString()}];card.responseCount=1;} }
      res.end(JSON.stringify({card})); return;
    }
    res.end(JSON.stringify(url.searchParams.get('mode') === 'instructor' ? {cards} : {card:cards.find(c=>c.status==='active') ?? null})); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const receipt={boundary:'real React components, Edge viewport, synthetic API; no physical device',status:'FAIL',checks:[],pageErrors:0};
try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const viewer=await context.newPage(); const manager=await context.newPage();
  for(const page of [viewer,manager])page.on('pageerror',()=>receipt.pageErrors++);
  await viewer.goto(base);await manager.goto(`${base}/instructor`);
  await manager.getByRole('textbox',{name:'題目',exact:true}).fill('你最想了解什麼？');
  await manager.getByRole('button',{name:'建立待發題目'}).click();
  await manager.getByRole('button',{name:'發送這一題'}).waitFor();
  assert.equal(await viewer.getByRole('complementary',{name:'畫面內互動卡片'}).count(),0);
  await manager.getByRole('button',{name:'發送這一題'}).click();
  await viewer.getByText('僅講師可見：回答不會公開展示。').waitFor();
  const input=viewer.getByRole('textbox',{name:'你的回答'});
  await input.fill('想了解價格');
  assert.equal(await input.evaluate(el=>getComputedStyle(el).fontSize),'16px');
  await input.press('Enter');await viewer.getByText('已回答：想了解價格').waitFor();
  await viewer.reload();await viewer.getByText('已回答：想了解價格').waitFor();
  await manager.getByText('查看回答',{exact:true}).click();await manager.getByRole('listitem').filter({hasText:'想了解價格'}).waitFor();
  receipt.checks.push('create-draft-manual-start-private-notice-keyboard-answer-refresh-instructor-record');
  await viewer.getByRole('button',{name:'關閉／收合'}).click();
  assert.equal(await viewer.getByText('已回答：想了解價格').count(),0);
  await viewer.getByRole('button',{name:'展開回答'}).click();await viewer.getByText('已回答：想了解價格').waitFor();
  await viewer.screenshot({path:path.join(out,'interaction-card-mobile.png')});
  await manager.getByRole('textbox',{name:'題目',exact:true}).fill('給講師一點鼓勵');
  await manager.getByLabel('回答方式').selectOption('quick');await manager.getByLabel('回答可見性').selectOption('public_display');
  await manager.getByRole('button',{name:'建立待發題目'}).click();await manager.getByRole('button',{name:'發送這一題'}).click();
  await viewer.getByText('給講師一點鼓勵').waitFor();assert.equal(await viewer.getByText('已回答：想了解價格').count(),0);
  await viewer.getByRole('button',{name:'666',exact:true}).click();
  await viewer.setViewportSize({width:844,height:390});
  assert.equal(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await viewer.getByRole('button',{name:'送出回答'}).click();await viewer.getByText('已回答：666').waitFor();
  await viewer.screenshot({path:path.join(out,'interaction-card-landscape.png')});
  await viewer.getByRole('button',{name:'關閉／收合'}).focus();await viewer.keyboard.press('Escape');
  await viewer.getByRole('button',{name:'展開回答'}).waitFor();
  receipt.checks.push('switch-clears-input-quick-answer-public-notice-landscape-no-overflow-escape-collapse');
  await manager.getByRole('button',{name:'結束回答'}).click();
  await viewer.getByRole('complementary',{name:'畫面內互動卡片'}).waitFor({state:'detached'});
  await manager.screenshot({path:path.join(out,'interaction-card-instructor.png'),fullPage:true});
  assert.equal(receipt.pageErrors,0);receipt.checks.push('manual-end-removes-card-no-page-errors');receipt.status='PASS';
} catch(error){receipt.failure=error.message;process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'interaction-card-browser-evidence.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
