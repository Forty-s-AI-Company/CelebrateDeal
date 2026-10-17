import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

/** Full, unmodified application source in an owned no-dotenv mirror. The extra
 * marker route is readiness only. Source requests traverse the real gateway;
 * the browser driver explicitly proxies only static assets and the visit API.
 * This is not a deployed gateway's full auxiliary route/universe certification.
 */
export async function verifyNextMetricRuntime({ db, databaseUrl, environment, tempRoot, service, scope, routes, formSlug, liveSlug }) {
  const root=process.cwd(),mirror=path.resolve(tempRoot,'next-app');
  assert.ok(mirror.startsWith(path.resolve(tempRoot)+path.sep));
  assert.match(path.basename(tempRoot),/^celebratedeal-prisma-migrate-[a-f0-9]{16}$/u);
  assert.ok(fs.existsSync(path.join(tempRoot,'.marker')));
  assert.notEqual(mirror,path.resolve(root));
  const receipt={status:'FAIL',stage:'mirror',checks:{},server:{started:false,ready:false,stopped:false,classifications:[]},browser:{sourceResponses:[],visitResponses:[],blockedExternal:0,blockedAuxiliary:0},cleanup:{browser:'NOT_STARTED',gateway:'NOT_STARTED',nodeModulesLink:'NOT_STARTED'}};
  let server,browser,gateway,stopNext=async()=>{},closingBrowser=false;const sockets=new Set();const link=path.join(mirror,'node_modules');
  try {
    fs.mkdirSync(mirror,{recursive:true});
    const allowed=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.css','.svg','.ico']);
    fs.cpSync(path.join(root,'src'),path.join(mirror,'src'),{recursive:true,filter:source=>{
      const parts=path.relative(root,source).split(path.sep);
      // Reject by NAME before any metadata/content access. Never follow links.
      if(parts.some(part=>part.toLowerCase().startsWith('.env')))return false;
      const stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw new Error('Mirror source link rejected');
      return stat.isDirectory()||(!/\.(test|spec)\.[^.]+$/u.test(source)&&allowed.has(path.extname(source)));
    }});
    for(const file of ['package.json','tsconfig.json','next.config.ts','next-env.d.ts','postcss.config.mjs','sentry.server.config.ts','sentry.edge.config.ts']){
      const source=path.join(root,file);if(!fs.existsSync(source))continue;
      assert.ok(fs.lstatSync(source).isFile()&&!fs.lstatSync(source).isSymbolicLink());fs.copyFileSync(source,path.join(mirror,file));
    }
    fs.symlinkSync(path.join(root,'node_modules'),link,'junction');receipt.cleanup.nodeModulesLink='PENDING';
    const nonce=randomBytes(16).toString('hex'),markerPath=`/api/wp20-owned-runtime-${nonce}`;
    const markerDir=path.join(mirror,'src','app','api',`wp20-owned-runtime-${nonce}`);fs.mkdirSync(markerDir,{recursive:true});
    fs.writeFileSync(path.join(markerDir,'route.ts'),`export async function GET(){return Response.json({marker:${JSON.stringify(nonce)}})}\n`);
    const port=await new Promise(resolve=>{const reservation=net.createServer();reservation.listen(0,'127.0.0.1',()=>{const value=reservation.address().port;reservation.close(()=>resolve(value));});});
    const upstream=`http://127.0.0.1:${port}`,key=randomBytes(32),edgeProof=randomBytes(32).toString('hex');
    const baseEnv={...environment,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',SENTRY_DISABLE_AUTO_UPLOAD:'true',SENTRY_DSN:'',NEXT_PUBLIC_SENTRY_DSN:'',NPM_CONFIG_OFFLINE:'true',
      DATABASE_URL:databaseUrl,DIRECT_URL:databaseUrl,NEXT_PUBLIC_APP_URL:upstream,RATE_LIMIT_PROVIDER:'memory',
      ENTRY_CLIENT_IP_TRUST_MODE:'cloudflare',ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE:'cloudflare',ENTRY_CLIENT_IP_INGRESS_SECRET:edgeProof,
      CSRF_SECRET:randomBytes(32).toString('hex')};
    const launch=async(env,phase)=>{
      receipt.stage=phase;receipt.server.ready=false;receipt.server.stopped=false;receipt.server.spawnError=false;
      server=spawn(process.execPath,[path.join(link,'next','dist','bin','next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:mirror,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      receipt.server.started=true;receipt.server.starts=(receipt.server.starts??0)+1;
      server.on('error',()=>{receipt.server.spawnError=true;});
      const classify=chunk=>{const value=String(chunk);for(const [pattern,code]of [[/EADDRINUSE/u,'PORT_IN_USE'],[/Module not found|Cannot find module/u,'MODULE_UNRESOLVED'],[/Error:|error TS/u,'SERVER_ERROR'],[/Ready in/u,'READY_MARKER']])if(pattern.test(value)&&!receipt.server.classifications.includes(code))receipt.server.classifications.push(code);};
      server.stdout.on('data',classify);server.stderr.on('data',classify);
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){
        if(server.exitCode!==null||receipt.server.spawnError)throw new Error('Owned Next exited before readiness');
        try{const response=await fetch(upstream+markerPath,{signal:AbortSignal.timeout(2500)});if(response.ok&&(await response.json()).marker===nonce){receipt.server.ready=true;break;}}catch{/* marker probe only, no raw output */}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      assert.equal(receipt.server.ready,true);
    };
    stopNext=async()=>{
      if(!server)return;
      if(server.exitCode===null){
        if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{env:environment,windowsHide:true,stdio:'ignore'});
        else server.kill('SIGTERM');
      }
      const limit=Date.now()+10000;while(server.exitCode===null&&server.signalCode===null&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,50));
      receipt.server.stopped=server.exitCode!==null||server.signalCode!==null;
      assert.equal(receipt.server.stopped,true);
      // The exact owned marker must be unreachable before another phase starts.
      let stillOwned=false;try{const response=await fetch(upstream+markerPath,{signal:AbortSignal.timeout(1000)});stillOwned=response.ok&&(await response.json()).marker===nonce;}catch{/* expected stopped listener */}
      assert.equal(stillOwned,false);server=null;
    };
    // Intentional setup phase, not a timeout retry: collection remains disabled
    // while dev compilation is warmed. No metric source may be written here.
    await launch(baseEnv,'bootstrap');receipt.bootstrapResponses=[];
    for(const target of [`/form/${formSlug}`,`/live/${liveSlug}`]){
      const response=await fetch(upstream+target,{signal:AbortSignal.timeout(120000)});receipt.bootstrapResponses.push(response.status);assert.equal(response.status,200);
      let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=16*1024*1024);}
    }
    const [beforeCollection]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitPage" WHERE "versionId"=$1',scope.versionId);assert.equal(beforeCollection.count,0);
    await stopNext();receipt.checks.disabledBootstrapSsrLeavesNoPageSource='PASS';
    await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true,"collectionStartedAt"=date_trunc(\'milliseconds\',clock_timestamp()) WHERE id=$1 AND "vendorId"=$2 AND "liveId"=$3',scope.versionId,scope.vendorId,scope.liveId);
    const opened=await service.openMetricIngressRun(db,scope,service.metricIngressManifestHash(routes),30),run={...scope,runId:opened.runId};
    const attestor=service.createMetricIngressAttestor(run,key);
    const childEnv={...baseEnv,LIVE_METRIC_VISITOR_KEYRING:JSON.stringify({current:{id:'owned-runtime',key:randomBytes(32).toString('hex')}}),LIVE_METRIC_INGRESS_PROFILE:JSON.stringify({...run,key:key.toString('base64url')})};
    await launch(childEnv,'profile-start');
    receipt.checks.ownedFullNextStartupWithExactMarker='PASS';
    gateway=await service.startMetricIngressGateway(db,run,port,routes,attestor,{upstreamTimeoutMs:120000});receipt.cleanup.gateway='PENDING';
    const origin=gateway.origin,host=new URL(origin).host,visitPath=`/api/live-metrics/${run.vendorId}/${run.liveId}/visits`;
    receipt.stage='browser';
    browser=await chromium.launch({headless:true,env:environment});receipt.cleanup.browser='PENDING';
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.routeWebSocket('**/*',route=>{
      const url=new URL(route.url());
      if(url.protocol!=='ws:'||url.host!==host||url.pathname!=='/_next/hmr'||url.search.length>256){receipt.browser.blockedExternal++;route.close({code:1008});return;}
      // Actual Next dev/HMR/debug bytes, not a mock. No frame contents are
      // inspected, persisted or logged; the TCP target is this owned process.
      const socket=new WebSocket(`ws://127.0.0.1:${port}${url.pathname}${url.search}`);socket.binaryType='arraybuffer';sockets.add(socket);
      const queued=[];let queuedBytes=0;
      route.onMessage(message=>{
        if(socket.readyState===WebSocket.OPEN)socket.send(message);
        else if(socket.readyState===WebSocket.CONNECTING){queuedBytes+=typeof message==='string'?Buffer.byteLength(message):message.length;if(queued.length>=64||queuedBytes>1048576){socket.close();route.close({code:1009});return;}queued.push(message);}
      });
      socket.addEventListener('open',()=>{receipt.browser.webSocketConnections=(receipt.browser.webSocketConnections??0)+1;for(const message of queued)socket.send(message);queued.length=0;});
      socket.addEventListener('message',event=>{if(!closingBrowser)route.send(typeof event.data==='string'?event.data:Buffer.from(event.data));});
      route.onClose(()=>socket.close());
      socket.addEventListener('close',()=>{sockets.delete(socket);if(!closingBrowser)route.close({code:1000});});
      socket.addEventListener('error',()=>{if(!closingBrowser)receipt.browser.webSocketErrors=(receipt.browser.webSocketErrors??0)+1;route.close({code:1011});});
    });
    await context.route('**/*',async route=>{try{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin){receipt.browser.blockedExternal++;await route.abort();return;}
      const source=request.method()==='GET'&&[...routes].some(value=>value.path===url.pathname&&value.kind!=='playback')&&!url.search;
      const asset=request.method()==='GET'&&url.pathname.startsWith('/_next/static/');
      const visit=request.method()==='POST'&&url.pathname===visitPath&&!url.search;
      const csp=request.method()==='POST'&&url.pathname==='/api/security/csp-report'&&!url.search;
      if(!source&&!asset&&!visit&&!csp){receipt.browser.blockedAuxiliary++;await route.abort();return;}
      if(source){await route.continue();return;}
      const headers={...await request.allHeaders(),'cf-connecting-ip':'192.0.2.90','x-celebratedeal-live-chat-ingress':edgeProof};
      // Explicit synthetic proxy, not a mocked handler. The actual Next API,
      // canonical rate limiter/auth/cookie/DB code all execute unchanged.
      const response=await route.fetch({url:upstream+url.pathname+url.search,headers:{...headers,host},maxRedirects:0,timeout:120000});
      if(visit)receipt.browser.visitResponses.push(response.status());
      if(asset){
        receipt.browser.assetStatuses??={};receipt.browser.assetStatuses[response.status()]=(receipt.browser.assetStatuses[response.status()]??0)+1;
        if(response.headers()['content-encoding'])receipt.browser.encodedAssets=(receipt.browser.encodedAssets??0)+1;
      }
      await route.fulfill({response});
    }catch{
      receipt.browser.auxiliaryFailures=(receipt.browser.auxiliaryFailures??0)+1;
      try{await route.abort();}catch{/* cancelled browser request, no raw details */}
    }
    });
    const page=await context.newPage();
    page.on('pageerror',()=>{receipt.browser.pageErrors=(receipt.browser.pageErrors??0)+1;});
    page.on('console',message=>{if(message.type()==='error'){
      const text=message.text();receipt.browser.consoleErrors=(receipt.browser.consoleErrors??0)+1;
      for(const [pattern,code]of [[/ERR_CONTENT_DECODING_FAILED/u,'CONTENT_DECODING'],[/Failed to load resource/u,'RESOURCE_LOAD'],[/Hydration/u,'HYDRATION'],[/ChunkLoadError/u,'CHUNK_LOAD'],[/Content Security Policy/u,'CSP']])if(pattern.test(text)){receipt.browser.consoleClasses??=[];if(!receipt.browser.consoleClasses.includes(code))receipt.browser.consoleClasses.push(code);}
    }});
    page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&[...routes].some(value=>value.path===url.pathname))receipt.browser.sourceResponses.push(response.status());});
    const counts=async()=>{const [row]=await db.$queryRawUnsafe(`SELECT
      (SELECT count(*)::int FROM "LiveMetricVisitPage" WHERE "versionId"=$1) AS pages,
      (SELECT count(*)::int FROM "LiveMetricVisitIntent" WHERE "versionId"=$1) AS intents,
      (SELECT count(*)::int FROM "LiveMetricVisit" WHERE "versionId"=$1) AS visits,
      (SELECT count(DISTINCT "visitorId")::int FROM "LiveMetricVisit" WHERE "versionId"=$1) AS visitors`,run.versionId);return row;};
    const waitForVisits=async expected=>{const limit=Date.now()+90000;while(Date.now()<limit){const value=await counts();receipt.observedCounts=value;if(value.visits===expected)return value;await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('Next browser visit did not persist');};
    assert.deepEqual(await counts(),{pages:0,intents:0,visits:0,visitors:0});
    const firstStarted=Date.now(),first=await page.goto(`${origin}/form/${formSlug}`,{waitUntil:'domcontentloaded',timeout:120000});receipt.browser.firstSourceElapsedMs=Date.now()-firstStarted;assert.equal(first.status(),200);
    receipt.browser.dom=await page.evaluate(()=>({secure:window.isSecureContext,locks:typeof navigator.locks?.request==='function',contentType:document.contentType,scripts:document.querySelectorAll('script[src]').length,hasFixture:document.body.textContent.includes('Synthetic runtime form')}));
    assert.equal(receipt.browser.dom.secure,true);assert.equal(receipt.browser.dom.locks,true);assert.equal(receipt.browser.dom.hasFixture,true);
    assert.deepEqual(await waitForVisits(1),{pages:1,intents:1,visits:1,visitors:1});
    receipt.checks.actualNextFormClientPrepareAndVisitPersist='PASS';
    await page.reload({waitUntil:'domcontentloaded',timeout:120000});
    assert.deepEqual(await waitForVisits(2),{pages:2,intents:2,visits:2,visitors:1});
    receipt.checks.realBrowserRefreshPreservesFirstPartyVisitorIdentity='PASS';
    const viewer=await page.goto(`${origin}/live/${liveSlug}`,{waitUntil:'domcontentloaded',timeout:120000});assert.equal(viewer.status(),200);
    assert.deepEqual(await waitForVisits(3),{pages:3,intents:3,visits:3,visitors:1});
    receipt.checks.actualNextViewerClientVisitUsesSameVisitor='PASS';
    const sourceRows=await db.$queryRawUnsafe(`SELECT p."sourceKind",count(*)::int AS count FROM "LiveMetricVisitPage" p
      JOIN "LiveMetricIngressFrame" f ON f.id=p."ingressFrameId" AND f."vendorId"=p."vendorId" AND f."liveId"=p."liveId" AND f."versionId"=p."versionId"
      WHERE p."versionId"=$1 AND f."runId"=$2 GROUP BY p."sourceKind" ORDER BY p."sourceKind"`,run.versionId,run.runId);
    assert.deepEqual(sourceRows,[{sourceKind:'registration',count:2},{sourceKind:'viewer',count:1}]);
    const responseDeadline=Date.now()+10000;while(receipt.browser.visitResponses.length<6&&Date.now()<responseDeadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(receipt.browser.visitResponses.length,6);assert.ok(receipt.browser.visitResponses.every(status=>status===200));
    receipt.checks.allRealPageSourcesBoundAndSixCanonicalVisitApiResponses='PASS';
    // Two real admissions are intentionally not forwarded by the gateway.
    // They remain interrupted, including the positive-control source request.
    // Their later internal requests are explicit test controls, not coverage.
    receipt.stage='source-seal';
    const control=await service.admitMetricIngress(db,run,'form'),late=await service.admitMetricIngress(db,run,'form');
    for(const frame of [control,late])await service.settleMetricIngress(db,{...run,frameId:frame.frameId},{outcome:'interrupted'});
    closingBrowser=true;await browser.close();browser=null;receipt.cleanup.browser='PASS';
    receipt.gatewayDiagnostics=gateway.diagnostics();receipt.gatewayClose=await gateway.close();
    assert.deepEqual(receipt.gatewayClose,{settlementFailures:0,admissionFailures:0,pendingFrames:0});gateway=null;receipt.cleanup.gateway='PASS';
    const sourceAllowed=async(tx=db)=>{const [row]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_ingress_source_allowed($1,$2,$3,$4,$5) AS allowed',run.vendorId,run.liveId,run.versionId,late.frameId,'registration');return row.allowed;};
    assert.equal(await sourceAllowed(),true);
    const target=`/form/${formSlug}`;
    const signedGet=async frame=>{const header=attestor.issue(frame.frameId,{kind:'form',method:'GET',target});const response=await fetch(upstream+target,{headers:{[service.METRIC_INGRESS_HEADER]:header},signal:AbortSignal.timeout(120000)});assert.equal(response.status,200);let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=16*1024*1024);}return response.status;};
    await signedGet(control);
    assert.deepEqual(await counts(),{pages:4,intents:3,visits:3,visitors:1});
    receipt.checks.actualNextStoppedRunPreSealControlStillAppends='PASS';
    assert.equal(await sourceAllowed(),true);
    const frozen=await service.sealMetricIngressSources(db,run);
    assert.deepEqual([frozen.frameCount,frozen.pageCount,frozen.playbackCount],[5,4,0]);
    assert.equal(await sourceAllowed(),false);
    const unmatched=async()=>{const [row]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count,bool_or(f.id=$2) AS includesLate FROM "LiveMetricIngressFrame" f
      WHERE f."runId"=$1 AND f.outcome='interrupted' AND NOT EXISTS(SELECT 1 FROM "LiveMetricVisitPage" p WHERE p."ingressFrameId"=f.id)
      AND NOT EXISTS(SELECT 1 FROM "LiveMetricPlaybackIntake" p WHERE p."ingressFrameId"=f.id)`,run.runId,late.frameId);assert.deepEqual(row,{count:1,includeslate:true});return row.count;};
    receipt.sourceSeal={frameCount:frozen.frameCount,pageCount:frozen.pageCount,playbackCount:frozen.playbackCount,unmatchedInterruptedFrames:await unmatched()};
    receipt.checks.actualBrowserRunStopsDrainsAndSealsSources='PASS';
    receipt.sourceSeal.lateHttpStatus=await signedGet(late);
    assert.deepEqual(await counts(),{pages:4,intents:3,visits:3,visitors:1});assert.equal(await unmatched(),1);
    const insertLate=async tx=>{const [version]=await tx.$queryRawUnsafe('SELECT "expiresAt" FROM "LiveMetricVersion" WHERE id=$1',run.versionId);const [page]=await tx.$queryRawUnsafe('SELECT "sourceFormId" FROM "LiveMetricVisitPage" WHERE "versionId"=$1 AND "sourceKind"=\'registration\' LIMIT 1',run.versionId);return tx.$executeRawUnsafe('INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt","sourceKind","sourceFormId","ingressFrameId") VALUES ($1,$2,$3,$4,$5,\'registration\',$6,$7)',run.vendorId,run.liveId,run.versionId,randomUUID(),version.expiresAt,page.sourceFormId,late.frameId);};
    await assert.rejects(insertLate(db),error=>error?.meta?.code==='23514');
    receipt.checks.actualNextLateSignedSourceAndTrustedSqlRejectedAfterSeal='PASS';
    // Counterfactual in ONE owned transaction: the weakened predicate and row
    // are always rolled back. It must actually permit the otherwise rejected
    // INSERT, showing this test distinguishes seal enforcement from no writes.
    const mutationRollback=new Error('Owned mutation rollback');let mutationAppended=0;
    await assert.rejects(db.$transaction(async tx=>{
      const [definition]=await tx.$queryRawUnsafe("SELECT pg_get_functiondef('public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT)'::regprocedure) AS definition");
      const clause='IF EXISTS(SELECT 1 FROM public."LiveMetricIngressSeal" WHERE "runId"=source_run) THEN RETURN FALSE; END IF;';
      assert.ok(definition.definition.includes(clause));const weakened=definition.definition.replace(clause,'');
      await tx.$executeRawUnsafe(weakened);assert.equal(await sourceAllowed(tx),true);
      mutationAppended=await insertLate(tx);assert.equal(mutationAppended,1);throw mutationRollback;
    },{timeout:10000}),error=>error===mutationRollback);
    assert.equal(await sourceAllowed(),false);assert.deepEqual(await counts(),{pages:4,intents:3,visits:3,visitors:1});assert.equal(await unmatched(),1);
    receipt.sourceSeal.mutationAppendedThenRolledBack=mutationAppended;
    receipt.checks.removingSealClauseAllowsForbiddenInsertAndRollbackRestoresFence='PASS';
    await stopNext();assert.deepEqual(await counts(),{pages:4,intents:3,visits:3,visitors:1});assert.deepEqual(await service.sealMetricIngressSources(db,run),frozen);
    receipt.checks.afterOwnedNextStopSourceAndSealCountsStayUnchanged='PASS';
    receipt.status='PASS';receipt.stage='complete';
  }catch(error){receipt.failure={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null,sqlState:typeof error?.meta?.code==='string'?error.meta.code:null,
    line:Number(String(error?.stack??'').match(/wp20-next-runtime-probe\.mjs:(\d+):/u)?.[1]??0)};}
  finally{
    closingBrowser=true;
    try{if(browser){await browser.close();receipt.cleanup.browser='PASS';}}catch{receipt.cleanup.browser='FAIL';receipt.status='FAIL';}
    for(const socket of sockets)socket.close();
    try{if(gateway){receipt.gatewayDiagnostics=gateway.diagnostics();receipt.gatewayClose=await gateway.close();assert.deepEqual(receipt.gatewayClose,{settlementFailures:0,admissionFailures:0,pendingFrames:0});receipt.cleanup.gateway='PASS';}}catch{receipt.cleanup.gateway='FAIL';receipt.status='FAIL';}
    try{await stopNext();}catch{receipt.server.stopped=false;receipt.status='FAIL';}
    try{if(fs.existsSync(link)){assert.ok(fs.lstatSync(link).isSymbolicLink());fs.unlinkSync(link);receipt.cleanup.nodeModulesLink='PASS';}}catch{receipt.cleanup.nodeModulesLink='FAIL';receipt.status='FAIL';}
  }
  return receipt;
}
