import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ARTIFACTS,BUILD_SEAL} from './metric-report-host-artifacts.mjs';
/** One descriptor, regular file and bounded read, including concurrent growth. */
export function readMetricHostConfig(file){
 const resolved=path.resolve(file);
 if(path.extname(resolved).toLowerCase()!=='.json'||/^\.env/iu.test(path.basename(resolved)))throw new Error('configuration');
 const before=fs.lstatSync(resolved);if(!before.isFile())throw new Error('configuration');
 const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0);
 const descriptor=fs.openSync(resolved,flags);
 try{
  const held=fs.fstatSync(descriptor);
  if(!held.isFile()||held.size>32768||held.dev!==before.dev||held.ino!==before.ino)throw new Error('configuration');
  const buffer=Buffer.alloc(32769);let count=0;
  while(count<buffer.length){const bytes=fs.readSync(descriptor,buffer,count,buffer.length-count,null);if(!bytes)break;count+=bytes;}
  if(count>32768)throw new Error('configuration');
  return JSON.parse(buffer.subarray(0,count).toString('utf8'));
 }finally{fs.closeSync(descriptor);}
}
export function verifyMetricHostArtifacts(root,{allowIncomplete=false}={}){
 const directory=path.join(root,'.metric-worker');let info;
 try{info=fs.lstatSync(directory);}catch(error){if(allowIncomplete&&error.code==='ENOENT')return;throw error;}
 if(!info.isDirectory()||fs.realpathSync(directory)!==directory)throw new Error('artifact');
 const names=fs.readdirSync(directory);
 if(names.some(name=>!ARTIFACTS.includes(name)&&name!==BUILD_SEAL)||(!allowIncomplete&&names.length!==ARTIFACTS.length+1))throw new Error('artifact');
 // Reject leftovers rather than deleting unknown files. In particular an
 // artifact-local node_modules must never shadow reviewed root dependencies.
 for(const name of names){const file=path.join(directory,name);if(fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())throw new Error('artifact');}
 if(allowIncomplete)return;
 const seal=JSON.parse(fs.readFileSync(path.join(directory,BUILD_SEAL),'utf8'));
 if(!seal||Array.isArray(seal)||Object.keys(seal).length!==ARTIFACTS.length||Object.keys(seal).some(name=>!ARTIFACTS.includes(name)))throw new Error('artifact');
 for(const name of ARTIFACTS){
  const file=path.join(root,'.metric-worker',name);
  if(fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())throw new Error('artifact');
  if(seal[name]!==createHash('sha256').update(fs.readFileSync(file)).digest('hex'))throw new Error('artifact');
 }
}
/** Single writer only. Invalidate the old completion seal before any output
 * changes; interrupted builds cannot pass runtime verification. Write last. */
export function writeMetricHostBuild(root,files){
 if(!(files instanceof Map)||files.size!==ARTIFACTS.length||[...files].some(([name,source])=>!ARTIFACTS.includes(name)||typeof source!=='string'))throw new Error('artifact');
 verifyMetricHostArtifacts(root,{allowIncomplete:true});
 const directory=path.join(root,'.metric-worker');fs.mkdirSync(directory,{recursive:true});
 const sealPath=path.join(directory,BUILD_SEAL);
 if(fs.existsSync(sealPath))fs.unlinkSync(sealPath);
 const seal={};
 for(const [name,source] of files){fs.writeFileSync(path.join(directory,name),source);seal[name]=createHash('sha256').update(source).digest('hex');}
 fs.writeFileSync(sealPath,JSON.stringify(seal));
}
/** A cleanup rejection must not escape the launcher's sanitized terminal. */
export async function disconnectMetricHost(db){try{await db?.$disconnect();return true;}catch{return false;}}
