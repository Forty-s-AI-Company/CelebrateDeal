from pathlib import Path
import os,sys,json,shutil
root=Path.cwd();sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
out=root/'docs/ai-team/evidence/product-audit-20261011/WP-11/lease-expiry'
files=['src/app/api/live-admission/route.lease-db.test.ts','src/app/api/live-admission/route.ts','src/lib/live-quota-admission.ts','src/lib/live-quota-admission.test.ts','src/lib/rate-limit.ts']
s={'root':str(root),'files':files,'revision':snapshot_revision(root,files)};(out/'snapshot-repaired.json').write_text(json.dumps(s),encoding='utf-8')
os.environ['DATABASE_URL']='postgresql://wp05_synthetic:wp05_synthetic_only@127.0.0.1:64506/celebratedeal_test';os.environ['DIRECT_URL']=os.environ['DATABASE_URL'];node=shutil.which('node')
checks=[('lease-db',[node,'node_modules/vitest/vitest.mjs','run',files[0],'--reporter=json','--outputFile='+str(out/'repaired-db.json')]),('unit',[node,'node_modules/vitest/vitest.mjs','run','src/lib/live-quota-admission.test.ts','src/app/api/live-admission/route.test.ts','--reporter=json','--outputFile='+str(out/'repaired-unit.json')]),('lint',[node,'node_modules/eslint/bin/eslint.js',*files]),('typecheck',[node,'node_modules/typescript/bin/tsc','--noEmit'])]
for name,cmd in checks: print(json.dumps(run_check(name,s['revision'],cmd,out/'checks-repaired'/f'{name}.json',timeout=300)),flush=True)
