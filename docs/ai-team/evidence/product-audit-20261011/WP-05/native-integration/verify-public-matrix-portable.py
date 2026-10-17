from pathlib import Path
import json,sys
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
snapshot=json.loads((out/'snapshot-portable.json').read_text(encoding='utf-8'))
assert snapshot_revision(root,snapshot['files'])==snapshot['revision']
for name,report in [('browser','browser-result'),('browser-lp-native','browser-lp-result'),('browser-lp-js','browser-lp-js-result'),('browser-webinar-native','browser-webinar-result'),('browser-webinar-js','browser-webinar-js-result'),('browser-partner','browser-partner-result')]:
 receipt=json.loads((out/'checks-portable'/f'{name}.json').read_text(encoding='utf-8'))
 data=json.loads((out/f'{report}.json').read_text(encoding='utf-8'))
 assert receipt['revision']==snapshot['revision'] and receipt['status']=='PASS' and receipt['exit_code']==0
 assert data['status']=='PASS' and data['cleanup'] is True and len(data['checks'])==4
 assert {case['engine'] for case in data['checks']}=={'chromium','firefox'}
 if name in {'browser','browser-partner'}:
  assert {(c['engine'],c['javascript']) for c in data['checks']}=={(e,j) for e in ['chromium','firefox'] for j in [False,True]}
 else:
  assert {(c['engine'],c['entry']) for c in data['checks']}=={(e,p) for e in ['chromium','firefox'] for p in ['root','step']}
  assert all(c['javascript']==name.endswith('-js') for c in data['checks'])
 for case in data['checks']:
  assert case['refill'] and case['success'] and case['draftCleared'] and case['noMailSent']
print('24 public entry cases verified: form, document root/step, webinar root/step and partner; Chromium/Firefox, JS/no-JS. This does not verify every error status on every entry.')
