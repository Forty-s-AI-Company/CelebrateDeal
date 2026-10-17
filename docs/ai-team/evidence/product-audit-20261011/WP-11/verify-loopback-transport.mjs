import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
const root=process.cwd(), out=path.join(root,"docs/ai-team/evidence/product-audit-20261011/WP-11");
const assets=path.join(root,".ai-team/tmp/wp11-loopback-proof");fs.mkdirSync(assets,{recursive:true});
const report={status:"IN_PROGRESS",scope:"Real loopback proxy and production resolver code over local HTTP; synthetic upstream, not application routes or cloud deployment",checks:[],cleanup:false};
let upstream,stopProxy;
try{
 await build({entryPoints:[path.join(root,"src/lib/request-client-ip.ts")],outfile:path.join(assets,"resolver.mjs"),bundle:true,platform:"node",format:"esm"});
 const {getRequestClientIp}=await import(pathToFileURL(path.join(assets,"resolver.mjs")));
 const {startPrivateChatLoopbackIngress}=await import(pathToFileURL(path.join(root,"scripts/live-private-loopback-ingress.mjs")));
 const proof="synthetic-loopback-verification-only-000000000000";
 const config={trustMode:"cloudflare",deploymentSource:"cloudflare",ingressSecret:proof};
 upstream=http.createServer((req,res)=>{
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(typeof value==="string")headers.set(key,value);
  const ip=getRequestClientIp(new Request("http://127.0.0.1:32201"+req.url,{headers}),config);
  const stripped=["forwarded","x-forwarded-for","x-real-ip","proxy-authorization"].every(name=>!headers.has(name));
  res.writeHead(ip?200:403,{"Content-Type":"application/json"});res.end(JSON.stringify({accepted:ip==="127.0.0.1",stripped}));
 });
 await new Promise((resolve,reject)=>{upstream.once("error",reject);upstream.listen(32201,"127.0.0.1",resolve)});
 stopProxy=await startPrivateChatLoopbackIngress({port:32202,upstreamPort:32201,proof});
 const attempts=[{}, {"cf-connecting-ip":"203.0.113.90"}, {"x-forwarded-for":"203.0.113.90,198.51.100.2","x-real-ip":"203.0.113.90","forwarded":"for=203.0.113.90","proxy-authorization":"synthetic","x-celebratedeal-live-chat-ingress":"synthetic-forged-proof"}];
 for(const [index,headers] of attempts.entries()){
  const response=await fetch("http://127.0.0.1:32202/synthetic",{headers});assert.equal(response.status,200);assert.deepEqual(await response.json(),{accepted:true,stripped:true});report.checks.push({case:"proxy-"+index,status:"PASS"});
 }
 for(const [index,headers] of attempts.entries()){
  const response=await fetch("http://127.0.0.1:32201/synthetic",{headers});assert.equal(response.status,403);assert.equal((await response.json()).accepted,false);report.checks.push({case:"direct-unproved-"+index,status:"PASS"});
 }
 report.status="PASS";
}catch(error){report.status="FAIL";report.errorType=error.name;process.exitCode=1;}
finally{if(stopProxy)await stopProxy();if(upstream?.listening){upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}report.cleanup=true;fs.writeFileSync(path.join(out,"loopback-transport-result.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
