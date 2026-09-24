from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
import uuid
import sys
from pathlib import Path
from validation_runner import run_check
from routing import snapshot_revision


HERE = Path(__file__).resolve().parent
SERVER = HERE / "server.py"
ROUTER = HERE.parent / "config" / "router.json"


def load_server(root: Path):
    previous_root = os.environ.get("AI_TEAM_ROOT")
    previous_config = os.environ.get("AI_TEAM_CONFIG")
    os.environ["AI_TEAM_ROOT"] = str(root)
    os.environ["AI_TEAM_CONFIG"] = str(ROUTER)
    try:
        name = f"ai_team_lite_test_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(name, SERVER)
        if spec is None or spec.loader is None:
            raise AssertionError("cannot load server module")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous_root is None:
            os.environ.pop("AI_TEAM_ROOT", None)
        else:
            os.environ["AI_TEAM_ROOT"] = previous_root
        if previous_config is None:
            os.environ.pop("AI_TEAM_CONFIG", None)
        else:
            os.environ["AI_TEAM_CONFIG"] = previous_config


class RouterServerTest(unittest.TestCase):
    def test_mcp_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            status = module.router_status()
            self.assertEqual(status["version"], "6.0")
            self.assertFalse(status["external_execution"])
            self.assertEqual(status["probe_mode"], "config_only")
            self.assertEqual(set(status["router"]["allowed_tools"]), {
                "router_status", "route_task", "assess_task", "snapshot_task", "goal_bootstrap", "goal_get_state",
                "goal_checkpoint", "goal_resume", "goal_finalize"})
            self.assertEqual(module.route_task("修改文案")["model"], "gpt-6-luna")
            source_file = Path(temporary) / "source.py"
            source_file.write_text("value = 1\n", encoding="utf-8")
            self.assertEqual(module.snapshot_task(["source.py"])["revision"], snapshot_revision(Path(temporary), ["source.py"]))
            result = module.route_task("one line payment webhook", "bug_fix", "trivial")
            self.assertEqual(result["signals"]["risk"], "critical")
            self.assertEqual(result["model"], "gpt-6-luna")
            self.assertEqual(result["review_plan"][0]["model"], "gpt-6-astra")
            self.assertEqual(result["execution"], "recommendation_only")

    def test_server_never_spawns(self):
        import ast
        source = SERVER.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imports = {node.names[0].name for node in ast.walk(tree) if isinstance(node, ast.Import)}
        self.assertFalse(imports & {"subprocess", "requests", "socket"})
        self.assertNotIn("spawn_agent(", source)

    def test_route_task_signal_precedence_and_difficulty_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            signals_only = module.route_task(
                "bounded security review",
                task_signals={"task_type": "security_review", "complexity": "low"},
            )
            self.assertEqual(signals_only["signals"]["task_type"], "security_review")
            self.assertEqual(signals_only["signals"]["risk"], "critical")
            self.assertEqual(signals_only["signals"]["complexity"], "low")
            self.assertEqual(signals_only["signals"]["risk"], "critical")
            self.assertEqual(signals_only["role"], "critical_review")

            explicit = module.route_task(
                "bounded task", "implement", "trivial",
                {"task_type": "security_review", "difficulty": "critical"},
            )
            self.assertEqual(explicit["signals"]["task_type"], "implement")
            self.assertEqual(explicit["signals"]["complexity"], "low")
            self.assertEqual(explicit["model_key"], "luna")

            explicit_critical = module.route_task(
                "bounded task", "implement", "critical", {"complexity": "low"},
            )
            self.assertEqual(explicit_critical["signals"]["complexity"], "very_high")
            self.assertNotEqual(explicit_critical["model_key"], "luna")

            explicit_routine = module.route_task(
                "bounded task", "implement", "routine", {"complexity": "high"},
            )
            self.assertEqual(explicit_routine["signals"]["complexity"], "medium")
            self.assertEqual(explicit_routine["model_key"], "luna")

            task_floor = module.route_task(
                "bounded task", "cross_module", "trivial", {"complexity": "low"},
            )
            self.assertEqual(task_floor["signals"]["complexity"], "high")
            risk_floor = module.route_task(
                "bounded task", "implement", "trivial", {"risk": "critical"},
            )
            self.assertEqual(risk_floor["signals"]["complexity"], "low")
            self.assertEqual(risk_floor["signals"]["risk_requirement"], "high")

            for difficulty, expected in (("trivial", "low"), ("routine", "medium"), ("complex", "high"), ("critical", "very_high")):
                self.assertEqual(module.route_task("bounded task", "implement", difficulty)["signals"]["complexity"], expected)
            for invalid in ("high", "nonsense", "typo", "unsupported"):
                with self.assertRaises(ValueError):
                    module.route_task("bounded task", "implement", invalid)

    def test_goal_gates_and_sensitive_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            with self.assertRaises(ValueError):
                module.route_task("token: synthetic")
            module.goal_bootstrap("test", "Safe", ["phase"])
            self.assertEqual(module.goal_finalize()["status"], "not_finalizable")

    def test_goal_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            created = module.goal_bootstrap("lite-test", "Lite test", ["phase-one"])
            self.assertEqual(created["status"], "created")
            self.assertEqual(module.goal_resume()["status"], "resumable")
            checkpoint = module.goal_checkpoint("phase-one", "verified", True, "", ["unit test"])
            self.assertEqual(checkpoint["status"], "checkpointed")
            self.assertEqual(module.goal_resume()["status"], "phases_complete_validation_required")
            self.assertEqual(module.goal_finalize("done")["status"], "not_finalizable")
            receipt = Path(temporary) / "receipt.json"
            (Path(temporary) / "source.py").write_text("value = 1\n", encoding="utf-8")
            revision = snapshot_revision(Path(temporary), ["source.py"])
            validation_path = Path(temporary) / "unit.json"
            run_check("unit", revision, [sys.executable, "-c", "import sys; sys.exit(0)"], validation_path)
            decision = module.route_task("bounded implementation", "implement", task_signals={
                "task_id": "lite-test", "source_revision": revision, "snapshot_root": temporary,
                "snapshot_files": ["source.py"], "required_checks": ["unit"]})
            execution = {"revision": revision, "status": "COMPLETED",
                                      "source": "desktop_native", "provider_terminal": True,
                                      "tool_operations": "completed", "evidence_path": str(receipt)}
            receipt.write_text(json.dumps({"kind": "execution", **execution}), encoding="utf-8")
            evidence = {"execution": execution,
                        "checks": [{"kind": "validation", "name": "unit", "revision": revision, "source": "validation_runner",
                                    "status": "PASS", "exit_code": 0, "evidence_path": str(validation_path)}]}
            self.assertEqual(module.goal_finalize("done", decision, evidence)["status"], "completed")

    def test_goal_does_not_overwrite_active_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            module.goal_bootstrap("first", "First", ["phase"])
            result = module.goal_bootstrap("second", "Second", ["phase"])
            self.assertEqual(result["status"], "active_goal_exists")

    def test_legacy_goal_completion_requires_current_independent_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            module.goal_bootstrap("critical-goal", "Critical fixture", ["fix"])
            module.goal_checkpoint("fix", "implementation reported complete")
            receipt = Path(temporary) / "evidence.json"
            review_path = Path(temporary) / "review.json"
            (Path(temporary) / "source.py").write_text("value = 1\n", encoding="utf-8")
            revision = snapshot_revision(Path(temporary), ["source.py"])
            validation_path = Path(temporary) / "unit.json"
            run_check("unit", revision, [sys.executable, "-c", "import sys; sys.exit(0)"], validation_path)
            decision = module.route_task("payment posting edit", "implement", "trivial", {
                "task_id": "critical-goal", "source_revision": revision, "snapshot_root": temporary,
                "snapshot_files": ["source.py"], "required_checks": ["unit"],
                "risk_categories": ["payment"]})
            execution = {"revision": revision, "status": "COMPLETED", "source": "desktop_native",
                         "provider_terminal": True, "tool_operations": "completed",
                         "evidence_path": str(receipt)}
            receipt.write_text(json.dumps({"kind": "execution", **execution}), encoding="utf-8")
            check = {"kind": "validation", "name": "unit", "revision": revision, "source": "validation_runner",
                     "status": "PASS", "exit_code": 0, "evidence_path": str(validation_path)}
            review = {"revision": revision, "status": "PASS", "independent": True,
                      "source": "agy_wrapper", "role": decision["review_plan"][0]["role"],
                      "model": decision["review_plan"][0]["model"],
                      "evidence_path": str(review_path)}
            review_path.write_text(json.dumps({"kind": "review", **review}), encoding="utf-8")
            self.assertEqual(decision["model_key"], "luna")
            self.assertEqual(decision["signals"]["risk"], "critical")
            self.assertEqual(decision["review_plan"][0]["role"], "critical_review")
            self.assertEqual(module.goal_finalize("done")["status"], "not_finalizable")
            self.assertEqual(module.assess_task(decision, {"execution": execution, "checks": [check]})["status"], "BLOCKED")
            self.assertEqual(module.goal_finalize("done", decision, {"execution": execution, "checks": [check]})["status"], "not_finalizable")
            stale = {"execution": execution, "checks": [{**check, "revision": "old"}], "review": review}
            self.assertEqual(module.goal_finalize("done", decision, stale)["status"], "not_finalizable")
            valid = {"execution": execution, "checks": [check], "review": review}
            self.assertEqual(module.assess_task(decision, valid)["status"], "READY")
            self.assertEqual(module.goal_finalize("done", decision, valid)["status"], "completed")


if __name__ == "__main__":
    unittest.main()
