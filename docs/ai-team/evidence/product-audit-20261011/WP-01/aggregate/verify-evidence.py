"""Revalidate existing immutable evidence; never claim a browser rerun."""
import json, subprocess, sys
from pathlib import Path
root=Path.cwd()
sys.path.insert(0,str(root/'.ai-team/mcp_server'))
from routing import snapshot_revision
base=root/'docs/ai-team/evidence/product-audit-20261011'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
for wp in ['WP-06','WP-07']:
 p=base/wp;s=read(p/'final-snapshot.json')
 assert read(p/'acceptance.json')['status']=='READY'
 assert snapshot_revision(root,s['files'])==s['revision']
p=base/'WP-01/form-submit';s=read(p/'snapshot-diagnostic.json')
assert snapshot_revision(root,s['files'])==s['revision']
for engine in ['chromium','firefox']:
 receipt=read(p/('diagnostic-'+engine+'-check.json'))
 assert receipt['source']=='validation_runner' and receipt['status']=='PASS' and receipt['exit_code']==0 and receipt['revision']==s['revision']
 report=read(p/('browser-'+engine+'-result.json'))
 assert report['status']=='PASS' and report['restored'] is True
 rows={x['label']:x for x in report['checks']}
 for label in ['project-unpublished','disabled-form','invalid-operations']:
  row=rows[label];assert row['httpStatus']==404 and row['merchantReasonsAbsent'] and row['authoredContentAbsent']
 assert rows['published-root']['httpStatus']==200 and rows['published-root']['formVisible']
 row=rows['actual-browser-registration']
 assert row['httpStatus']==200 and row['submissionCount']==1 and row['sendAttempts']==0
 assert all(row[k] is True for k in ['verificationRequired','funnelProvenance','verificationDeliveryQueued','duplicateSubmissionDeduplicated'])
 assert rows['expired-closed']['httpStatus']==200
 assert report['axe'] and all(x['violations']==[] for x in report['axe'])
# Explicit D-1 invariants: schema and exact project publication function remain unchanged.
assert subprocess.run(['git','diff','--quiet','HEAD','--','prisma/schema.prisma','prisma/migrations']).returncode==0
name='src/app/actions/sales-workspace-actions.ts'
original=subprocess.run(['git','show','HEAD:'+name],capture_output=True,check=True).stdout.decode('utf-8').replace('\r\n','\n')
current=(root/name).read_text(encoding='utf-8').replace('\r\n','\n')
def publication(text):return text.split('export async function publishSalesProjectAction',1)[1].split('export async function ',1)[0]
assert publication(original)==publication(current)
print('Current source, browser evidence, prerequisites, schema and publication gate validated')
