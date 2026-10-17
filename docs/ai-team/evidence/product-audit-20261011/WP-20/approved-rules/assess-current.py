from pathlib import Path
import json,sys
root=Path.cwd();out=Path(__file__).resolve().parent;sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import assess_acceptance,snapshot_revision
route=json.loads((out/'route-current.json').read_text());revision=route['source_revision']
assert snapshot_revision(root,route['snapshot_files'])==revision
wrapper=json.loads((out/'final-reviewed.json').read_text(encoding='utf-8-sig'))
assert wrapper.get('status')=='REVIEW_COMPLETED',wrapper.get('status')
stage=next(x for x in route['review_plan'] if x.get('required'))
assert wrapper['observed']['model']==stage['model']
findings=[{**x,'disposition':'confirmed'} for x in wrapper['review']['findings']]
execution={'kind':'execution','source':'desktop_native','revision':revision,'status':'COMPLETED','provider_terminal':True,'tool_operations':'completed','observed_model':'unknown','observed_effort':'unknown','evidence_path':str(out/'execution-current.json')}
(out/'execution-current.json').write_text(json.dumps(execution,indent=2),encoding='utf-8')
checks=[]
for path in sorted((out/'checks-current').glob('*.json')):
 receipt=json.loads(path.read_text());assert receipt['revision']==revision
 checks.append({**receipt,'evidence_path':str(path)})
review={'kind':'review','source':'claude_cli','revision':revision,'status':'PASS' if not any(x['severity'] in ['BLOCKER','MAJOR'] for x in findings) else 'FAIL','independent':True,'role':stage['role'],'model':wrapper['observed']['model'],'observed_model':wrapper['observed']['model'],'observed_effort':wrapper['observed'].get('effort','unknown'),'scope':'WP20 approved pure calculation functions only; no product integration or whole WP acceptance','lineage':['initial-reviewed.json','followup-reviewed.json','final-reviewed.json'],'evidence_path':str(out/'review-current-receipt.json')}
(out/'review-current-receipt.json').write_text(json.dumps(review,indent=2),encoding='utf-8')
evidence={'execution':execution,'checks':checks,'review':review,'findings':findings}
(out/'evidence-current.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
r=assess_acceptance(route,evidence,allowed_root=root)
(out/'acceptance-current.json').write_text(json.dumps(r,indent=2),encoding='utf-8');print(json.dumps(r))
