import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const before = await import(pathToFileURL(resolve('.ai-team/tmp/wp20-before-performance.mjs')));
const after = await import(pathToFileURL(resolve('.ai-team/tmp/wp20-after-performance.mjs')));
const cases=[];
let cursor=0;
cases.push({name:'sequential_jitter',duration:10000000,rows:Array.from({length:10000},(_,i)=>{const start=cursor;cursor+=900+i%201;return {wallStartMs:start,wallEndMs:cursor,mediaStartMs:i*1000,mediaEndMs:(i+1)*1000};})});
cases.push({name:'simultaneous_disjoint_jitter',duration:10000000,rows:Array.from({length:10000},(_,i)=>({wallStartMs:0,wallEndMs:900+i%201,mediaStartMs:i*1000,mediaEndMs:(i+1)*1000}))});
cases.push({name:'partially_overlapping_jitter',duration:5000500,rows:Array.from({length:10000},(_,i)=>({wallStartMs:i%151,wallEndMs:i%151+900+i%201,mediaStartMs:i*500,mediaEndMs:i*500+1000}))});
const measurements=[];
for(const sample of cases){let t=performance.now();const reference=before.firstCompletionTime(sample.duration,sample.rows);const beforeMs=performance.now()-t;t=performance.now();const actual=after.firstCompletionTime(sample.duration,sample.rows);const afterMs=performance.now()-t;measurements.push({name:sample.name,segments:sample.rows.length,before_ms:Math.round(beforeMs),after_ms:Math.round(afterMs),equal:JSON.stringify(reference)===JSON.stringify(actual),budget_ms:2000,budget_pass:afterMs<2000,result:actual});}
let seed=2457;const random=(n)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
let mismatches=0;
for(let k=0;k<200;k++){const rows=Array.from({length:30},()=>{const wallStartMs=random(1000),mediaStartMs=random(50000);return {wallStartMs,wallEndMs:wallStartMs+900+random(201),mediaStartMs,mediaEndMs:mediaStartMs+1000+random(50000)};});const window={startMs:random(100),endMs:1000+random(1200)};if(JSON.stringify(before.firstCompletionTime(100000,rows,window))!==JSON.stringify(after.firstCompletionTime(100000,rows,window)))mismatches++;}
const receipt={scope:'Synthetic arithmetic only; same exact rational reference before optimization; no DB or network',measurements,random_cases:200,mismatches,status:measurements.every(x=>x.equal&&x.budget_pass)&&mismatches===0?'PASS':'FAIL'};
writeFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/full-metrics/performance-jitter.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
