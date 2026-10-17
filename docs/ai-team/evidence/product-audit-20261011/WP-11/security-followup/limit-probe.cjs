const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base='http://127.0.0.1:31024';const report={status:'IN_PROGRESS',checks:[]};
(async()=>{try{
report.stage='referral';for(let i=0;i<60;i++){const r=await fetch(base+'/r/wp11-synthetic-nonexistent-code',{redirect:'manual'});assert.equal(r.status,307);await r.arrayBuffer();}
const limited=await fetch(base+'/r/wp11-synthetic-nonexistent-code',{redirect:'manual'});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);await limited.arrayBuffer();report.checks.push({route:'referral-get',allowed:60,nextStatus:429});
report.stage='release';const request={method:'DELETE',headers:{origin:base,'content-type':'application/json','x-celebratedeal-client':'web'},body:JSON.stringify({vendorId:'synthetic-rate-limit-probe',liveId:'synthetic-no-live'})};
for(let i=0;i<120;i++){const r=await fetch(base+'/api/live-admission',request);assert.equal(r.status,200);await r.arrayBuffer();}
const release=await fetch(base+'/api/live-admission',request);assert.equal(release.status,429);await release.arrayBuffer();const admit=await fetch(base+'/api/live-admission',{...request,method:'POST',body:'{}'});assert.equal(admit.status,400);await admit.arrayBuffer();report.checks.push({route:'live-admission-delete',allowed:120,nextStatus:429,postBucketIndependent:true});report.status='PASS';
}catch(e){report.status='FAIL';report.errorType=e.name;process.exitCode=1;}finally{fs.writeFileSync(path.join(__dirname,'limit-probe-result.json'),JSON.stringify(report,null,2));}})();
