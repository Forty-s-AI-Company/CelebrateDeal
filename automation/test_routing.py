import json
import tempfile
import unittest
from pathlib import Path

from routing import assert_acyclic, build_role_dag, enabled_roles, normalize_domain


ROOT = Path(__file__).resolve().parents[1]


def config():
    return json.loads((ROOT / "automation" / "team-config.yaml").read_text(encoding="utf-8"))


class DynamicRoleRoutingTest(unittest.TestCase):
    def roles(self, task_type: str) -> list[str]:
        dag = build_role_dag(config(), {"id": "ROUTE-1", "type": task_type})
        assert_acyclic(dag)
        return [stage.role_id for stage in dag.stages]

    def test_frontend_route_adds_ux_accessibility_and_visual_qa(self) -> None:
        roles = self.roles("ui")
        self.assertIn("frontend-engineer", roles)
        self.assertIn("ui-ux-auditor", roles)
        self.assertIn("accessibility-auditor", roles)
        self.assertIn("visual-regression-reviewer", roles)
        self.assertLess(roles.index("frontend-engineer"), roles.index("ui-ux-auditor"))

    def test_backend_route_adds_architecture_review_and_browser_qa(self) -> None:
        roles = self.roles("api")
        self.assertEqual(roles[:3], ["product-architect", "system-architect", "backend-engineer"])
        self.assertIn("code-reviewer", roles)
        self.assertIn("browser-qa-engineer", roles)

    def test_database_security_route_adds_tenant_isolation_auditor(self) -> None:
        roles = self.roles("rls")
        self.assertIn("database-security-engineer", roles)
        self.assertIn("security-reviewer", roles)
        self.assertIn("tenant-isolation-auditor", roles)

    def test_attribution_route_adds_attribution_qa(self) -> None:
        roles = self.roles("attribution")
        self.assertIn("attribution-engineer", roles)
        self.assertIn("attribution-qa-engineer", roles)
        self.assertNotIn("commission-qa-engineer", roles)

    def test_commission_route_adds_database_security_and_commission_qa(self) -> None:
        roles = self.roles("refund")
        self.assertIn("commission-engineer", roles)
        self.assertIn("database-security-engineer", roles)
        self.assertIn("commission-qa-engineer", roles)

    def test_combined_finance_route_includes_both_specialist_qa_roles(self) -> None:
        roles = self.roles("attribution-commission")
        self.assertIn("attribution-qa-engineer", roles)
        self.assertIn("commission-qa-engineer", roles)

    def test_unknown_trusted_type_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            normalize_domain(config(), "new-domain")

    def test_manifest_path_cannot_escape_roles_directory(self) -> None:
        registry = {
            "schemaVersion": 2,
            "roles": [
                {
                    "role_id": "escaped-role",
                    "provider": "codex",
                    "enabled": True,
                    "manifest": "AGENTS.md",
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "trusted roles directory"):
                enabled_roles(registry_path)

    def test_unknown_provider_fails_closed_before_manifest_execution(self) -> None:
        registry = {
            "schemaVersion": 2,
            "roles": [{"role_id": "evil", "provider": "shell", "enabled": True, "manifest": "automation/roles/backend-engineer.yaml"}],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unknown role provider"):
                enabled_roles(registry_path)

    def test_unknown_or_disabled_chain_role_fails_closed(self) -> None:
        value = config()
        value["role_chains"]["backend"].append("disabled-role")
        value["role_order"].append("disabled-role")
        with self.assertRaisesRegex(ValueError, "disabled or unknown"):
            build_role_dag(value, {"id": "API-2", "type": "backend"})

    def test_multi_domain_task_merges_specialist_reviewers(self) -> None:
        dag = build_role_dag(config(), {"id": "COMPOSITE-1", "types": ["ui", "commission"]})
        roles = [stage.role_id for stage in dag.stages]
        self.assertIn("ui-ux-auditor", roles)
        self.assertIn("commission-qa-engineer", roles)
        self.assertIn("security-reviewer", roles)

    def test_untrusted_qa_cannot_create_executable_dag(self) -> None:
        with self.assertRaises(ValueError):
            build_role_dag(config(), {"id": "BOUNDARY-1", "type": "frontend", "untrusted": True})

    def test_required_specialist_omission_fails_closed(self) -> None:
        value = config()
        value["role_chains"]["frontend"].remove("visual-regression-reviewer")
        with self.assertRaises(ValueError):
            build_role_dag(value, {"id": "UI-1", "type": "frontend"})

    def test_every_stage_has_linear_dependency_and_provider(self) -> None:
        dag = build_role_dag(config(), {"id": "FIN-1", "type": "commission"})
        assert_acyclic(dag)
        for index, stage in enumerate(dag.stages):
            self.assertIn(stage.provider, {"codex", "antigravity"})
            self.assertEqual(stage.depends_on, () if index == 0 else (dag.stages[index - 1].stage_id,))


if __name__ == "__main__":
    unittest.main()
