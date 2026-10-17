from pathlib import Path
import json,sys,shutil
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-08';sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
s=json.loads((out/'snapshot-terminology-stable.json').read_text());assert snapshot_revision(root,s['files'])==s['revision']
node=shutil.which('node')
tests=['src/components/landing-pages/funnel-display-labels.test.ts','src/components/landing-pages/funnel-operations-panel.test.tsx','src/components/app-shell.test.ts','src/app/(app)/dashboard/dashboard-kpis-loading.test.tsx','src/app/(app)/dashboard/dashboard-details-loading.test.tsx','src/components/landing-pages/funnel-element-inspector.test.tsx','src/lib/funnel-flow.test.ts','src/lib/funnel-operations.test.ts','src/lib/funnel-goal-step-pages.test.ts','src/components/team-performance-dashboard.test.tsx']
checks=[('terminology-snapshot',[node,'node_modules/vitest/vitest.mjs','run',*tests[:3]]),('a11y',[node,str(out/'run-component-browser.cjs')])]
for name,command in checks:
 result=run_check(name,s['revision'],command,out/'checks-terminology-stable'/f'{name}.json',timeout=300)
 print(json.dumps(result),flush=True)
