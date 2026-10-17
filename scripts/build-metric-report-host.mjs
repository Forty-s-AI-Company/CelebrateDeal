import ts from 'typescript';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {ALL_SOURCES,artifactName} from './metric-report-host-artifacts.mjs';
import {validateMetricHostDependencies} from './metric-report-host-build-gate.mjs';
import {writeMetricHostBuild} from './metric-report-host-runtime.mjs';
// Fixed source/build locations only; no dotenv, input URLs or source discovery.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const compiled=ALL_SOURCES.map(name=>{
  const source=fs.readFileSync(path.join(root,'src/lib',name+'.ts'),'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:name+'.ts'});
  if(result.diagnostics?.some(value=>value.category===ts.DiagnosticCategory.Error))throw new Error('Metric host build rejected');
  // A newly introduced runtime dependency must join this reviewed allowlist.
  // No source discovery or transitive test-only build dependency is needed.
  validateMetricHostDependencies(result.outputText);
  return [name,result.outputText];
});
writeMetricHostBuild(root,new Map([...compiled.map(([name,source])=>[artifactName(name),source]),
 ['package.json',JSON.stringify({private:true,type:'commonjs'})]]));
console.log('Metric report host build complete');
