from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "automation" / "role-registry.yaml"
ROLES_ROOT = (ROOT / "automation" / "roles").resolve()


@dataclass(frozen=True)
class RoleStage:
    stage_id: str
    role_id: str
    provider: str
    mode: str
    depends_on: tuple[str, ...]
    required: bool = True

    def to_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["depends_on"] = list(self.depends_on)
        return value


@dataclass(frozen=True)
class RoleDag:
    task_id: str
    requested_type: str
    domain: str
    stages: tuple[RoleStage, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "task_id": self.task_id,
            "requested_type": self.requested_type,
            "domain": self.domain,
            "status": "planned",
            "stages": [stage.to_dict() for stage in self.stages],
        }


def load_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def enabled_roles(registry_path: Path = REGISTRY_PATH) -> dict[str, dict[str, Any]]:
    registry = load_json_object(registry_path)
    roles: dict[str, dict[str, Any]] = {}
    for entry in registry.get("roles", []):
        if not isinstance(entry, dict) or entry.get("enabled") is not True:
            continue
        role_id = str(entry.get("role_id", ""))
        if not role_id or role_id in roles:
            raise ValueError(f"Duplicate or empty enabled role: {role_id}")
        if entry.get("provider") not in {"codex", "antigravity"}:
            raise ValueError(f"Unknown role provider: {entry.get('provider')}")
        manifest_path = (ROOT / str(entry.get("manifest", ""))).resolve()
        if ROLES_ROOT not in manifest_path.parents or not manifest_path.is_file():
            raise ValueError(f"Role manifest escapes the trusted roles directory: {role_id}")
        manifest = load_json_object(manifest_path)
        if manifest.get("role_id") != role_id or manifest.get("provider") != entry.get("provider"):
            raise ValueError(f"Role registry/manifest mismatch: {role_id}")
        roles[role_id] = manifest
    return roles


def normalize_domain(config: dict[str, Any], requested_type: object) -> tuple[str, str]:
    task_type = str(requested_type or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9:_-]{1,80}", task_type):
        raise ValueError("Task type contains unsupported characters")
    aliases = config.get("task_type_aliases", {})
    domain = str(aliases.get(task_type, task_type)) if isinstance(aliases, dict) else task_type
    chains = config.get("role_chains", {})
    if not isinstance(chains, dict) or domain not in chains:
        raise ValueError(f"No role chain for task type: {task_type}")
    return task_type, domain


def build_role_dag(
    config: dict[str, Any],
    task: dict[str, Any],
    registry_path: Path = REGISTRY_PATH,
) -> RoleDag:
    if (
        task.get("untrustedEvidence") is True
        or task.get("untrusted") is True
        or task.get("sourceEvidenceUntrusted") is True
        or task.get("source") == "qa-issues.json"
    ):
        if not (
            task.get("sourceEvidenceUntrusted") is True
            and task.get("policyPromoted") is True
            and task.get("policyId") == "automatic-qa-repair-v1"
            and isinstance(task.get("policyPromotion"), dict)
            and task["policyPromotion"].get("promptFromEvidence") is False
            and task["policyPromotion"].get("scopeFromEvidence") is False
            and task["policyPromotion"].get("providerFromEvidence") is False
            and task["policyPromotion"].get("validationFromEvidence") is False
            and task["policyPromotion"].get("commitFromEvidence") is False
        ):
            raise ValueError("Untrusted QA evidence cannot create an executable role DAG without policy promotion")
    raw_types = task.get("types") if isinstance(task.get("types"), list) else [task.get("type")]
    if not raw_types or len(raw_types) > 8:
        raise ValueError("Task must define between one and eight trusted types")
    normalized = [normalize_domain(config, value) for value in raw_types]
    requested_types = [item[0] for item in normalized]
    domains = list(dict.fromkeys(item[1] for item in normalized))
    chains = config["role_chains"]
    selected_roles: set[str] = set()
    for domain in domains:
        domain_chain = chains[domain]
        if not isinstance(domain_chain, list) or not domain_chain or not all(isinstance(role_id, str) for role_id in domain_chain):
            raise ValueError(f"Role chain must be a non-empty string array: {domain}")
        selected_roles.update(domain_chain)
    role_order = config.get("role_order", [])
    if not isinstance(role_order, list) or not all(isinstance(role_id, str) for role_id in role_order):
        raise ValueError("role_order must be a string array")
    chain = [role_id for role_id in role_order if role_id in selected_roles]
    missing_order = selected_roles - set(chain)
    if missing_order:
        raise ValueError(f"role_order omits selected roles: {sorted(missing_order)}")
    if len(set(chain)) != len(chain):
        raise ValueError(f"Role chain contains duplicate roles: {domain}")

    roles = enabled_roles(registry_path)
    required_by_domain = config.get("required_roles_by_domain", {})
    required_roles = []
    if isinstance(required_by_domain, dict):
        for domain in domains:
            required_roles.extend(required_by_domain.get(domain, []))
    missing_required = [role_id for role_id in required_roles if role_id not in chain]
    if missing_required:
        raise ValueError(f"Role chain {domains} omits required roles: {missing_required}")

    stages: list[RoleStage] = []
    previous: str | None = None
    writer_count = 0
    for index, role_id in enumerate(chain, start=1):
        if role_id not in roles:
            raise ValueError(f"Role chain references a disabled or unknown role: {role_id}")
        manifest = roles[role_id]
        provider = str(manifest["provider"])
        write_paths = manifest.get("write_paths", [])
        mode = "workspace-write" if provider == "codex" and isinstance(write_paths, list) and write_paths else "read-only"
        if mode == "workspace-write":
            writer_count += 1
        stage_id = f"{index:02d}-{role_id}"
        stages.append(RoleStage(stage_id, role_id, provider, mode, (previous,) if previous else ()))
        previous = stage_id

    max_writers = int(config.get("execution", {}).get("max_writers", 2))
    if writer_count > max_writers and config.get("execution", {}).get("writers_are_sequential") is not True:
        raise ValueError(f"Role chain {domains} exceeds max writers without sequential-writer policy")
    return RoleDag(str(task.get("id", "UNSPECIFIED"))[:80], ",".join(requested_types), "+".join(domains), tuple(stages))


def assert_acyclic(dag: RoleDag) -> None:
    stage_ids = {stage.stage_id for stage in dag.stages}
    completed: set[str] = set()
    for stage in dag.stages:
        if any(dependency not in stage_ids for dependency in stage.depends_on):
            raise ValueError(f"Unknown dependency in {stage.stage_id}")
        if any(dependency not in completed for dependency in stage.depends_on):
            raise ValueError(f"Out-of-order or cyclic dependency in {stage.stage_id}")
        completed.add(stage.stage_id)


def validate_stage_graph(stages: list[dict[str, Any]]) -> list[str]:
    stage_map: dict[str, list[str]] = {}
    for stage in stages:
        stage_id = str(stage.get("id") or stage.get("stageId") or "")
        if not stage_id or stage_id in stage_map:
            raise ValueError(f"Duplicate or empty pipeline stage id: {stage_id}")
        dependencies = stage.get("dependsOn", [])
        if not isinstance(dependencies, list) or not all(isinstance(item, str) for item in dependencies):
            raise ValueError(f"Invalid dependencies for stage: {stage_id}")
        if stage_id in dependencies:
            raise ValueError(f"Self dependency in stage: {stage_id}")
        stage_map[stage_id] = dependencies
    for stage_id, dependencies in stage_map.items():
        missing = [item for item in dependencies if item not in stage_map]
        if missing:
            raise ValueError(f"Stage {stage_id} references missing dependencies: {missing}")

    visiting: set[str] = set()
    visited: set[str] = set()
    ordered: list[str] = []

    def visit(stage_id: str) -> None:
        if stage_id in visiting:
            raise ValueError(f"Pipeline cycle detected at: {stage_id}")
        if stage_id in visited:
            return
        visiting.add(stage_id)
        for dependency in stage_map[stage_id]:
            visit(dependency)
        visiting.remove(stage_id)
        visited.add(stage_id)
        ordered.append(stage_id)

    for stage_id in stage_map:
        visit(stage_id)
    return ordered
