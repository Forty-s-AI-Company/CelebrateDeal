"""Validate recorded integrations against the immutable current source; does not rerun remote probes."""
import hashlib
import json
from pathlib import Path
import sys

root = Path.cwd()
sys.path.insert(0, str(root / ".ai-team/mcp_server"))
import routing
base = root / "docs/ai-team/evidence/product-audit-20261011/WP-11"
def read(name):
    return json.loads((base / name).read_text(encoding="utf-8-sig"))
snapshot = read("whole-integrated/snapshot.json")
assert routing.snapshot_revision(root, snapshot["files"]) == snapshot["revision"]
manifest = read("whole-integrated/all-source-manifest.json")["files"]
assert len(manifest) == 100
for filename, digest in manifest.items():
    assert hashlib.sha256((root / filename).read_bytes()).hexdigest() == digest
source = read("current-preview/source.json")
assert source["parent_revision"] == snapshot["revision"] and source["all100_files_match"]
# Remote receipts are fixed synthetic boundary tests, not business transactions.
ready = read("current-preview/readiness.json")
assert ready["http_status"] == 200 and ready["native_configured"] and ready["configuration_ready"] and ready["shape_valid"]
for name, count in [("matrix-local",10),("matrix-sandbox",10),("headers-local",8),("headers-sandbox",8),("provider-outage",8)]:
    value = read("current-preview/" + name + ".json")
    assert value["passed"] and len(value["rows"]) == count
    assert all(row["passed"] for row in value["rows"])
burst = read("current-preview/burst-local.json")
assert burst["requests"] == 123 and burst["validation_400_count"] == 120 and burst["confirmed_429_count"] == 3 and burst["within_window"]
assert read("current-preview/second-egress.json")["http_status"] == 400
assert read("current-preview/first-egress-after.json")["http_status"] == 429
outage = read("current-preview/provider-outage.json")
assert outage["real_redis_stopped"] and all(r["provider_unavailable"] and not r["source_unavailable"] for r in outage["rows"])
# Retain local real DB and browser results; never relabel these as remote tests.
db = read("whole-integrated/disposable-db-result.json")
assert db["status"] == "PASS" and db["tests"]["passed"] == 31 and db["tests"]["failed"] == 0 and db["tests"]["skipped"] == 0
assert all(v == "PASS" for v in db["cleanup"].values())
browser = read("whole-integrated/browser-result.json")
assert browser["status"] == "PASS" and browser["serverStopped"]
assert {e["engine"] for e in browser["engines"]} == {"chromium", "firefox"}
assert all(e["exitCode"] == 0 and e["status"] == "PASS" and len(e["checks"]) == 9 for e in browser["engines"])
assert all(v == "PASS" for v in browser["cleanup"].values())
cleanup = read("current-preview/cleanup-verification.json")
assert cleanup["staging"] == {"id":"dpl_6Nq2X1U9GDs5QVek7dTcdpmPM1hJ", "state":"READY"}
assert cleanup["retainedPreview"]["state"] == "READY" and cleanup["temporaryPreview"]["unavailable"]
assert read("current-preview/firewall-cleanup.json")["status"] == "PUBLISHED"
assert read("current-preview/cleanup-command.json")["sandbox"] == "STOPPED"
print("Source binding and retained local/remote integration evidence verified; Production and global lint not certified.")
