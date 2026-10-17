import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {main} from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const files=['src/lib/live-metric-report-host.ts','src/lib/live-metric-report-scheduler.ts','scripts/run-metric-report-host.mjs','scripts/build-metric-report-host.mjs',
 'scripts/metric-report-host-runtime.mjs','scripts/metric-report-host-artifacts.mjs','scripts/metric-report-host-build-gate.mjs'];
const receipt={status:'FAIL',stage:'start',scope:'Actual private process host, owned loopback disposable PostgreSQL and synthetic records only',checks:{},
  sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
let migration;
try{
 const envPaths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');
 assert.ok(envPaths&&Object.values(envPaths).every(value=>value===null));const {PrismaClient}=require('@prisma/client');
 migration=await main({afterMigrate:async({databaseUrl,tempRoot})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});const children=new Set();
  // Construct only a minimal known environment. No child environment, secret
  // store or dotenv file is enumerated or read, and no diagnostics are logged.
  const environment={PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:tempRoot,TMP:tempRoot,DATABASE_URL:databaseUrl};
  function child(configPath,override={},observe=()=>{}){
   const processChild=spawn(process.execPath,['scripts/run-metric-report-host.mjs',configPath],{
    cwd:process.cwd(),env:{...environment,...override},stdio:['pipe','pipe','pipe'],windowsHide:true});children.add(processChild);
   let output='',pending='',overflow=false,stderrBytes=0;
   processChild.stdout.on('data',chunk=>{if(output.length+chunk.length>8192){overflow=true;processChild.kill();}else{
    output+=chunk.toString('utf8');pending+=chunk.toString('utf8');let newline;
    while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(line.trim())observe(JSON.parse(line));}
   }});
   processChild.stderr.on('data',chunk=>{stderrBytes+=chunk.length;});
   let timer;
   const done=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{processChild.kill();reject(new Error('synthetic child timeout'));},15000);
    processChild.once('error',reject);processChild.once('exit',code=>{clearTimeout(timer);children.delete(processChild);
     try{assert.equal(overflow,false);resolve({code,stderrBytes,events:output.trim().split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line))});}catch(error){reject(error);}});
   });
   return {process:processChild,done};
  }
  try{
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
   assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   receipt.stage='build';
   await new Promise((resolve,reject)=>{const build=spawn(process.execPath,['scripts/build-metric-report-host.mjs'],{env:environment,stdio:'ignore',windowsHide:true});build.once('error',reject);build.once('exit',code=>code===0?resolve():reject(new Error('synthetic build failed')));});
   receipt.checks.fixedSourceArtifactBuild='PASS';
   const vendor=await db.vendor.create({data:{name:'Synthetic host',slug:'metric-host',email:'host@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const start=new Date(+clock.now-20000),end=new Date(+clock.now-10000),expires=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,title:'Synthetic',slug:'metric-host',scheduledAt:start}});
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt")
    VALUES ('host-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`,vendor.id,live.id,video.id,'a'.repeat(64),start,expires);
   const entry={vendorId:vendor.id,liveId:live.id,versionId:'host-version',startAt:start.toISOString(),endAt:end.toISOString()};
   const configPath=path.join(tempRoot,'metric-host-config.json');
   fs.writeFileSync(configPath,JSON.stringify({entries:[entry],maxCycles:2,cadenceMilliseconds:1000,jobsPerCycle:1}));
   receipt.stage='two-real-cycles';const began=performance.now();const first=await child(configPath).done;
   assert.equal(first.code,0);const cycles=first.events.filter(event=>event.event==='cycle'),terminal=first.events.find(event=>event.event==='terminal');
   assert.equal(cycles.length,2);assert.equal(cycles[0].created,1);assert.equal(cycles[0].recorded,1);
   assert.equal(cycles[1].created,0);assert.equal(cycles[1].reused,1);assert.equal(cycles[1].attempted,0);
   assert.equal(terminal.status,'completed');assert.equal(terminal.created,1);assert.equal(terminal.recorded,1);
   assert.ok(performance.now()-began>=1000);
   const reports=await db.$queryRawUnsafe('SELECT status,attempts,result FROM "LiveMetricReport"');
   assert.equal(reports.length,1);assert.equal(reports[0].status,'ready');assert.equal(reports[0].attempts,1);
   for(const key of ['registrationRate','attendanceRate','completionRate','averageViewingSeconds','postCompletionOrderRate'])assert.deepEqual(reports[0].result[key],{status:'unavailable',reason:'missing_data'});
   for(const event of first.events)for(const key of Object.keys(event))assert.ok(['event','cycle','partial','created','reused','denied','contention','attempted','recorded','status','cycles'].includes(key));
   receipt.checks.actualChildTwoCyclesDedupRealWorkerAndUnknownMetrics='PASS';receipt.checks.aggregateOnlyProcessOutput='PASS';
   receipt.stage='startup-guards';
   const remote=await child(configPath,{DATABASE_URL:'postgresql://synthetic:synthetic@unreachable.example/celebratedeal_test'}).done;
   assert.equal(remote.code,1);assert.deepEqual(remote.events,[{event:'terminal',status:'halted',reason:'startup_failed'}]);
   const hidden=await child(path.join(tempRoot,'.env.fake')).done;assert.equal(hidden.code,1);
   const directory=path.join(tempRoot,'not-a-config.json');fs.mkdirSync(directory);
   const nonFile=await child(directory).done;assert.equal(nonFile.code,1);
   assert.deepEqual(nonFile.events,[{event:'terminal',status:'halted',reason:'startup_failed'}]);
   const upper=await child(path.join(tempRoot,'.ENV.json')).done;assert.equal(upper.code,1);
   await db.$executeRawUnsafe("COMMENT ON DATABASE celebratedeal_test IS 'synthetic-invalid-marker'");
   try{const denied=await child(configPath).done;assert.equal(denied.code,1);assert.deepEqual(denied.events,[{event:'terminal',status:'halted',reason:'startup_failed'}]);}
   finally{await db.$executeRawUnsafe(`COMMENT ON DATABASE celebratedeal_test IS '${marker.marker}'`);}
   assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricReport"'))[0].count,1);
   receipt.checks.nonLoopbackDotenvNonFileAndWrongMarkerDeniedWithoutWork='PASS';
   receipt.stage='control-pipe-eof';
   fs.writeFileSync(configPath,JSON.stringify({entries:[entry],maxCycles:100,cadenceMilliseconds:60000}));
   const eof=child(configPath,{},event=>{if(event.event==='cycle')eof.process.stdin.end();});
   const ended=await eof.done;assert.equal(ended.code,0);assert.equal(ended.stderrBytes,0);
   assert.equal(ended.events.find(event=>event.event==='terminal').status,'stopped');
   assert.equal(ended.events.filter(event=>event.event==='cycle').length,1);receipt.checks.controlPipeEofStopsCadence='PASS';
   receipt.stage='broken-output-pipe';
   const broken=child(configPath,{},event=>{if(event.event==='started'){broken.process.stdout.destroy();broken.process.stdin.end();}});
   const disconnected=await broken.done;assert.ok([0,1].includes(disconnected.code));assert.equal(disconnected.stderrBytes,0);
   receipt.checks.brokenOutputAndControlPipeExitWithoutRawDiagnostics='PASS';
   receipt.stage='stop-during-lock-wait';
   const stoppingEntry={...entry,startAt:new Date(+start+1).toISOString()},laterEntry={...entry,startAt:new Date(+start+2).toISOString()};
   fs.writeFileSync(configPath,JSON.stringify({entries:[stoppingEntry,laterEntry],maxCycles:100,cadenceMilliseconds:60000,jobsPerCycle:2}));
   let locked,release;const held=new Promise(resolve=>{locked=resolve;}),gate=new Promise(resolve=>{release=resolve;});
   const locking=db.$transaction(async tx=>{await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR UPDATE','host-version');locked();await gate;},{timeout:15000});
   await held;const stopping=child(configPath);
   try{
    let waiting=false;
    for(let attempt=0;attempt<80;attempt++){
     const [state]=await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'");
     if(state.count>0){waiting=true;break;}await wait(50);
    }
    assert.equal(waiting,true);stopping.process.stdin.write('stop\n');await wait(100);
    assert.equal(stopping.process.exitCode,null); // Await owned in-flight work, don't kill it.
   }finally{release();await locking;}
   const stopped=await stopping.done;assert.equal(stopped.code,0);
   const stoppedTerminal=stopped.events.find(event=>event.event==='terminal');
   assert.equal(stoppedTerminal.status,'stopped');assert.equal(stoppedTerminal.created,1);assert.equal(stoppedTerminal.recorded,0);
   const remaining=await db.$queryRawUnsafe('SELECT "windowStartAt",status,attempts FROM "LiveMetricReport" ORDER BY "windowStartAt"');
   assert.equal(remaining.length,2);assert.equal(+remaining[1].windowStartAt,+start+1);assert.equal(remaining[1].status,'queued');assert.equal(remaining[1].attempts,0);
   receipt.checks.stopWaitsForLockedEnqueueAndStartsNoFurtherWork='PASS';
   receipt.process={cycles:2,created:1,recorded:1,minimumCadenceMilliseconds:1000,stopDuringInFlight:'PASS'};
   receipt.status='PASS';receipt.stage='complete';
  }catch(error){receipt.errorType=error?.name;receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';
   if(['number','boolean'].includes(typeof error?.actual)&&['number','boolean'].includes(typeof error?.expected))receipt.assertion={actual:error.actual,expected:error.expected};throw new Error('host-check-failed');}
  finally{for(const processChild of children)processChild.kill();await db.$disconnect();}
 }});
}catch{receipt.errorCode??='RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';receipt.migrationCount=migration?.migrationNames?.length??null;
if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync(`${base}/report-host-db.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
