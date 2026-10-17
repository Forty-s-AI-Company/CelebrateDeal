from pathlib import Path
import sys,json
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration';sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
s=json.loads((out/'snapshot-final-contract.json').read_text(encoding='utf-8'));assert snapshot_revision(root,s['files'])==s['revision']
for name in ['ui-feedback','lp-js','webinar']:
 result=run_check('browser-'+name,s['revision'],[sys.executable,str(out/f'run-final-contract-browser-{name}.py')],out/'checks-final-contract'/f'browser-{name}.json',timeout=420)
 print(json.dumps(result),flush=True)
 if result['status']!='PASS':sys.exit(1)
