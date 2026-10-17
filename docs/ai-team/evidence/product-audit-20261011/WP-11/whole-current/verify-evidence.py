"""Validate receipts from tests executed this turn against the unchanged source."""
from pathlib import Path
import json, hashlib, sys
ROOT=Path.cwd(); OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/".ai-team/mcp_server"))
from routing import snapshot_revision
s=json.loads((OUT/"snapshot-current.json").read_text())
assert snapshot_revision(ROOT,s["files"])==s["revision"]
if sys.argv[1]=="db":
 d=json.loads((OUT/"disposable-db-result.json").read_text())
 assert d["status"]=="PASS" and d["tests"]=={"status":"PASS","total":9,"passed":9,"failed":0,"skipped":0}
 assert all(v=="PASS" for v in d["cleanup"].values())
 print("PASS: actual current-turn 9-test disposable DB receipt and cleanup; source unchanged")
elif sys.argv[1]=="remote":
 e=OUT.parent/"vercel-native/remote"
 for f,h in json.loads((e/"probe-source.json").read_text())["exact_application_files"].items():assert hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h
 for network in ["local","sandbox"]:
  d=json.loads((e/f"headers-{network}.json").read_text());assert d["exit"]==0 and d["result"]["passed"] and len(d["result"]["results"])==8 and all(x["passed"] for x in d["result"]["results"])
 d=json.loads((e/"two-egress-rate-limit.json").read_text());assert d["status"]=="PASS"
 rows=d["results"];b=rows["local_burst"]["result"]
 assert all(x["exit"]==0 for x in rows.values()) and b["requests"]==123 and b["duration_seconds"]<60 and b["http_counts"]=={"400":120,"429":3}
 assert b["synthetic_400_count"]==120 and b["confirmed_429_count"]==3
 assert rows["sandbox_before"]["result"]["synthetic_reached"] and rows["sandbox_after"]["result"]["synthetic_reached"] and rows["local_after"]["result"]["rate_limited"]
 assert json.loads((e/"provider-outage.json").read_text())["passed"]
 assert json.loads((e/"redis-durability.json").read_text())["result"]["redis_restart_persistence"]=="PASS"
 c=json.loads((e/"cleanup.json").read_text());assert c["temporary_host_removed"] and c["probe_deployment_removed"] and c["sandbox_removed"] and c["sandbox_stop_exit"]==0
 print("PASS: exact application modules, real same-project Preview dual-egress/Redis evidence and cleanup")
else:raise ValueError("unknown evidence scope")
