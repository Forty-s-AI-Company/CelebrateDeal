from __future__ import annotations

import re
import json
import hashlib
import tomllib
from pathlib import Path

from routing import build_role_dag, validate_stage_graph


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_AGENTS = {
    "orchestrator", "product-architect", "explorer", "frontend-engineer", "ux-design-lead",
    "backend-engineer", "database-security-engineer", "attribution-commission-engineer",
    "test-engineer", "security-reviewer", "release-manager",
}
REQUIRED_SKILLS = {
    "celebratedeal-product-domain", "celebratedeal-design-system", "celebratedeal-multi-tenant-security",
    "celebratedeal-attribution-commission", "celebratedeal-browser-qa", "celebratedeal-release-gate",
    "web-design-guidelines", "vercel-react-best-practices", "frontend-design",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def directory_digest(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = str(path.relative_to(directory)).replace("\\", "/")
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).digest())
    return digest.hexdigest()


def main() -> None:
    config = tomllib.loads((ROOT / ".codex" / "config.toml").read_text(encoding="utf-8"))
    agents_config = config.get("agents", {})
    require(int(agents_config.get("max_threads", 99)) <= 6, "agents.max_threads must be <= 6")
    require(agents_config.get("max_depth") == 1, "agents.max_depth must be 1")

    found_agents: set[str] = set()
    for path in (ROOT / ".codex" / "agents").glob("*.toml"):
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
        for key in ("name", "description", "developer_instructions", "model", "model_reasoning_effort"):
            require(bool(payload.get(key)), f"{path}: missing {key}")
        if payload.get("sandbox_mode") == "read-only":
            require("read-only" in str(payload.get("sandbox_mode")), f"{path}: invalid read-only sandbox")
        for item in payload.get("skills", {}).get("config", []):
            skill_path = ROOT / str(item.get("path", ""))
            require(skill_path.is_file(), f"{path}: missing skill path {skill_path}")
            require(item.get("enabled") is True, f"{path}: skill config must set enabled = true")
        found_agents.add(str(payload["name"]))
    require(found_agents == REQUIRED_AGENTS, f"Agent set mismatch: {sorted(found_agents ^ REQUIRED_AGENTS)}")

    found_skills: set[str] = set()
    for directory in (ROOT / ".agents" / "skills").iterdir():
        skill_file = directory / "SKILL.md"
        if not skill_file.is_file():
            continue
        text = skill_file.read_text(encoding="utf-8")
        match = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        require(match is not None, f"{skill_file}: missing YAML frontmatter")
        require(re.search(r"^name:\s*\S+", match.group(1), re.MULTILINE) is not None, f"{skill_file}: missing name")
        require(re.search(r"^description:\s*.+", match.group(1), re.MULTILINE) is not None, f"{skill_file}: missing description")
        found_skills.add(directory.name)
    require(REQUIRED_SKILLS.issubset(found_skills), f"Missing skills: {sorted(REQUIRED_SKILLS - found_skills)}")

    lock = json.loads((ROOT / "skills-lock.json").read_text(encoding="utf-8"))
    locked_skills = lock.get("skills", {})
    require(isinstance(locked_skills, dict), "skills-lock.json skills must be an object")
    for skill_name, metadata in locked_skills.items():
        require(skill_name in found_skills, f"Locked skill is missing: {skill_name}")
        require(isinstance(metadata, dict), f"Invalid skill lock metadata: {skill_name}")
        expected = metadata.get("directoryDigest")
        require(isinstance(expected, str) and re.fullmatch(r"[a-f0-9]{64}", expected) is not None, f"Missing directory digest: {skill_name}")
        actual = directory_digest(ROOT / ".agents" / "skills" / skill_name)
        require(actual == expected, f"Skill lock mismatch: {skill_name}")

    required_files = [
        "AGENTS.md", "docs/ai-team/ASSUMPTIONS.md", "docs/ai-team/SKILLS_LOCK.md",
        "docs/ai-team/SKILL_ROLE_MATRIX.md", "automation/orchestrator.py", "automation/team-config.yaml",
        "automation/role-registry.yaml", "automation/trust-manifest.json",
        "automation/adapters/base_adapter.py", "automation/adapters/codex_adapter.py",
        "automation/adapters/antigravity_adapter.py", "automation/pipelines/repair.yaml",
        "automation/pipelines/new-feature.yaml",
    ]
    for relative in required_files:
        require((ROOT / relative).is_file(), f"Missing required file: {relative}")

    registry = json.loads((ROOT / "automation" / "role-registry.yaml").read_text(encoding="utf-8"))
    require(registry.get("schema_version") == 2, "role registry schema_version must be 2")
    require(set(registry) == {"schema_version", "minimum_codex_roles", "minimum_antigravity_roles", "roles"}, "role registry has unknown or missing top-level fields")
    roles = registry.get("roles", [])
    require(isinstance(roles, list), "role registry roles must be an array")
    role_ids: set[str] = set()
    providers: dict[str, int] = {"codex": 0, "antigravity": 0}
    required_role_fields = {
        "role_id", "display_name", "provider", "requested_model", "reasoning", "description",
        "responsibilities", "task_types", "skills", "input_contract", "output_contract",
        "read_paths", "write_paths", "forbidden_paths", "output_schema", "definition_of_done",
        "reviewer_role", "qa_role", "handoff", "retry_policy", "fallback_policy", "token_budget", "context_budget",
    }
    allowed_role_fields = required_role_fields | {"$schema", "schema_version"}
    role_manifests: dict[str, dict[str, object]] = {}
    roles_root = (ROOT / "automation" / "roles").resolve()
    for entry in roles:
        require(isinstance(entry, dict), "role registry entries must be objects")
        require(set(entry) == {"role_id", "provider", "manifest", "enabled"}, "role registry entry has unknown or missing fields")
        require(entry.get("enabled") is True, f"Disabled canonical role is not allowed: {entry.get('role_id')}")
        manifest_path = (ROOT / str(entry.get("manifest", ""))).resolve()
        require(roles_root in manifest_path.parents, f"Role manifest escaped roles root: {manifest_path}")
        require(manifest_path.is_file(), f"Missing role manifest: {manifest_path}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        missing = required_role_fields - set(manifest)
        require(not missing, f"{manifest_path}: missing role fields {sorted(missing)}")
        require(set(manifest).issubset(allowed_role_fields), f"{manifest_path}: unknown role fields {sorted(set(manifest) - allowed_role_fields)}")
        role_id = str(manifest["role_id"])
        require(role_id == entry.get("role_id"), f"{manifest_path}: registry role id mismatch")
        require(role_id not in role_ids, f"Duplicate role id: {role_id}")
        role_ids.add(role_id)
        provider = str(manifest["provider"])
        require(provider == entry.get("provider"), f"{manifest_path}: registry provider mismatch")
        require(provider in providers, f"Unknown role provider: {provider}")
        providers[provider] += 1
        for skill in manifest["skills"]:
            require((ROOT / str(skill)).is_file(), f"{manifest_path}: missing skill {skill}")
        if provider == "antigravity":
            require(str(manifest["requested_model"]) in {"Gemini 3.5 Flash (High)", "Gemini 3.1 Pro (High)"}, f"{manifest_path}: unsupported requested model")
            require("src/**" in manifest["forbidden_paths"] and "prisma/**" in manifest["forbidden_paths"], f"{manifest_path}: unsafe Antigravity write policy")
        role_manifests[role_id] = manifest
    require(providers["codex"] >= 14, "At least 14 Codex roles are required")
    require(providers["antigravity"] >= 10, "At least 10 Antigravity roles are required")
    for role_id, manifest in role_manifests.items():
        require(str(manifest["reviewer_role"]) in role_ids, f"{role_id}: unknown reviewer role")
        require(str(manifest["qa_role"]) in role_ids, f"{role_id}: unknown QA role")
        handoff = manifest["handoff"]
        require(isinstance(handoff, dict) and handoff.get("strategy") == "dynamic-dag", f"{role_id}: handoff must use dynamic-dag")
        require(str(handoff.get("on_failure")) in role_ids, f"{role_id}: unknown failure handoff")

    team_config = json.loads((ROOT / "automation" / "team-config.yaml").read_text(encoding="utf-8"))
    for domain in team_config.get("role_chains", {}):
        build_role_dag(team_config, {"id": f"VALIDATE-{domain}", "type": domain})
    for pipeline_name in ("repair", "new-feature"):
        pipeline_path = ROOT / "automation" / "pipelines" / f"{pipeline_name}.yaml"
        pipeline = json.loads(pipeline_path.read_text(encoding="utf-8"))
        require(pipeline.get("schemaVersion") == 2, f"{pipeline_path}: schemaVersion must be 2")
        require(pipeline.get("id") == pipeline_name, f"{pipeline_path}: id mismatch")
        stages = pipeline.get("stages", [])
        require(isinstance(stages, list) and stages, f"{pipeline_path}: stages required")
        validate_stage_graph(stages)
        stage_ids = {str(stage.get("id")) for stage in stages if isinstance(stage, dict)}
        for stage in stages:
            require(str(stage.get("role")) in role_ids, f"{pipeline_path}: unknown role {stage.get('role')}")
            dependencies = stage.get("dependsOn", [])
            require(isinstance(dependencies, list), f"{pipeline_path}: dependsOn must be an array")
            require(all(str(item) in stage_ids for item in dependencies), f"{pipeline_path}: unknown dependency")
    print(f"AI team setup valid: {len(found_agents)} native agents, {providers['codex']} Codex roles, {providers['antigravity']} Antigravity roles, {len(found_skills)} skills.")


if __name__ == "__main__":
    main()
