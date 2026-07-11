import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from pipeline_engine import (
    atomic_compare_and_swap,
    build_receipt,
    complete_stage,
    ready_stage_ids,
    recover_interrupted_stage,
    start_stage,
    pipeline_digest,
    sign_payload,
    validate_pipeline_state,
    validate_release_evidence,
)
from routing import validate_stage_graph

KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
WRITE_EVIDENCE = {
    "commitSha": "1" * 40,
    "approvedTree": "2" * 40,
    "validationLogHash": "3" * 64,
    "stagedSecretScan": {"status": "passed", "sha256": "4" * 64},
    "qaEvidence": [],
}


def state() -> dict:
    value = {
        "schemaVersion": 2, "runId": "run-1", "revision": 1, "pipelineId": "task:T-1",
        "sourceRevision": "commit-1",
        "sourceFingerprint": "a" * 64,
        "status": "planned", "mode": "hybrid", "currentStage": None,
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        "milestone": None, "taskId": "T-1", "taskType": "backend", "taskDomain": "backend",
        "stages": [
            {"stageId": "01-implement", "roleId": "backend-engineer", "provider": "codex", "mode": "workspace-write", "required": True, "status": "pending", "attempts": 0, "dependsOn": [], "artifactPaths": [], "receipt": None, "error": None},
            {"stageId": "02-review", "roleId": "code-reviewer", "provider": "codex", "mode": "read-only", "required": True, "status": "pending", "attempts": 0, "dependsOn": ["01-implement"], "artifactPaths": [], "receipt": None, "error": None},
        ],
    }
    value["pipelineDigest"] = pipeline_digest(value["stages"])
    return value


class PipelineEngineTest(unittest.TestCase):
    def test_attestation_rejects_weak_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "256-bit"):
            sign_payload({"status": "passed"}, "weak-key")

    def test_ready_stage_respects_dependencies(self) -> None:
        value = state()
        self.assertEqual(ready_stage_ids(value), ["01-implement"])
        started = start_stage(value, "01-implement")
        self.assertEqual(started["revision"], 2)
        with self.assertRaises(ValueError):
            start_stage(started, "02-review")

    def test_duplicate_missing_self_and_cycle_dependencies_are_rejected(self) -> None:
        cases = [
            [{"id": "a", "dependsOn": []}, {"id": "a", "dependsOn": []}],
            [{"id": "a", "dependsOn": ["missing"]}],
            [{"id": "a", "dependsOn": ["a"]}],
            [{"id": "a", "dependsOn": ["b"]}, {"id": "b", "dependsOn": ["a"]}],
        ]
        for stages in cases:
            with self.assertRaises(ValueError):
                validate_stage_graph(stages)

    def test_receipt_binds_run_role_provider_and_artifact_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "report.json"
            artifact.write_text("{}", encoding="utf-8")
            started = start_stage(state(), "01-implement")
            receipt = build_receipt(started, "01-implement", "completed", ["report.json"], root, execution_evidence=WRITE_EVIDENCE, attestation_key=KEY)
            completed = complete_stage(started, receipt, root, KEY)
            self.assertEqual(completed["stages"][0]["status"], "completed")
            self.assertEqual(ready_stage_ids(completed), ["02-review"])
            artifact.write_text('{"changed":true}', encoding="utf-8")
            with self.assertRaises(ValueError):
                complete_stage(started, receipt, root, KEY)

    def test_failed_or_conditional_stage_blocks_downstream(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for status in ["failed", "conditional"]:
                started = start_stage(state(), "01-implement")
                receipt = build_receipt(started, "01-implement", status, [], root, attestation_key=KEY)
                updated = complete_stage(started, receipt, root, KEY)
                self.assertEqual(updated["status"], "blocked")
                self.assertEqual(updated["stages"][1]["status"], "blocked")

    def test_failure_blocks_all_descendants(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            value = state()
            value["stages"].append(
                {"stageId": "03-release", "roleId": "release-manager", "provider": "codex", "mode": "read-only", "required": True, "status": "pending", "attempts": 0, "dependsOn": ["02-review"], "artifactPaths": [], "receipt": None, "error": None}
            )
            value["pipelineDigest"] = pipeline_digest(value["stages"])
            started = start_stage(value, "01-implement")
            receipt = build_receipt(started, "01-implement", "failed", [], Path(directory), attestation_key=KEY)
            updated = complete_stage(started, receipt, Path(directory), KEY)
            self.assertEqual([item["status"] for item in updated["stages"]], ["failed", "blocked", "blocked"])

    def test_completed_stage_requires_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            started = start_stage(state(), "01-implement")
            with self.assertRaises(ValueError):
                build_receipt(started, "01-implement", "completed", [], Path(directory), attestation_key=KEY)

    def test_stage_completion_requires_valid_coordinator_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "evidence.json"
            artifact.write_text("{}", encoding="utf-8")
            started = start_stage(state(), "01-implement")
            with self.assertRaisesRegex(ValueError, "ATTESTATION_KEY"):
                build_receipt(started, "01-implement", "completed", ["evidence.json"], root)
            receipt = build_receipt(started, "01-implement", "completed", ["evidence.json"], root, execution_evidence=WRITE_EVIDENCE, attestation_key=KEY)
            receipt["attestation"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "attestation"):
                complete_stage(started, receipt, root, KEY)

    def test_receipt_rejects_path_traversal_and_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            outside_artifact = Path(outside) / "outside.json"
            outside_artifact.write_text("{}", encoding="utf-8")
            started = start_stage(state(), "01-implement")
            with self.assertRaises(ValueError):
                build_receipt(started, "01-implement", "completed", ["../outside.json"], root, attestation_key=KEY)
            link = root / "linked.json"
            try:
                link.symlink_to(outside_artifact)
            except OSError:
                return
            with self.assertRaises(ValueError):
                build_receipt(started, "01-implement", "completed", ["linked.json"], root, attestation_key=KEY)

    def test_release_blocks_missing_receipts_changed_artifacts_and_open_high_issues(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = state()
            value["stages"][0]["status"] = "completed"
            value["stages"][0]["attempts"] = 1
            blockers = validate_release_evidence(value, root, [{"id": "P1-1", "severity": "P1", "status": "open"}], value["pipelineDigest"], value["sourceRevision"], value["sourceFingerprint"], KEY)
            self.assertIn("receipt:01-implement:missing-or-stale", blockers)
            self.assertIn("issue:P1-1", blockers)

    def test_release_rejects_receipt_identity_or_status_forgery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "evidence.json"
            artifact.write_text("{}", encoding="utf-8")
            started = start_stage(state(), "01-implement")
            receipt = build_receipt(started, "01-implement", "completed", ["evidence.json"], root, execution_evidence=WRITE_EVIDENCE, attestation_key=KEY)
            completed = complete_stage(started, receipt, root, KEY)
            for field, forged in [("roleId", "wrong-role"), ("provider", "antigravity"), ("stageId", "02-review"), ("status", "conditional")]:
                value = json.loads(json.dumps(completed))
                value["stages"][0]["receipt"][field] = forged
                blockers = validate_release_evidence(value, root, [], value["pipelineDigest"], value["sourceRevision"], value["sourceFingerprint"], KEY)
                self.assertIn("receipt:01-implement:missing-or-stale", blockers)

    def test_release_rejects_forged_pipeline_definition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            value = state()
            blockers = validate_release_evidence(value, Path(directory), [], "0" * 64, value["sourceRevision"], value["sourceFingerprint"], KEY)
            self.assertIn("pipeline:untrusted-or-changed-definition", blockers)

    def test_release_accepts_attempt_nonce_bound_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = state()
            value["stages"] = [value["stages"][0]]
            value["stages"][0]["mode"] = "read-only"
            value["pipelineDigest"] = pipeline_digest(value["stages"])
            started = start_stage(value, "01-implement")
            stage = started["stages"][0]
            artifact = root / "reports" / "ai-team" / "runtime" / f"run-1-01-implement-a{stage['attempts']}-{stage['attemptNonce']}.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("{}", encoding="utf-8")
            receipt = build_receipt(started, "01-implement", "completed", [str(artifact.relative_to(root))], root, attestation_key=KEY)
            completed = complete_stage(started, receipt, root, KEY)
            blockers = validate_release_evidence(
                completed, root, [], completed["pipelineDigest"], completed["sourceRevision"], completed["sourceFingerprint"], KEY,
            )
            self.assertNotIn("artifact:01-implement:unbound-or-reused", blockers)

    def test_release_rejects_forged_source_revision_and_reused_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = state()
            value["stages"] = [value["stages"][0]]
            value["pipelineDigest"] = pipeline_digest(value["stages"])
            value["stages"][0]["status"] = "completed"
            value["stages"][0]["attempts"] = 1
            artifact = root / "reports" / "ai-team" / "runtime" / f"{value['runId']}-01-implement.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("{}", encoding="utf-8")
            receipt = build_receipt(value, "01-implement", "completed", [str(artifact.relative_to(root))], root, execution_evidence=WRITE_EVIDENCE, attestation_key=KEY)
            value["stages"][0]["receipt"] = receipt
            value["stages"][0]["artifactPaths"] = [receipt["artifacts"][0]["path"]]
            blockers = validate_release_evidence(value, root, [], value["pipelineDigest"], "different-commit", value["sourceFingerprint"], KEY)
            self.assertIn("pipeline:stale-or-untrusted-source-revision", blockers)
            value["stages"][0]["receipt"]["artifacts"][0]["path"] = "automation/README.md"
            value["stages"][0]["receipt"]["attestation"] = sign_payload(value["stages"][0]["receipt"], KEY)
            blockers = validate_release_evidence(value, root, [], value["pipelineDigest"], value["sourceRevision"], value["sourceFingerprint"], KEY)
            self.assertIn("artifact:01-implement:unbound-or-reused", blockers)

    def test_compare_and_swap_rejects_stale_worker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            value = state()
            path.write_text(json.dumps(value), encoding="utf-8")
            updated = dict(value)
            updated["revision"] = 2
            atomic_compare_and_swap(path, 1, updated)
            with self.assertRaises(RuntimeError):
                atomic_compare_and_swap(path, 1, updated)
            skipped = dict(updated)
            skipped["revision"] = 4
            with self.assertRaises(RuntimeError):
                atomic_compare_and_swap(path, 2, skipped)

    def test_compare_and_swap_allows_only_one_concurrent_worker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            value = state()
            path.write_text(json.dumps(value), encoding="utf-8")
            barrier = threading.Barrier(2)
            outcomes: list[str] = []

            def worker(label: str) -> None:
                updated = json.loads(json.dumps(value))
                updated["revision"] = 2
                updated["milestone"] = label
                barrier.wait()
                try:
                    atomic_compare_and_swap(path, 1, updated)
                    outcomes.append("passed")
                except RuntimeError:
                    outcomes.append("stale")

            threads = [threading.Thread(target=worker, args=(label,)) for label in ["a", "b"]]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(sorted(outcomes), ["passed", "stale"])
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["revision"], 2)

    def test_interrupted_stage_recovery_retries_then_exhausts(self) -> None:
        running = start_stage(state(), "01-implement")
        recovered = recover_interrupted_stage(running, "01-implement")
        self.assertEqual(recovered["stages"][0]["status"], "pending")
        self.assertEqual(recovered["stages"][0]["attempts"], 1)
        running_again = start_stage(recovered, "01-implement")
        running_again["stages"][0]["attempts"] = 3
        exhausted = recover_interrupted_stage(running_again, "01-implement")
        self.assertEqual(exhausted["stages"][0]["status"], "exhausted")
        self.assertEqual(exhausted["status"], "blocked")

    def test_completed_receipt_cannot_be_replayed_or_used_for_new_attempt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "evidence.json").write_text("{}", encoding="utf-8")
            started = start_stage(state(), "01-implement")
            receipt = build_receipt(started, "01-implement", "completed", ["evidence.json"], root, execution_evidence=WRITE_EVIDENCE, attestation_key=KEY)
            completed = complete_stage(started, receipt, root, KEY)
            with self.assertRaisesRegex(ValueError, "not running"):
                complete_stage(completed, receipt, root, KEY)
            recovered = recover_interrupted_stage(start_stage(state(), "01-implement"), "01-implement")
            second_attempt = start_stage(recovered, "01-implement")
            with self.assertRaisesRegex(ValueError, "attempt mismatch"):
                complete_stage(second_attempt, receipt, root, KEY)

    def test_compare_and_swap_is_process_safe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "state.json"
            template = root / "template.json"
            start_file = root / "start"
            value = state()
            target.write_text(json.dumps(value), encoding="utf-8")
            updated = json.loads(json.dumps(value))
            updated["revision"] = 2
            template.write_text(json.dumps(updated), encoding="utf-8")
            automation = Path(__file__).resolve().parent
            code = (
                "import json,sys,time; from pathlib import Path; "
                f"sys.path.insert(0,{str(automation)!r}); from pipeline_engine import atomic_compare_and_swap; "
                "target=Path(sys.argv[1]); template=Path(sys.argv[2]); gate=Path(sys.argv[3]); "
                "\nwhile not gate.exists(): time.sleep(0.005)\n"
                "value=json.loads(template.read_text(encoding='utf-8')); "
                "\ntry: atomic_compare_and_swap(target,1,value); print('passed')\n"
                "except RuntimeError: print('stale')\n"
            )
            processes = [subprocess.Popen([sys.executable, "-c", code, str(target), str(template), str(start_file)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
            start_file.write_text("go", encoding="utf-8")
            outputs: list[str] = []
            errors: list[str] = []
            for process in processes:
                stdout, stderr = process.communicate(timeout=20)
                outputs.append(stdout.strip())
                errors.append(stderr.strip())
            self.assertEqual(sorted(outputs), ["passed", "stale"], errors)
            self.assertFalse(target.with_suffix(".json.lock").exists())

    def test_pipeline_state_requires_role_provider_and_mode(self) -> None:
        value = state()
        del value["stages"][0]["roleId"]
        with self.assertRaises(ValueError):
            validate_pipeline_state(value)


if __name__ == "__main__":
    unittest.main()
