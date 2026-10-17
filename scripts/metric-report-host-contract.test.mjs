import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateMetricHostDependencies} from './metric-report-host-build-gate.mjs';
import {readMetricHostConfig,verifyMetricHostArtifacts,disconnectMetricHost,writeMetricHostBuild} from './metric-report-host-runtime.mjs';
import {ARTIFACTS} from './metric-report-host-artifacts.mjs';
function owned(work){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'metric-host-contract-'));
 try{return work(root);}finally{
  const resolved=fs.realpathSync(root);
  assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.match(path.basename(resolved),/^metric-host-contract-/u);
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
test('AST gate accepts both literal quote styles for reviewed dependencies',()=>{
 validateMetricHostDependencies(`const a=require('zod');const b=require("node:crypto");`);
});
for(const source of ["require('fs')",'require(name)',"import('node:child_process')","require('node:vm')",'const alias=require;',"require(`zod`)"])
 test('AST gate rejects '+source,()=>assert.throws(()=>validateMetricHostDependencies(source),{message:'Metric host dependency not allowed'}));
test('runtime reads bounded ordinary JSON and rejects directories/oversized/dotenv paths',()=>owned(root=>{
 const file=path.join(root,'config.json');fs.writeFileSync(file,'{"entries":[]}');assert.deepEqual(readMetricHostConfig(file),{entries:[]});
 fs.writeFileSync(file,' '.repeat(40000));assert.throws(()=>readMetricHostConfig(file));
 const directory=path.join(root,'directory.json');fs.mkdirSync(directory);assert.throws(()=>readMetricHostConfig(directory));
 assert.throws(()=>readMetricHostConfig(path.join(root,'.ENV.json')));
}));
test('runtime descriptor read remains bounded if an opened config grows after fstat',()=>owned(root=>{
 const file=path.join(root,'config.json');fs.writeFileSync(file,'{}');const original=fs.fstatSync,read=fs.readSync;let changed=false,bytes=0;
 fs.fstatSync=(...args)=>{const held=original(...args);if(!changed){changed=true;fs.appendFileSync(file,' '.repeat(40000));}return held;};
 fs.readSync=(...args)=>{const count=read(...args);bytes+=count;return count;};
 try{assert.throws(()=>readMetricHostConfig(file));assert.ok(bytes<=32769);}finally{fs.fstatSync=original;fs.readSync=read;}
}));
test('all emitted host modules are checked, including queue/job junctions',()=>owned(root=>{
 writeMetricHostBuild(root,new Map(ARTIFACTS.map(name=>[name,'{}'])));const output=path.join(root,'.metric-worker');
 verifyMetricHostArtifacts(root);const target=path.join(root,'outside');fs.mkdirSync(target);
 for(const name of ['live-metric-report-queue.js','live-metric-report-job.js']){
  const file=path.join(output,name);fs.unlinkSync(file);fs.symlinkSync(target,file,'junction');
  assert.throws(()=>verifyMetricHostArtifacts(root));fs.unlinkSync(file);fs.writeFileSync(file,'{}');
 }
 verifyMetricHostArtifacts(root);
}));
test('disconnect failures return a fixed boolean without throwing private diagnostics',async()=>{
 assert.equal(await disconnectMetricHost({$disconnect:async()=>{throw new Error('private-driver-detail');}}),false);
 assert.equal(await disconnectMetricHost({$disconnect:async()=>{}}),true);
});
test('runtime and pre-build checks reject leftover dependency directories and linked output entries',()=>owned(root=>{
 const output=path.join(root,'.metric-worker');fs.mkdirSync(output);for(const name of ARTIFACTS)fs.writeFileSync(path.join(output,name),'{}');
 const extra=path.join(output,'node_modules');fs.mkdirSync(extra);
 assert.throws(()=>verifyMetricHostArtifacts(root));assert.throws(()=>verifyMetricHostArtifacts(root,{allowIncomplete:true}));
 fs.rmdirSync(extra);const stray=path.join(output,'stray.js');fs.writeFileSync(stray,'');
 assert.throws(()=>verifyMetricHostArtifacts(root));fs.unlinkSync(stray);
 const file=path.join(output,'live-metric-report-queue.js'),target=path.join(root,'target');fs.mkdirSync(target);fs.unlinkSync(file);fs.symlinkSync(target,file,'junction');
 assert.throws(()=>verifyMetricHostArtifacts(root,{allowIncomplete:true}));assert.deepEqual(fs.readdirSync(target),[]);
}));

test('interrupted build invalidates the previous completion seal and a rebuild recovers',()=>owned(root=>{
 const files=new Map(ARTIFACTS.map(name=>[name,'{}']));writeMetricHostBuild(root,files);verifyMetricHostArtifacts(root);
 const original=fs.writeFileSync;let writes=0;
 fs.writeFileSync=(...args)=>{if(++writes===2)throw new Error('simulated-build-interruption');return original(...args);};
 try{assert.throws(()=>writeMetricHostBuild(root,files));}finally{fs.writeFileSync=original;}
 assert.throws(()=>verifyMetricHostArtifacts(root));writeMetricHostBuild(root,files);verifyMetricHostArtifacts(root);
}));
test('runtime rejects a one-byte artifact change despite a complete filename catalog',()=>owned(root=>{
 writeMetricHostBuild(root,new Map(ARTIFACTS.map(name=>[name,'{}'])));
 fs.appendFileSync(path.join(root,'.metric-worker',ARTIFACTS[0]),' ');assert.throws(()=>verifyMetricHostArtifacts(root));
}));
