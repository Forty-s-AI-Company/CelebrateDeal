import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";
const require=createRequire(import.meta.url);
const output="docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/ssi-minimal-diagnostic.json";
const receipt={status:"FAIL",acceptance:"NOT_APPLICABLE",cases:[],cleanup:null};
let migration;
try {
  const source=fs.readFileSync("node_modules/.prisma/client/index.js","utf8");
  const paths=JSON.parse(source.match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??"null");
  assert.ok(paths&&Object.values(paths).every(value=>value===null));
  const {PrismaClient}=require("@prisma/client");
  migration=await main({afterMigrate:async({databaseUrl})=>{
    const url=new URL(databaseUrl);
    assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/celebratedeal_test");
    url.searchParams.set("connection_limit","24");
    const db=new PrismaClient({datasourceUrl:url.toString()});
    try {
      const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
      // Separate synthetic tables: no product triggers or shared business rows.
      for(const mode of ["plain","indexed","admitted"]) {
        const indexed=mode!=="plain";
        const admission=mode==="admitted";
        const table=`"wp20_ssi_${mode}"`;
        await db.$executeRawUnsafe(`CREATE TABLE ${table}(id int PRIMARY KEY,status int NOT NULL) WITH(fillfactor=50)`);
        if(indexed)await db.$executeRawUnsafe(`CREATE INDEX ON ${table}(status)`);
        await db.$executeRawUnsafe(`INSERT INTO ${table} SELECT i,0 FROM generate_series(1,20) i`);
        let arrived=0,release;
        const gate=new Promise(resolve=>{release=resolve;});
        const timer=setTimeout(()=>release(),10000);
        const outcomes=await Promise.all(Array.from({length:20},async(_,i)=>{
          const failures=[];
          // Admission experiment synchronizes incoming requests, not DB snapshots.
          // The unchanged plain/indexed cases still synchronize all snapshots.
          if(admission){arrived+=1;if(arrived===20){clearTimeout(timer);release();}await gate;}
          for(let attempt=0;attempt<2;attempt+=1){
            try {
              await db.$transaction(async tx=>{
                if(admission)await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
                // Match the observed index access without any product function.
                await tx.$executeRawUnsafe("SET LOCAL enable_seqscan=off");
                await tx.$queryRawUnsafe(`SELECT status FROM ${table} WHERE id=$1`,i+1);
                if(attempt===0&&!admission){arrived+=1;if(arrived===20){clearTimeout(timer);release();}await gate;}
                await tx.$executeRawUnsafe(`UPDATE ${table} SET status=1 WHERE id=$1`,i+1);
              },{isolationLevel:"Serializable",timeout:15000,maxWait:15000});
              return {committed:true,failures};
            }catch(error){
              const code=error?.meta?.code??error?.code;
              failures.push(["40001","P2034"].includes(code)?code:"OTHER");
              if(!["40001","P2034"].includes(code))break;
            }
          }
          return {committed:false,failures};
        }));
        clearTimeout(timer);assert.equal(arrived,20);
        receipt.cases.push({mode,indexedStatus:indexed,synchronizedSnapshots:admission?null:arrived,synchronizedRequests:admission?arrived:null,attempts:2,committed:outcomes.filter(x=>x.committed).length,failures:outcomes.flatMap(x=>x.failures)});
      }
      assert.equal(receipt.cases.find(item=>item.mode==="admitted").committed,20);
      receipt.status="DIAGNOSTIC_COMPLETE";
    }finally{await db.$disconnect();}
  }});
}catch{receipt.status="FAIL";}
receipt.cleanup=migration?.cleanup??"UNKNOWN";
if(migration?.status!=="PASS")receipt.status="FAIL";
fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
process.exitCode=receipt.status==="DIAGNOSTIC_COMPLETE"?0:1;
