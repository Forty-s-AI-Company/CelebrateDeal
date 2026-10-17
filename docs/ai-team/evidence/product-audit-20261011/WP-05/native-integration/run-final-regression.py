from pathlib import Path
import sys,json,shutil,os
root=Path.cwd();sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
snapshot=json.loads((out/'snapshot-result-proof-canonical.json').read_text(encoding='utf-8'))
snapshot['files'].remove('src/app/p/[slug]/loading-shell.tsx')
snapshot['files'] += ['src/components/registration-submission-feedback.tsx','src/components/registration-submission-feedback.test.tsx']
snapshot['revision']=snapshot_revision(root,snapshot['files'])
(out/'snapshot-final-regression.json').write_text(json.dumps(snapshot),encoding='utf-8')
rev=snapshot['revision'];node=shutil.which('node')
checks=[('unit',[node,'node_modules/vitest/vitest.mjs','run','src/app/api/form-submissions/route.test.ts','src/components/lead-form.test.tsx','src/components/landing-pages/funnel-page-document-renderer.test.tsx','src/components/landing-pages/funnel-webinar-experience.test.tsx','src/app/lp/[slug]/page.test.tsx','src/app/p/[slug]/page.test.tsx','src/lib/registration-form-fields.test.ts','src/lib/registration-form-retry-response.test.ts','src/components/registration-retry-context.test.tsx','src/lib/registration-form-retry.test.ts','src/app/loading.test.tsx','src/app/form/[slug]/page.test.tsx','src/components/registration-retry-boundary.test.tsx','src/lib/registration-submission-receipt.test.ts','src/components/registration-submission-feedback.test.tsx','--reporter=json','--outputFile='+str(out/'unit-final-regression.json')]),('lint',[node,'node_modules/eslint/bin/eslint.js',*[f for f in snapshot['files'] if f.endswith(('.ts','.tsx'))]]),('typecheck',[node,'node_modules/typescript/bin/tsc','--noEmit']),('submission-invariant',[sys.executable,str(out/'verify-core.py')])]
for name,cmd in checks:
 print(json.dumps(run_check(name,rev,cmd,out/'checks-final-regression'/f'{name}.json',timeout=300)),flush=True)
os.environ['DATABASE_URL']='postgresql://wp05_synthetic:wp05_synthetic_only@127.0.0.1:64506/celebratedeal_test'
os.environ['DIRECT_URL']=os.environ['DATABASE_URL']
print(json.dumps(run_check('postgresql',rev,[node,'node_modules/vitest/vitest.mjs','run','src/lib/registration-form-retry.db.test.ts','src/app/api/form-submissions/route.db.test.ts','--reporter=json','--outputFile='+str(out/'db-final-regression.json')],out/'checks-final-regression/postgresql.json',timeout=180)),flush=True)

for name,runner in [('browser','run-final-browser-ui-feedback.py'),('browser-lp-native','run-final-browser-lp.py'),('browser-lp-js','run-final-browser-lp-js.py'),('browser-webinar-native','run-final-browser-webinar.py'),('browser-webinar-js','run-final-browser-webinar-js.py'),('browser-partner','run-final-browser-partner.py')]:
 print(json.dumps(run_check(name,rev,[sys.executable,str(out/runner)],out/'checks-final-regression'/f'{name}.json',timeout=420)),flush=True)

print(json.dumps(run_check('browser-status',rev,[sys.executable,str(out/'run-final-browser-status.py')],out/'checks-final-regression/browser-status.json',timeout=420)),flush=True)
