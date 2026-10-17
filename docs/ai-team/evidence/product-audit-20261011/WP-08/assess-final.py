from pathlib import Path
import json,sys
root=Path.cwd();out=Path(__file__).resolve().parent
sys.path.insert(0,str(root/".ai-team/mcp_server"))
from routing import assess_acceptance,snapshot_revision
route=json.loads((out/"route-final-acceptance.json").read_text())
assert snapshot_revision(root,route["snapshot_files"])==route["source_revision"]
wrapper=json.loads((out/"acceptance-zh-reviewed.json").read_text(encoding="utf-8-sig"))
assert wrapper.get("status")=="REVIEW_COMPLETED",wrapper.get("status")
assert not [x for x in wrapper["review"]["findings"] if x["severity"] in ("BLOCKER","MAJOR")]
stage=next(x for x in route["review_plan"] if x.get("required"))
assert wrapper["observed"]["model"]==stage["model"]
receipt={"kind":"review","source":"claude_cli","revision":route["source_revision"],"status":"PASS","independent":True,"role":stage["role"],"model":wrapper["observed"]["model"],"observed_model":wrapper["observed"]["model"],"observed_effort":wrapper["observed"].get("effort","unknown"),"scope":"WP08 cumulative scoped source reviews and final coverage/terminal-evidence review; component tests with synthetic adapters, not full login flow","lineage":["batch1-reviewed.json","batch1-test-followup-reviewed.json","option-collision-reviewed.json","navigation-final-safe-reviewed.json","stale-target-reviewed.json","reports-safe-reviewed.json","editor-integration-reviewed.json","whole-wp-reviewed.json","puck-block-reviewed.json","dashboard-copy-reviewed.json","final-coverage-reviewed.json","acceptance-zh-reviewed.json"]}
receipt["evidence_path"]=str(out/"review-final-receipt.json")
Path(receipt["evidence_path"]).write_text(json.dumps(receipt,indent=2),encoding="utf-8")
evidence=json.loads((out/"evidence-final-pending-review.json").read_text());evidence["review"]=receipt
# Keep all current nonblocking findings visible to the gate, without calling them fixed.
evidence["findings"]=[{**x,"disposition":"confirmed"} for x in wrapper["review"]["findings"]]
(out/"evidence-final.json").write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding="utf-8")
result=assess_acceptance(route,evidence,allowed_root=root)
(out/"acceptance-final.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
print(json.dumps(result))
