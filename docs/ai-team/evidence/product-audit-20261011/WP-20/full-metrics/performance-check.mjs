import { writeFileSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import * as before from './reference-viewing.mjs';
const compiled = await build({entryPoints:['src/lib/live-viewing-evidence.ts'],bundle:true,platform:'node',format:'esm',write:false});
const after = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const cases=[];
let cursor=0;
cases.push({name:'sequential_jitter',duration:10000000,rows:Array.from({length:10000},(_,i)=>{const start=cursor;cursor+=900+i%201;return {wallStartMs:start,wallEndMs:cursor,mediaStartMs:i*1000,mediaEndMs:(i+1)*1000};})});
cases.push({name:'simultaneous_disjoint_jitter',duration:10000000,rows:Array.from({length:10000},(_,i)=>({wallStartMs:0,wallEndMs:900+i%201,mediaStartMs:i*1000,mediaEndMs:(i+1)*1000}))});
cases.push({name:'partially_overlapping_jitter',duration:5000500,rows:Array.from({length:10000},(_,i)=>({wallStartMs:i%151,wallEndMs:i%151+900+i%201,mediaStartMs:i*500,mediaEndMs:i*500+1000}))});
const recorded=readFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/full-metrics/performance-jitter-before-scale.json');
if(createHash('sha256').update(recorded).digest('hex') !== '8ee162db26b98259f8b07bf57d93d2cf17d72748d9a6a44547b38e3c1ad9a23e') throw new Error('Recorded reference changed');
const prior=JSON.parse(recorded);
const measurements=[];
for(const sample of cases){let t=performance.now();const baseline=prior.measurements.find(x=>x.name===sample.name);const reference=baseline.result;const beforeMs=baseline.before_ms;t=performance.now();const actual=after.firstCompletionTime(sample.duration,sample.rows);const afterMs=performance.now()-t;measurements.push({name:sample.name,segments:sample.rows.length,recorded_before_ms:Math.round(beforeMs),reference_source:'hash_verified_historical_exact_reference',after_ms:Math.round(afterMs),equal:JSON.stringify(reference)===JSON.stringify(actual),budget_ms:2000,budget_pass:afterMs<2000,result:actual});}

// Independent directed-rounding oracle for disjoint media intervals. It proves
// each threshold decision with upper/lower bounds; ambiguity is a test failure.
function boundedOracle(duration,rows){
 const precision=1000000n, threshold=BigInt(duration)*90n*precision;
 const crosses=(at)=>{let lower=0n;for(const row of rows)lower+=BigInt(row.mediaEndMs-row.mediaStartMs)*BigInt(Math.max(0,Math.min(at,row.wallEndMs)-row.wallStartMs))*precision/BigInt(row.wallEndMs-row.wallStartMs);const upper=lower+BigInt(rows.length);if(lower*100n>=threshold)return true;if(upper*100n<threshold)return false;throw new Error('Oracle bounds inconclusive');};
 let low=Math.min(...rows.map(x=>x.wallStartMs)),high=Math.max(...rows.map(x=>x.wallEndMs));while(low<high){const mid=low+Math.floor((high-low)/2);if(crosses(mid))high=mid;else low=mid+1;}return {status:'available',firstCompletedAtMs:low};
}
for(const maxDuration of [5000,5600]){
 let media=0;const rows=Array.from({length:10000},(_,i)=>{const wallEndMs=1+i%maxDuration;const mediaStartMs=media;media+=wallEndMs+1;return {wallStartMs:0,wallEndMs,mediaStartMs,mediaEndMs:media};});
 const reference=boundedOracle(media,rows),start=performance.now(),actual=after.firstCompletionTime(media,rows),elapsed=performance.now()-start;
 measurements.push({name:`scale_durations_1_to_${maxDuration}`,segments:rows.length,reference_source:'independent_directed_rounding_oracle',after_ms:Math.round(elapsed),equal:JSON.stringify(reference)===JSON.stringify(actual),budget_ms:2000,budget_pass:elapsed<2000,result:actual});
}

for(const maxDuration of [5000,5600]){
 let media=0;const rows=Array.from({length:10000},(_,i)=>{const wallStartMs=1700000000000+Math.floor(i/200)*12000000,wallEndMs=wallStartMs+1+i%maxDuration;const mediaStartMs=media;media+=wallEndMs-wallStartMs+1;return {wallStartMs,wallEndMs,mediaStartMs,mediaEndMs:media};});
 const reference=boundedOracle(media,rows),samples=[];let equal=true;
 for(let repeat=0;repeat<5;repeat++){const start=performance.now(),actual=after.firstCompletionTime(media,rows);samples.push(performance.now()-start);equal=equal&&JSON.stringify(actual)===JSON.stringify(reference);}
 const sorted=[...samples].sort((a,b)=>a-b);
 measurements.push({name:`epoch_week_spread_${maxDuration}`,segments:rows.length,reference_source:'independent_directed_rounding_oracle',runs:5,median_ms:Math.round(sorted[2]),max_ms:Math.round(sorted[4]),equal,budget_ms:2000,budget_pass:sorted[4]<2000,result:reference});
}
const readCompiled=await build({entryPoints:['src/lib/live-core-metrics-read-model.ts'],bundle:true,platform:'node',format:'esm',write:false});
const readModel=await import('data:text/javascript;base64,'+Buffer.from(readCompiled.outputFiles[0].text).toString('base64'));
const scope={vendorId:'synthetic',liveId:'synthetic',contentVersionId:'v1',mode:'replay'};
const registrations=Array.from({length:100},(_,i)=>({scope,personId:`viewer-${i}`,browserId:null,verifiedAtMs:2000}));
const viewing=registrations.flatMap(({personId})=>Array.from({length:720},(_,i)=>({scope,personId,wallStartMs:3000+i*5000,wallEndMs:8000+i*5000,mediaStartMs:i*5000,mediaEndMs:(i+1)*5000})));
const completions=registrations.map(({personId})=>({scope,personId,firstCompletedAtMs:3243000}));
const cohortStart=performance.now(),cohortResult=readModel.calculateCoreMetrics({scope,startMs:0,endMs:1000000000,durationMs:3600000,visits:[],registrations,viewing,completions,orders:[]}),cohortElapsed=performance.now()-cohortStart;
measurements.push({name:'100_viewers_one_hour_72000_segments',segments:viewing.length,after_ms:Math.round(cohortElapsed),equal:cohortResult.completionRate.status==='available'&&cohortResult.completionRate.value===100&&cohortResult.averageViewingSeconds.value===3600,budget_ms:5000,budget_pass:cohortElapsed<5000});
let seed=2457;const random=(n)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
let mismatches=0;
for(let k=0;k<200;k++){const rows=Array.from({length:30},()=>{const wallStartMs=random(1000),mediaStartMs=random(50000);return {wallStartMs,wallEndMs:wallStartMs+900+random(201),mediaStartMs,mediaEndMs:mediaStartMs+1000+random(50000)};});const window={startMs:random(100),endMs:1000+random(1200)};if(JSON.stringify(before.firstCompletionTime(100000,rows,window))!==JSON.stringify(after.firstCompletionTime(100000,rows,window)))mismatches++;}
const receipt={runtime:{node:process.version,cpu:cpus()[0]?.model},scope:'Synthetic arithmetic only; same exact rational reference before optimization; no DB or network',measurements,random_cases:200,mismatches,status:measurements.every(x=>x.equal&&x.budget_pass)&&mismatches===0?'PASS':'FAIL'};
writeFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/full-metrics/performance-jitter.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

process.exitCode = receipt.status === "PASS" ? 0 : 1;
