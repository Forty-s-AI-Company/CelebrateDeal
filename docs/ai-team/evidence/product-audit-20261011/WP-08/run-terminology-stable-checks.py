from pathlib import Path
import json,sys,shutil
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-08';sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
s=json.loads((out/'snapshot-terminology-stable.json').read_text());assert snapshot_revision(root,s['files'])==s['revision']
node=shutil.which('node')
tests=['src/components/landing-pages/funnel-display-labels.test.ts','src/components/landing-pages/funnel-operations-panel.test.tsx','src/components/app-shell.test.ts','src/app/(app)/dashboard/dashboard-kpis-loading.test.tsx','src/app/(app)/dashboard/dashboard-details-loading.test.tsx','src/components/landing-pages/funnel-element-inspector.test.tsx','src/lib/funnel-flow.test.ts','src/lib/funnel-operations.test.ts','src/lib/funnel-goal-step-pages.test.ts','src/components/team-performance-dashboard.test.tsx']
tests.append('src/components/landing-pages/funnel-popup-preview.test.tsx')
tests.extend(['src/lib/funnel-block-library.test.ts','src/lib/payment-webhook-invariants.test.ts'])
checks=[('targeted',[node,'node_modules/vitest/vitest.mjs','run',*tests,'--reporter=json','--outputFile='+str(out/'targeted-terminology-stable.json')]),('lint',[node,'node_modules/eslint/bin/eslint.js',*[f for f in s['files'] if f.endswith(('.ts','.tsx'))]]),('typecheck',[node,'node_modules/typescript/bin/tsc','--noEmit'])]
for name,command in checks:
 result=run_check(name,s['revision'],command,out/'checks-terminology-stable'/f'{name}.json',timeout=300)
 print(json.dumps(result),flush=True)
