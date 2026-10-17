import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import {readMetricHostConfig,verifyMetricHostArtifacts,disconnectMetricHost} from './metric-report-host-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
let db;
let terminal={event:'terminal',status:'halted',reason:'startup_failed'};
let outputAvailable=true;
const abort=new AbortController();
const stop=()=>abort.abort();
const streamFailure=()=>{outputAvailable=false;process.exitCode=1;stop();};
const emit=value=>{if(outputAvailable){try{process.stdout.write(JSON.stringify(value)+'\n');}catch{streamFailure();}}};
process.stdout.on('error',streamFailure);process.stdin.on('error',streamFailure);
process.stdin.on('end',stop);process.stdin.on('close',stop);
process.on('SIGINT',stop);process.on('SIGTERM',stop);
let command='';
const onInput=chunk=>{if(abort.signal.aborted)return;if(chunk.length>16){stop();return;}command+=chunk.toString('utf8');if(command==='stop\n'||command==='stop\r\n')stop();else if(command.length>16||command.includes('\n'))stop();};
try{
  // This launcher is deliberately restricted to owned disposable PostgreSQL.
  // A deployed staging host requires its own authenticated runtime binding.
  const args=process.argv.slice(2);
  if(args.length!==1)throw new Error('configuration');
  const config=readMetricHostConfig(args[0]);
  // Only this known injected variable is accessed, never environment discovery.
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl)throw new Error('database');
  const url=new URL(databaseUrl);
  if(!['postgresql:','postgres:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/celebratedeal_test')throw new Error('database');
  for(const [key,value] of url.searchParams){
    if(key==='schema'){if(value!=='public')throw new Error('database');}
    else if(!['connection_limit','pool_timeout','connect_timeout'].includes(key)||!/^\d{1,3}$/u.test(value)||Number(value)<1)throw new Error('database');
  }
  const clientPath=path.join(root,'node_modules/.prisma/client/index.js');
  const envPaths=JSON.parse(fs.readFileSync(clientPath,'utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');
  if(!envPaths||Object.values(envPaths).some(value=>value!==null))throw new Error('sdk');
  const {PrismaClient}=require('@prisma/client');
  db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
  if(!/^prisma-no-dotenv:[a-f0-9]{16}$/u.test(marker?.marker??''))throw new Error('database');
  const hostPath=path.join(root,'.metric-worker/live-metric-report-host.cjs');
  const workerPath=path.join(root,'.metric-worker/live-metric-worker.js');
  verifyMetricHostArtifacts(root);
  const {createMetricReportHost}=require(hostPath);
  const {createMetricExecutor,createCompletionExecutor}=require(path.join(root,'.metric-worker/live-metric-executor.js'));
  const host=createMetricReportHost(db,config,createMetricExecutor(pathToFileURL(workerPath)),createCompletionExecutor(pathToFileURL(workerPath)));
  process.stdin.on('data',onInput);
  emit({event:'started'});
  const result=await host.run(abort.signal,cycle=>emit({event:'cycle',...cycle}));
  terminal={event:'terminal',...result};
  if(result.status==='halted')process.exitCode=1;
}catch{
  // No raw error, connection string, scope, request, config or worker data.
  terminal={event:'terminal',status:'halted',reason:'startup_failed'};process.exitCode=1;
}finally{
  process.stdin.removeListener('data',onInput);process.stdin.pause();
  if(!await disconnectMetricHost(db)){terminal={event:'terminal',status:'halted',reason:'cleanup_failed'};process.exitCode=1;}
}
emit(terminal);
process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
