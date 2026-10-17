from pathlib import Path
import json,sys
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration';sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
from validation_runner import run_check
s=json.loads((out/'snapshot-attribution-repair.json').read_text(encoding='utf-8'))
assert snapshot_revision(root,s['files'])==s['revision']
for engine in ['chromium','firefox']:
 result=run_check('browser-attribution-'+engine,s['revision'],[sys.executable,str(out/'run-browser-attribution.py'),engine],out/('browser-attribution-'+engine+'-receipt.json'),timeout=420)
 print(json.dumps(result),flush=True)
 if result['status']!='PASS':sys.exit(1)
