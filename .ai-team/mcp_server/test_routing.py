"""Acceptance matrix and failure boundaries. No external model calls."""
import copy
import json
from pathlib import Path
import tempfile
import tomllib
import sys
import subprocess
import unittest

from routing import route, load_config, load_policy, discover_slugs, validate_review, assess_acceptance, snapshot_revision
from route_cli import record_native_execution
from validation_runner import run_check


def available():
    mapping = {
        "gemini_medium": "gemini-3.8-flash-medium", "gemini_high": "gemini-3.8-flash-high",
        "sonnet": "claude-sonnet-4-6", "opus": "claude-opus-4-6-thinking",
    }
    return {"agy_available": True, "agy_models": mapping, "discovered_slugs": list(mapping.values())}


class AcceptanceTests(unittest.TestCase):
    def test_luna_first_model_registry_and_effort(self):
        policy = load_policy()
        self.assertEqual({key for key, value in policy["models"].items() if value["provider"] == "codex"}, {"luna", "sol", "astra"})
        for key in ("luna", "sol", "astra"):
            self.assertTrue(policy["models"][key]["slug"].startswith("gpt-6-"))
        self.assertEqual(policy["limits"]["max_parallel_agents"], 1)
        self.assertEqual(policy["limits"]["max_writers"], 1)
        self.assertFalse(policy["limits"]["automatic_spawn"])
        medium = route({"task_summary": "well specified CRUD", "complexity": "medium"})
        self.assertEqual((medium["model_key"], medium["reasoning_effort"]), ("luna", "high"))
        mechanical = route({"task_summary": "mechanical rename", "code_surface_area": 99, "mechanical_change": True})
        self.assertEqual(mechanical["model_key"], "luna")
        self.assertEqual(route({"task_summary": "difficult integration", "task_type": "cross_module"})["model_key"], "sol")
        very_high = route({"task_summary": "exceptional architecture", "complexity": "very_high"})
        self.assertEqual(very_high["model_key"], "sol")

    def test_astra_requires_reason_and_evidence(self):
        task = {"task_summary": "unresolved architecture", "task_type": "architecture", "astra_reason": "sol_insufficient"}
        with self.assertRaisesRegex(ValueError, "failure_evidence"):
            route(task)
        task["failure_evidence"] = "Sol failed to preserve the invariant in a bounded attempt"
        self.assertEqual(route(task)["model_key"], "astra")
        with self.assertRaises(ValueError):
            route({"task_summary": "simple copy", "astra_reason": "invented_reason"})

    def test_capabilities_are_on_demand(self):
        ambiguous = route({"task_summary": "build a new feature", "ambiguous_requirements": True})
        self.assertEqual(ambiguous["status"], "NEEDS_ACCEPTANCE_CRITERIA")
        self.assertIn("product", ambiguous["signals"]["required_capabilities"])
        backend = route({"task_summary": "update backend endpoint", "task_type": "implement"})
        self.assertNotIn("ux_ui", backend["signals"]["required_capabilities"])
        database = route({"task_summary": "migration", "risk_categories": ["migration"]})
        self.assertIn("database", database["signals"]["required_capabilities"])

    def test_risk_uses_affected_work_not_document_words(self):
        docs = route({"task_summary": "document the payment retry rule", "task_type": "docs"})
        self.assertEqual(docs["signals"]["risk"], "low")
        docs_path = route({"task_summary": "document payment", "task_type": "docs", "changed_files": ["docs/payment.md"]})
        self.assertEqual(docs_path["signals"]["risk"], "low")
        executable_path = route({"task_summary": "document payment", "task_type": "docs", "changed_files": ["src/payment.ts"]})
        self.assertEqual(executable_path["signals"]["risk"], "critical")
        for category in ("tenant_isolation", "subscription_entitlement", "payment", "auth"):
            with self.subTest(category=category):
                result = route({"task_summary": "one-line fix", "difficulty": "trivial", "risk_categories": [category]})
                self.assertEqual(result["signals"]["risk"], "critical")
                self.assertEqual(result["model_key"], "luna")
                self.assertEqual(result["review_plan"][0]["role"], "critical_review")

    def test_evidence_gate_never_uses_model_claim_as_test_pass(self):
        with tempfile.TemporaryDirectory() as d:
            source_path = Path(d) / "source.py"
            source_path.write_text("value = 1\n", encoding="utf-8")
            revision = snapshot_revision(Path(d), ["source.py"])
            execution_path = Path(d) / "execution.json"
            review_path = Path(d) / "review.json"
            validation_path = Path(d) / "unit.json"
            run_check("unit", revision, [sys.executable, "-c", "import sys; sys.exit(0)"], validation_path)
            decision = route({"task_summary": "payment posting fix", "risk_categories": ["payment"],
                              "source_revision": revision, "snapshot_root": d, "snapshot_files": ["source.py"],
                              "required_checks": ["unit"]})
            check = {"kind": "validation", "name": "unit", "revision": revision, "source": "validation_runner",
                     "status": "PASS", "exit_code": 0, "evidence_path": str(validation_path)}
            review = {"revision": revision, "status": "PASS", "independent": True,
                      "source": "agy_wrapper", "role": decision["review_plan"][0]["role"],
                      "model": decision["review_plan"][0]["model"],
                      "evidence_path": str(review_path)}
            execution = {"revision": revision, "status": "COMPLETED", "source": "desktop_native",
                         "provider_terminal": True, "tool_operations": "completed", "evidence_path": str(execution_path)}
            execution_path.write_text(json.dumps({"kind": "execution", **execution}), encoding="utf-8")
            review_path.write_text(json.dumps({"kind": "review", **review}), encoding="utf-8")
            valid = {"execution": execution, "checks": [check], "review": review}
            self.assertEqual(assess_acceptance(decision, valid)["status"], "READY")
            self.assertEqual(assess_acceptance(decision, {**valid, "execution": {**execution, "provider_terminal": False}})["status"], "BLOCKED")
            self.assertEqual(assess_acceptance(decision, {**valid, "checks": [{**check, "source": "model_claim"}]} )["status"], "BLOCKED")
            self.assertEqual(assess_acceptance(decision, {**valid, "checks": [{**check, "revision": "old"}]} )["status"], "BLOCKED")
            self.assertEqual(assess_acceptance(decision, {**valid, "review": {**review, "independent": False}})["status"], "BLOCKED")
            self.assertEqual(assess_acceptance(decision, {**valid, "review": {**review, "model": "gpt-6-luna"}})["status"], "BLOCKED")
            finding = {"severity": "MAJOR", "disposition": "unresolved"}
            self.assertEqual(assess_acceptance(decision, {**valid, "findings": [finding]})["status"], "BLOCKED")
            fake_path = Path(d) / "fake.json"
            fake_path.write_text("{}", encoding="utf-8")
            self.assertEqual(assess_acceptance(decision, {**valid, "checks": [{**check, "evidence_path": str(fake_path)}]})["status"], "BLOCKED")
            source_path.write_text("value = 2\n", encoding="utf-8")
            self.assertIn("snapshot_changed", assess_acceptance(decision, valid)["blockers"])

    def test_validation_runner_propagates_failed_exit_and_never_marks_pass(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "failure.json"
            receipt = run_check("unit", "rev", [sys.executable, "-c", "import sys; sys.exit(7)"], path)
            self.assertEqual((receipt["status"], receipt["exit_code"]), ("FAIL", 7))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["exit_code"], 7)
            timed = run_check("slow", "rev", [sys.executable, "-c", "import time; time.sleep(3)"],
                              Path(d) / "timeout.json", timeout=1)
            self.assertEqual((timed["status"], timed["exit_code"]), ("BLOCKED", None))

    def test_snapshot_rejects_sensitive_or_outside_paths(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".env.test").write_text("synthetic", encoding="utf-8")
            for path in (".env.test", "../outside.py", "private.pem"):
                with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                    snapshot_revision(root, [path])

    def test_route_cli_validation_and_acceptance_fixture(self):
        """Offline adapter path with a real failing then passing test command."""
        project_root = Path(__file__).resolve().parents[2]
        fixture_parent = project_root / ".ai-team" / "tmp"
        fixture_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=fixture_parent) as d:
            root = Path(d)
            self.assertTrue(root.resolve().is_relative_to(project_root.resolve()))
            source = root / "calc.py"
            source.write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
            (root / "test_calc.py").write_text(
                "import unittest\nfrom calc import add\n"
                "class CalcTest(unittest.TestCase):\n"
                "    def test_add(self): self.assertEqual(add(2, 3), 5)\n", encoding="utf-8")
            test_command = [sys.executable, "-m", "unittest", "discover", "-q"]
            self.assertNotEqual(subprocess.run(test_command, cwd=root, capture_output=True).returncode, 0)
            # The fake developer step is intentionally explicit; live native execution
            # is verified separately and never represented by this fixture.
            source.write_text("def add(a, b):\n    return a + b  # corrected\n", encoding="utf-8")
            snapshot_files = [str(source.relative_to(project_root)),
                              str((root / "test_calc.py").relative_to(project_root))]
            cli = Path(__file__).with_name("route_cli.py")
            snapshotted = subprocess.run([sys.executable, str(cli)],
                input=json.dumps({"action": "snapshot", "files": snapshot_files}),
                text=True, capture_output=True, check=True)
            revision = json.loads(snapshotted.stdout)["revision"]
            self.assertEqual(revision, snapshot_revision(project_root, snapshot_files))
            request = {"task": {"task_summary": "fix bounded add implementation", "task_type": "implement",
                                "source_revision": revision, "snapshot_root": str(project_root),
                                "snapshot_files": snapshot_files, "required_checks": ["unit"]},
                       "config_path": str(Path(__file__).resolve().parents[1] / "config/router.json")}
            routed = subprocess.run([sys.executable, str(cli)], input=json.dumps(request),
                                    text=True, capture_output=True, check=True)
            decision = json.loads(routed.stdout)
            receipt_path = root / "unit.json"
            runner = Path(__file__).with_name("validation_runner.py")
            checked = subprocess.run([sys.executable, str(runner), "--name", "unit",
                                      "--revision", revision, "--output", str(receipt_path),
                                      "--", *test_command], cwd=root, capture_output=True, text=True)
            self.assertEqual(checked.returncode, 0, (checked.stdout, checked.stderr))
            execution_path = root / "execution.json"
            execution = {"revision": revision, "status": "COMPLETED", "source": "desktop_native",
                         "provider_terminal": True, "tool_operations": "completed",
                         "evidence_path": str(execution_path)}
            execution_path.write_text(json.dumps({"kind": "execution", **execution}), encoding="utf-8")
            check = {"kind": "validation", "name": "unit", "revision": revision,
                     "source": "validation_runner", "status": "PASS", "exit_code": 0,
                     "evidence_path": str(receipt_path)}
            accepted = subprocess.run([sys.executable, str(cli)],
                input=json.dumps({"action": "assess_acceptance", "decision": decision,
                                  "evidence": {"execution": execution, "checks": [check]}}),
                text=True, capture_output=True, check=True)
            self.assertEqual(json.loads(accepted.stdout)["status"], "READY")

    def test_native_receipt_checks_terminal_and_protected_test(self):
        project_root = Path(__file__).resolve().parents[2]
        parent = project_root / ".ai-team" / "tmp"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as d:
            fixture = Path(d)
            source = fixture / "calc.py"
            test = fixture / "test_calc.py"
            source.write_text("return a - b\n", encoding="utf-8")
            test.write_text("assert add(2, 3) == 5\n", encoding="utf-8")
            files = [str(p.relative_to(project_root)) for p in (source, test)]
            decision = route({"task_id": "native-receipt-test", "task_summary": "fix a bounded add bug",
                              "task_type": "implement", "source_revision": snapshot_revision(project_root, files),
                              "snapshot_root": str(project_root), "snapshot_files": files,
                              "required_checks": ["unit"]}, team="ai-team-lite")
            protected_revision = snapshot_revision(project_root, [files[1]])
            events = fixture / "events.jsonl"
            events.write_text('{"type":"item.completed","item":{"type":"error","message":"Skill descriptions were shortened to fit the skills context budget. Fixture warning."}}\n'
                              '{"type":"turn.completed"}\n', encoding="utf-8")
            source.write_text("return a + b\n", encoding="utf-8")
            request = {"decision": decision, "task_id": "native-receipt-test", "run_id": "run-1",
                       "events_path": str(events), "output_path": str(fixture / "execution.json"),
                       "exit_code": 0, "protected_files": [files[1]],
                       "protected_revision": protected_revision}
            receipt = record_native_execution(request)
            self.assertEqual(receipt["status"], "COMPLETED")
            self.assertEqual(receipt["metadata_warnings"], 1)
            self.assertEqual(receipt["observed"]["model"], "unknown")
            self.assertEqual(json.loads((fixture / "execution.json").read_text())["revision"], receipt["revision"])
            events.write_text('{"type":"turn.failed"}\n', encoding="utf-8")
            self.assertEqual(record_native_execution({**request, "output_path": str(fixture / "failed.json")})["status"], "BLOCKED")
            events.write_text('{"type":"item.completed","item":{"type":"error","message":"Permission denied"}}\n'
                              '{"type":"turn.completed"}\n', encoding="utf-8")
            self.assertEqual(record_native_execution({**request, "output_path": str(fixture / "denied.json")})["status"], "BLOCKED")
            events.write_text('{"type":"turn.completed"}\n', encoding="utf-8")
            self.assertEqual(record_native_execution({**request, "exit_code": False,
                                                      "output_path": str(fixture / "false-exit.json")})["status"], "BLOCKED")
            test.write_text("assert False\n", encoding="utf-8")
            self.assertEqual(record_native_execution({**request, "output_path": str(fixture / "changed-test.json")})["status"], "BLOCKED")

    def test_native_adapter_is_explicit_and_keeps_observation_unknown(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / ".ai-team/scripts/Invoke-AiTeamTask.ps1").read_text(encoding="utf-8")
        self.assertIn("[switch]$ExecuteNative", source)
        self.assertIn("NATIVE_MODEL_UNVERIFIED", source)
        self.assertIn("'exec', '--ephemeral', '--json', '-m', $decision.model", source)
        self.assertIn("model_reasoning_effort", source)
        self.assertIn("-StandardInputText $Prompt", source)
        self.assertIn("-MarkAsChild", source)
        self.assertIn("EXECUTED_NEEDS_VALIDATION", source)
        self.assertIn("model='unknown'; effort='unknown'", source)
        decision = route({"task_summary": "bounded work"})
        self.assertEqual(decision["observed"]["model"], "unknown")
        self.assertEqual(decision["execution"], "recommendation_only")
        self.assertTrue(decision["execution_requirement"]["explicit_model"])
        self.assertTrue(decision["execution_requirement"]["explicit_effort"])
        difficult = route({"task_summary": "difficult integration", "task_type": "cross_module"})
        self.assertEqual(difficult["target"], "worker-deep")
        self.assertEqual(difficult["model_key"], "sol")

    def test_native_agent_descriptors_are_valid_and_active_models_are_gpt6(self):
        root = Path(__file__).resolve().parents[2]
        for descriptor in (root / ".codex/agents").glob("*.toml"):
            with self.subTest(descriptor=descriptor.name):
                value = tomllib.loads(descriptor.read_text(encoding="utf-8"))
                self.assertIn(value["model"], {"gpt-6-luna", "gpt-6-sol", "gpt-6-astra"})
        tomllib.loads((root / ".codex/config.toml").read_text(encoding="utf-8"))

    def test_unknown_quota_does_not_mean_zero_or_unlimited(self):
        base = route({"task_summary": "ordinary large diff review"}, available())
        unknown = route({"task_summary": "ordinary large diff review"}, {**available(), "quota": {"gemini": None}})
        zero = route({"task_summary": "ordinary large diff review"}, {**available(), "quota": {"gemini": 0}})
        self.assertEqual(base["model_key"], unknown["model_key"])
        self.assertNotEqual(base["model_key"], zero["model_key"])

    def test_twelve_cases(self):
        cases = [
            ("01-copy", {"task_summary": "修改文案"}, "auto", available(), "ai-team-lite", "luna"),
            ("02-crud", {"task_summary": "一般 CRUD"}, "auto", available(), "ai-team-lite", "luna"),
            ("03-cross-module", {"task_summary": "跨模組 Feature"}, "auto", available(), "ai-team", "sol"),
            ("04-architecture", {"task_summary": "大型 architecture"}, "auto", available(), "ai-team", "sol"),
            ("05-large-diff", {"task_summary": "ordinary large diff review"}, "auto", available(), "ai-team", "gemini_high"),
            ("06-business-review", {"task_summary": "business logic review"}, "auto", available(), "ai-team", "sonnet"),
            ("07-critical", {"task_summary": "Payment Auth Security review"}, "auto", available(), "ai-team-pro", "opus"),
            ("08-claude-zero", {"task_summary": "business logic review"}, "auto", {**available(), "quota": {"claude": 0}}, "ai-team", "sol"),
            ("09-gemini-zero", {"task_summary": "ordinary large diff review"}, "auto", {**available(), "quota": {"gemini": 0}}, "ai-team", "sol"),
            ("10-no-agy", {"task_summary": "Payment review"}, "auto", {"agy_available": False}, "ai-team-pro", "astra"),
            ("11-pro-copy", {"task_summary": "修改文案"}, "ai-team-pro", available(), "ai-team-pro", "luna"),
            ("12-one-line", {"task_summary": "one line payment webhook", "complexity": "low"}, "auto", available(), "ai-team-pro", "luna"),
        ]
        for name, task, team, runtime, expected_team, expected_model in cases:
            with self.subTest(case=name):
                result = route(task, runtime, team)
                self.assertEqual(result["status"], "planned")
                self.assertEqual(result["team"], expected_team)
                self.assertEqual(result["model_key"], expected_model)
                self.assertEqual(result["spawn_count"], 0)
                if name == "12-one-line":
                    self.assertEqual(result["review_plan"][0]["model_key"], "opus")

    def test_all_critical_domains_override_trivial(self):
        for category in ("payment", "billing", "auth", "permission", "security", "production_data", "migration", "revenue_sharing"):
            with self.subTest(category=category):
                result = route({"task_summary": "small edit", "complexity": "low", "risk_categories": [category]}, available(), "ai-team-lite")
                self.assertEqual(result["signals"]["risk"], "critical")
                self.assertEqual(result["model_key"], "luna")
                self.assertTrue(result["escalated"])
                self.assertEqual(result["review_plan"][0]["model_key"], "opus")

    def test_inputs_raise_capability(self):
        for field in ("context_size", "expected_duration", "code_surface_area"):
            task = {"task_summary": "small copy edit", "complexity": "low", field: load_policy()["size_thresholds"][field][1]}
            self.assertEqual(route(task)["model_key"], "luna")
        for field in ("production_impact", "security_impact", "data_integrity_impact"):
            self.assertEqual(route({"task_summary": "small copy edit", field: "critical"})["signals"]["risk"], "critical")

    def test_task_type_floor_cannot_be_downgraded(self):
        for kind in ("cross_module", "complex_debug", "deep_review", "business_review"):
            with self.subTest(kind=kind):
                result = route({"task_summary": "bounded task", "task_type": kind, "complexity": "low"}, available())
                self.assertEqual(result["signals"]["task_type_floor"], "high")
                self.assertEqual(result["signals"]["complexity"], "high")
                if kind in {"cross_module", "complex_debug"}:
                    self.assertEqual(result["model_key"], "sol")
                else:
                    self.assertEqual(result["model_key"], "sonnet")
        ordinary = route({"task_summary": "small bounded change", "task_type": "implement", "complexity": "low"})
        self.assertEqual((ordinary["signals"]["complexity"], ordinary["model_key"]), ("low", "luna"))

    def test_auth_permission_and_security_text_fallbacks(self):
        positives = (
            "one line OAuth callback fix", "JWT validation fix", "MFA recovery fix", "SSO callback fix",
            "session validation fix", "login security fix", "token validation fix",
            "one line authorization middleware fix", "access control fix", "role based access fix",
            "credential encryption fix", "CSRF middleware fix", "XSS filter fix", "SQL injection fix",
            "command injection fix", "code injection fix", "prompt injection fix",
        )
        for summary in positives:
            with self.subTest(summary=summary):
                result = route({"task_summary": summary, "complexity": "low"}, available())
                self.assertEqual(result["signals"]["risk"], "critical")
                self.assertEqual(result["model_key"], "luna")
                self.assertEqual(result["review_plan"][0]["model_key"], "opus")
        for summary in (
            "session documentation", "token budget notes", "secretary profile copy", "role description",
            "dependency injection", "dependency injection refactor", "DI container",
        ):
            with self.subTest(summary=summary):
                self.assertEqual(route({"task_summary": summary, "complexity": "low"})["signals"]["risk"], "low")
        structured = route({"task_summary": "dependency injection refactor", "complexity": "low", "risk_categories": ["security"]}, available())
        self.assertEqual(structured["signals"]["risk"], "critical")

    def test_difficulty_is_strict_and_legacy_mapping_is_explicit(self):
        expected = {"auto": "medium", "trivial": "low", "routine": "medium", "complex": "high", "critical": "very_high"}
        for difficulty, complexity in expected.items():
            with self.subTest(difficulty=difficulty):
                result = route({"task_summary": "bounded implementation", "task_type": "implement", "difficulty": difficulty})
                self.assertEqual(result["signals"]["complexity"], complexity)
        for invalid in ("high", "nonsense", "typo", "unsupported"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                route({"task_summary": "bounded implementation", "difficulty": invalid})

    def test_score_is_signal_and_categories_are_deduplicated(self):
        result = route({"task_summary": "webhook concurrency", "risk_categories": ["webhook"]})
        self.assertEqual(result["signals"]["risk_score"], 4)
        self.assertEqual(result["signals"]["risk"], "high")
        self.assertEqual(len(result["review_plan"]), 1)
        self.assertEqual(route({"task_summary": "payment payment"})["signals"]["risk_score"], 3)

    def test_review_routing_not_a_fixed_ladder(self):
        low = route({"task_summary": "simple review", "complexity": "low"}, available())
        self.assertEqual(low["model_key"], "luna")
        self.assertFalse(low["review_plan"])
        medium = route({"task_summary": "ordinary review", "risk": "medium"}, available())
        self.assertEqual(medium["model_key"], "gemini_high")
        self.assertTrue(medium["candidate_findings_only"])
        high = route({"task_summary": "ordinary review", "risk": "high"}, available())
        self.assertEqual(high["model_key"], "sonnet")
        self.assertEqual([s["model_key"] for s in high["review_plan"]], [])
        important = route({"task_summary": "ordinary review", "important_findings": True}, available())
        self.assertEqual(important["model_key"], "sonnet")

    def test_general_review_consumes_effective_complexity_and_availability(self):
        expected = {
            "low": ("self_review", "luna"),
            "medium": ("self_review", "luna"),
            "high": ("senior_review", "sonnet"),
            "very_high": ("senior_review", "sonnet"),
        }
        for complexity, selection in expected.items():
            with self.subTest(complexity=complexity):
                result = route(
                    {"task_summary": "bounded review", "task_type": "review", "complexity": complexity},
                    available(),
                )
                self.assertEqual((result["role"], result["model_key"]), selection)
        no_claude = {**available(), "quota": {"claude": 0}}
        for complexity in ("high", "very_high"):
            with self.subTest(complexity=complexity, availability="no_claude"):
                result = route(
                    {"task_summary": "bounded review", "task_type": "review", "complexity": complexity},
                    no_claude,
                )
                self.assertEqual((result["role"], result["model_key"]), ("senior_review", "sol"))

    def test_roles(self):
        for kind, model in [("manager","luna"),("explore","luna"),("plan","luna"),("release","luna"),("architecture","sol"),("root_cause","sol")]:
            self.assertEqual(route({"task_summary": "bounded task", "task_type": kind})["model_key"], model)
        self.assertEqual(route({"task_summary":"dispute", "task_type":"arbiter"})["status"], "ASTRA_REASON_REQUIRED")
        self.assertEqual(route({"task_summary":"dispute", "task_type":"arbiter", "astra_reason":"major_reviewer_conflict"})["model_key"], "astra")

    def test_native_fallback_is_capability_preserving(self):
        result = route({"task_summary": "ordinary CRUD"}, {"models": {"luna": {"quota_remaining": 0}}})
        self.assertEqual(result["selected_model"], "luna")
        self.assertEqual(result["model_key"], "sol")
        self.assertEqual(result["fallback_events"][0]["reason"], "quota_exhausted")
        self.assertEqual(route({"task_summary": "architecture"}, {"models": {"sol": {"available": False}}})["status"], "NO_CAPABLE_MODEL")

    def test_model_minimum_team_is_separate_from_task_tier(self):
        lite_fallback = route(
            {"task_summary": "copy edit", "task_type": "copy", "complexity": "low"},
            {"models": {"luna": {"available": False}}},
            "ai-team-lite",
        )
        self.assertEqual((lite_fallback["model_key"], lite_fallback["team"]), ("sol", "ai-team"))
        self.assertTrue(lite_fallback["escalated"])
        blocked = route({"task_summary":"copy edit", "hard_team_cap":True}, {"models":{"luna":{"available":False}}}, "ai-team-lite")
        self.assertEqual(blocked["status"], "TEAM_CAP_BLOCKED")

        requires_sol = route(
            {"task_summary": "cross module feature", "task_type": "cross_module"}, available(), "ai-team-lite",
        )
        self.assertEqual((requires_sol["model_key"], requires_sol["team"]), ("sol", "ai-team"))
        self.assertTrue(requires_sol["escalated"])

        critical = route(
            {"task_summary": "one line payment fix", "complexity": "low"}, available(), "ai-team-lite",
        )
        self.assertEqual(critical["team"], "ai-team-pro")
        self.assertTrue(critical["escalated"])

    def test_ci_native_commands_use_distinct_fail_fast_steps(self):
        workflow = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"
        lines = workflow.read_text(encoding="utf-8").splitlines()
        steps = []
        current = []
        for line in lines:
            if line.startswith("      - name:"):
                if current:
                    steps.append("\n".join(current))
                current = [line]
            elif current:
                current.append(line)
        if current:
            steps.append("\n".join(current))

        commands = (
            "python -m unittest discover -s .ai-team/mcp_server",
            "Test-AiTeamResilience.ps1",
            "Test-AiTeamHandoff.ps1",
            "Test-AiTeamBootstrap.ps1",
            "Test-AiTeamNodeValidation.ps1",
        )
        command_steps = []
        for command in commands:
            matches = [index for index, step in enumerate(steps) if command in step]
            self.assertEqual(len(matches), 1, f"missing or duplicated CI command: {command}")
            command_steps.append(matches[0])
            self.assertNotIn("continue-on-error: true", steps[matches[0]])
        self.assertEqual(len(command_steps), len(set(command_steps)), "native commands share a step and can mask an earlier exit code")

    def test_sonnet_and_opus_fallback_effort(self):
        no_claude = {**available(), "quota": {"claude": 0}}
        self.assertEqual(route({"task_summary": "deep review"}, no_claude)["reasoning_effort"], "high")
        critical = route({"task_summary": "payment review"}, no_claude)
        self.assertEqual((critical["model_key"],critical["reasoning_effort"]), ("astra","high"))
        no_claude["models"] = {"astra": {"available": False}}
        self.assertEqual(route({"task_summary": "payment review"}, no_claude)["model_key"], "sol")
        no_claude["models"]["sol"] = {"available": False}
        self.assertEqual(route({"task_summary": "payment review"}, no_claude)["status"], "NO_CAPABLE_MODEL")
        self.assertEqual(route({"task_summary": "payment edit"}, no_claude)["status"], "REVIEW_BLOCKED")

    def test_all_agy_unavailable_still_supports_all_work(self):
        for runtime in ({"agy_available": False}, {**available(), "quota": {"gemini":0,"claude":0}}):
            for kind in ("plan","implement","review","qa","release","security_review","architecture"):
                with self.subTest(kind=kind):
                    result=route({"task_summary":"bounded task","task_type":kind}, runtime)
                    self.assertEqual(result["status"], "planned")
                    self.assertEqual(result["provider"], "native_agent")
            qa = route({"task_summary":"bounded task","task_type":"qa"}, runtime)
            self.assertEqual(qa["model_key"],"luna")

    def test_attempts_recursion_and_budget(self):
        self.assertEqual(route({"task_summary":"copy edit","parent_depth":1})["status"], "BLOCKED_RECURSION")
        self.assertEqual(route({"task_summary":"copy edit"},{"child_process":True})["status"], "BLOCKED_RECURSION")
        self.assertEqual(route({"task_summary":"copy edit","dispatch_count":4})["status"], "BUDGET_EXHAUSTED")
        result=route({"task_summary":"copy edit"},{"attempted_models":["luna","sol","astra"]})
        self.assertEqual(result["status"], "NO_CAPABLE_MODEL")
        for table in load_policy()["MODEL_FALLBACK"].values():
            for first, chain in table.items():
                self.assertNotIn(first,chain)
                self.assertEqual(len(chain),len(set(chain)))
                if first == "sonnet": self.assertNotIn("opus",chain)

    def test_actual_model_inventory_required(self):
        runtime=available()
        runtime["discovered_slugs"]=[]
        self.assertEqual(route({"task_summary":"large diff review"},runtime)["model_key"],"sol")
        models=discover_slugs("gemini-3.8-flash-medium\ngemini-3.8-flash-high\nclaude-sonnet-4-6\nclaude-opus-4-6-thinking")
        self.assertEqual(models["sonnet"],"claude-sonnet-4-6")
        self.assertEqual(len(models),4)
        self.assertEqual(discover_slugs("Please sign in"),{})
        self.assertNotIn("sonnet",discover_slugs("claude-sonnet-4.6-thinking"))

    def test_validation_does_not_accept_bad_inputs(self):
        for signals in ({"risk":"typo"},{"complexity":"invalid"},{"difficulty":"nonsense"},{"context_size":-1},{"risk_categories":["unknown"]},{"dispatch_count":-1}):
            with self.assertRaises(ValueError): route({"task_summary":"safe",**signals})
        with self.assertRaises(ValueError): route({"task_summary":"token: synthetic"})
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"router.json"
            p.write_text(json.dumps({"version":"6.0","active_mode_id":"ai-team","models":{}}))
            with self.assertRaises(ValueError): load_config(p)

    def test_review_contract(self):
        finding={"severity":"MAJOR","file":"app.py","area":"12","issue":"race","evidence":"reproduction","impact":"lost update","recommended_fix":"lock","required_test":"parallel writers","confidence":0.9}
        payload={"summary":"One defect", "findings":[finding]}
        self.assertEqual(validate_review(payload),payload)
        for invalid in ({"summary":"ok","findings":["looks fine"]},{"summary":"","findings":[]},{"summary":"PASS"}):
            with self.assertRaises(ValueError): validate_review(invalid)
        for field in finding:
            bad=copy.deepcopy(payload)
            del bad["findings"][0][field]
            with self.assertRaises(ValueError): validate_review(bad)

    def test_team_templates(self):
        for file in Path(__file__).resolve().parents[1].joinpath("config").glob("router*.json"):
            cfg=load_config(file)
            result=route({"task_summary":"copy edit"},team=cfg["active_mode_id"])
            self.assertEqual(result["model_key"],"luna")

    def test_legacy_wrapper_empty_team_defaults_to_auto(self):
        result = route({"task_summary": "copy edit"}, available(), "")
        self.assertEqual(result["requested_team"], "auto")
        self.assertEqual(result["model_key"], "luna")

    def test_escalation_reasons_are_structured(self):
        cross = route({"task_summary":"cross module feature","task_type":"cross_module","complexity":"low"}, available(), "ai-team-lite")
        self.assertTrue({"task_type_floor", "risk", "model_capability"}.issubset(cross["escalation_reasons"]))
        fallback = route({"task_summary":"ordinary CRUD"}, {"models":{"luna":{"available":False}}}, "ai-team-lite")
        self.assertIn("fallback", fallback["escalation_reasons"])
        critical = route({"task_summary":"payment change","complexity":"low"}, available(), "ai-team-lite")
        self.assertIn("required_review", critical["escalation_reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
