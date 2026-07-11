from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUTOMATION = ROOT / "automation"

CODEX_ROLES = {
    "ai-team-orchestrator": ("AI Team Orchestrator", "Orchestrate dependency-aware delivery and release gates.", "gpt-5.6-sol", "high", ["planning", "orchestration"]),
    "product-architect": ("Product Architect", "Define actors, workflows, state and acceptance criteria.", "gpt-5.6-sol", "high", ["product", "specification"]),
    "system-architect": ("System Architect", "Define service boundaries, contracts and failure modes.", "gpt-5.6-sol", "high", ["architecture", "integration"]),
    "ux-design-lead": ("UX Design Lead", "Audit information architecture and design-system behavior.", "gpt-5.6-sol", "high", ["ux", "design-review"]),
    "frontend-engineer": ("Frontend Engineer", "Implement accessible responsive product workflows.", "gpt-5.6-terra", "medium", ["frontend", "ui"]),
    "backend-engineer": ("Backend Engineer", "Implement validated tenant-scoped APIs and services.", "gpt-5.6-terra", "medium", ["backend", "api"]),
    "database-security-engineer": ("Database Security Engineer", "Own schema integrity, tenancy, RBAC and migrations.", "gpt-5.6-sol", "high", ["database", "security"]),
    "attribution-engineer": ("Attribution Engineer", "Own referral capture, touch rules and conversion attribution.", "gpt-5.6-sol", "high", ["attribution", "analytics"]),
    "commission-engineer": ("Commission Engineer", "Own commission ledger, refund reversal and payout eligibility.", "gpt-5.6-sol", "high", ["commission", "finance"]),
    "test-engineer": ("Test Engineer", "Build deterministic unit, integration, API and browser coverage.", "gpt-5.6-terra", "medium", ["test", "regression"]),
    "repair-engineer": ("Repair Engineer", "Repair validated issues without broad refactors.", "gpt-5.6-terra", "medium", ["repair", "bugfix"]),
    "code-reviewer": ("Code Reviewer", "Review correctness, performance and maintainability read-only.", "gpt-5.6-sol", "high", ["review", "quality"]),
    "security-reviewer": ("Security Reviewer", "Review auth, tenancy, payments, secrets and unsafe data flow.", "gpt-5.6-sol", "high", ["security-review"]),
    "release-manager": ("Release Manager", "Evaluate deterministic evidence and external release requirements.", "gpt-5.6-sol", "high", ["release", "gate"]),
}

ANTIGRAVITY_ROLES = {
    "browser-qa-engineer": ("Browser QA Engineer", "Run broad browser workflow QA.", "Gemini 3.5 Flash (High)", ["browser", "smoke"]),
    "product-flow-auditor": ("Product Flow Auditor", "Audit end-to-end actor goals and failure states.", "Gemini 3.1 Pro (High)", ["product-flow"]),
    "ui-ux-auditor": ("UI UX Auditor", "Audit hierarchy, states and design consistency.", "Gemini 3.1 Pro (High)", ["ux", "visual"]),
    "mobile-qa-engineer": ("Mobile QA Engineer", "Verify mobile-first flows and responsive behavior.", "Gemini 3.5 Flash (High)", ["mobile", "responsive"]),
    "accessibility-auditor": ("Accessibility Auditor", "Verify keyboard, semantics, contrast and axe findings.", "Gemini 3.5 Flash (High)", ["accessibility"]),
    "tenant-isolation-auditor": ("Tenant Isolation Auditor", "Run cross-tenant negative authorization scenarios.", "Gemini 3.1 Pro (High)", ["tenant", "security"]),
    "attribution-qa-engineer": ("Attribution QA Engineer", "Verify referral and touch attribution semantics.", "Gemini 3.1 Pro (High)", ["attribution"]),
    "commission-qa-engineer": ("Commission QA Engineer", "Verify commission, refund and idempotency behavior.", "Gemini 3.1 Pro (High)", ["commission", "finance"]),
    "visual-regression-reviewer": ("Visual Regression Reviewer", "Compare visual baselines and evidence.", "Gemini 3.5 Flash (High)", ["visual-regression"]),
    "regression-verifier": ("Regression Verifier", "Reproduce fixes and confirm no regressions.", "Gemini 3.5 Flash (High)", ["regression", "verification"]),
}

SKILLS = {
    "product": ".agents/skills/celebratedeal-product-domain/SKILL.md",
    "security": ".agents/skills/celebratedeal-multi-tenant-security/SKILL.md",
    "finance": ".agents/skills/celebratedeal-attribution-commission/SKILL.md",
    "browser": ".agents/skills/celebratedeal-browser-qa/SKILL.md",
    "design": ".agents/skills/celebratedeal-design-system/SKILL.md",
    "release": ".agents/skills/celebratedeal-release-gate/SKILL.md",
}


def manifest(role_id: str, provider: str, display: str, description: str, model: str, reasoning: str, task_types: list[str]) -> dict[str, object]:
    read_only = role_id in {"ai-team-orchestrator", "product-architect", "system-architect", "ux-design-lead", "code-reviewer", "security-reviewer", "release-manager"}
    write_paths_by_role = {
        "frontend-engineer": ["src/app/**", "src/components/**", "tests/**", "docs/design/**"],
        "backend-engineer": ["src/app/api/**", "src/lib/**", "tests/**"],
        "database-security-engineer": ["prisma/**", "src/lib/**", "tests/**", "docs/database/**"],
        "attribution-engineer": ["src/lib/attribution*", "src/app/api/affiliate-clicks/**", "tests/**", "docs/product/**"],
        "commission-engineer": ["src/lib/affiliate*", "src/lib/payment*", "src/lib/settlement*", "tests/**", "docs/product/**"],
        "test-engineer": ["tests/**", "src/**/*.test.ts", "docs/qa/**"],
        "repair-engineer": ["src/**", "tests/**", "docs/**"],
    }
    skills = [SKILLS["product"], SKILLS["release"]]
    if any(item in task_types for item in ["security", "security-review", "tenant", "database"]):
        skills.append(SKILLS["security"])
    if any(item in task_types for item in ["attribution", "commission", "finance"]):
        skills.append(SKILLS["finance"])
    if provider == "antigravity" or any(item in task_types for item in ["test", "regression", "browser", "mobile", "accessibility", "visual", "visual-regression"]):
        skills.append(SKILLS["browser"])
    if any(item in task_types for item in ["ux", "ui", "visual", "visual-regression", "mobile"]):
        skills.append(SKILLS["design"])
    return {
        "$schema": "../../schemas/role-manifest.schema.json", "schema_version": 2,
        "role_id": role_id, "display_name": display, "provider": provider,
        "requested_model": model, "reasoning": reasoning, "description": description,
        "responsibilities": task_types, "task_types": task_types,
        "skills": sorted(set(skills)),
        "input_contract": ["task_id", "scope", "acceptance_criteria", "upstream_artifacts"],
        "output_contract": ["status", "summary", "findings", "changed_files", "tests", "requested_model", "actual_model"],
        "read_paths": ["AGENTS.md", "src/**", "tests/**", "docs/**", "prisma/**", "automation/prompts/**"],
        "write_paths": (["tests/**", "docs/qa/**", "reports/**"] if provider == "antigravity" else [] if read_only else write_paths_by_role.get(role_id, ["tests/**"])),
        "forbidden_paths": (["src/**", "prisma/**", ".env*", "package.json", "package-lock.json", ".github/**", ".git/**", "*.pem", "*.key"] if provider == "antigravity" else [".env*", "cookies.txt", ".git/**", "*.pem", "*.key"]),
        "output_schema": "automation/schemas/role-output.schema.json",
        "definition_of_done": ["scope respected", "evidence recorded", "focused tests passed", "no production mutation"],
        "reviewer_role": "security-reviewer" if role_id in {"database-security-engineer", "attribution-engineer", "commission-engineer"} else "release-manager" if role_id in {"code-reviewer", "security-reviewer"} else "code-reviewer",
        "qa_role": "regression-verifier" if provider == "codex" else role_id,
        "handoff": {"strategy": "dynamic-dag", "on_failure": "repair-engineer"},
        "retry_policy": {"max_retries": 2, "retryable": ["timeout", "provider-transient", "validation-failure"]},
        "fallback_policy": {"provider": "codex", "model": "gpt-5.4", "allowed_reasons": ["provider-unavailable", "model-unavailable", "quota"]},
        "token_budget": 24000 if reasoning == "high" else 12000,
        "context_budget": {"max_files": 80, "max_artifact_bytes": 200000},
    }


def main() -> None:
    entries = []
    for role_id, (display, description, model, reasoning, tasks) in CODEX_ROLES.items():
        payload = manifest(role_id, "codex", display, description, model, reasoning, tasks)
        path = AUTOMATION / "roles" / "codex" / f"{role_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        entries.append({"role_id": role_id, "provider": "codex", "manifest": str(path.relative_to(ROOT)).replace("\\", "/"), "enabled": True})
    for role_id, (display, description, model, tasks) in ANTIGRAVITY_ROLES.items():
        payload = manifest(role_id, "antigravity", display, description, model, "high", tasks)
        path = AUTOMATION / "roles" / "antigravity" / f"{role_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        entries.append({"role_id": role_id, "provider": "antigravity", "manifest": str(path.relative_to(ROOT)).replace("\\", "/"), "enabled": True})
    registry = {"schema_version": 2, "minimum_codex_roles": 14, "minimum_antigravity_roles": 10, "roles": entries}
    (AUTOMATION / "role-registry.yaml").write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
