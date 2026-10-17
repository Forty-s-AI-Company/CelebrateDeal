from pathlib import Path
import sys,json,shutil,os
root=Path.cwd();sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
snapshot=json.loads((out/'snapshot-final.json').read_text(encoding='utf-8'))
snapshot['files'].append('src/app/api/form-submissions/route.db.test.ts')
snapshot['revision']=snapshot_revision(root,snapshot['files'])
(out/'snapshot-portable.json').write_text(json.dumps(snapshot),encoding='utf-8')
rev=snapshot['revision'];node=shutil.which('node')
checks=[('unit',[node,'node_modules/vitest/vitest.mjs','run','src/app/api/form-submissions/route.test.ts','src/components/lead-form.test.tsx','src/components/landing-pages/funnel-page-document-renderer.test.tsx','src/components/landing-pages/funnel-webinar-experience.test.tsx','src/app/lp/[slug]/page.test.tsx','src/app/p/[slug]/page.test.tsx','src/lib/registration-form-fields.test.ts','src/lib/registration-form-retry-response.test.ts','src/components/registration-retry-context.test.tsx','src/lib/registration-form-retry.test.ts','src/app/loading.test.tsx','--reporter=json','--outputFile='+str(out/'unit-portable.json')]),('lint',[node,'node_modules/eslint/bin/eslint.js',*[f for f in snapshot['files'] if f.endswith(('.ts','.tsx'))]]),('typecheck',[node,'node_modules/typescript/bin/tsc','--noEmit']),('submission-invariant',[sys.executable,str(out/'verify-core.py')])]
for name,cmd in checks:
 print(json.dumps(run_check(name,rev,cmd,out/'checks-portable'/f'{name}.json',timeout=300)),flush=True)
os.environ['DATABASE_URL']='postgresql://wp05_synthetic:wp05_synthetic_only@127.0.0.1:64506/celebratedeal_test'
os.environ['DIRECT_URL']=os.environ['DATABASE_URL']
print(json.dumps(run_check('postgresql',rev,[node,'node_modules/vitest/vitest.mjs','run','src/lib/registration-form-retry.db.test.ts','src/app/api/form-submissions/route.db.test.ts','--reporter=json','--outputFile='+str(out/'db-portable.json')],out/'checks-portable/postgresql.json',timeout=180)),flush=True)

for name,runner in [('browser','run-browser.py'),('browser-lp-native','run-browser-lp.py'),('browser-lp-js','run-browser-lp-js.py'),('browser-webinar-native','run-browser-webinar.py'),('browser-webinar-js','run-browser-webinar-js.py'),('browser-partner','run-browser-partner.py')]:
 print(json.dumps(run_check(name,rev,[sys.executable,str(out/runner)],out/'checks-portable'/f'{name}.json',timeout=420)),flush=True)

print(json.dumps(run_check('browser-status',rev,[sys.executable,str(out/'run-browser-status.py')],out/'checks-portable/browser-status.json',timeout=420)),flush=True)
