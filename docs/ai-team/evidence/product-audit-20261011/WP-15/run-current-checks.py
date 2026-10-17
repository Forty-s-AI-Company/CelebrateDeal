from pathlib import Path
import json,sys,shutil
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-15';sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
s=json.loads((out/'snapshot-current.json').read_text());assert snapshot_revision(root,s['files'])==s['revision']
node=shutil.which('node')
checks=[('targeted',[node,'node_modules/vitest/vitest.mjs','run',*s['tests'],'--reporter=json','--outputFile='+str(out/'targeted-current.json')]),('lint',[node,'node_modules/eslint/bin/eslint.js',*s['product_files'],*s['tests']]),('typecheck',[node,'node_modules/typescript/bin/tsc','--noEmit'])]
checks.extend((name,[node,str(out/file)]) for name,file in [('a11y','run-component-browser.cjs'),('shell-a11y','run-shell-browser.cjs'),('dashboard-a11y','run-dashboard-browser.cjs'),('first-viewport','run-operations-shell.cjs')])
for name,command in checks:
 r=run_check(name,s['revision'],command,out/'checks-current'/f'{name}.json',timeout=300)
 print(json.dumps(r),flush=True)
 if r['status']!='PASS':break
assert snapshot_revision(root,s['files'])==s['revision']
