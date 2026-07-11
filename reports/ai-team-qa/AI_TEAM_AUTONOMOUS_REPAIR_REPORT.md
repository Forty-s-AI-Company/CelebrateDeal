# AI Team Autonomous Repair Report

## Evidence basis

The requested `AI_TEAM_QA_REPORT.md`, `ai-team-issues.json` and `CODEX_AI_TEAM_REPAIR_PROMPT.md` were not present in this checkout. The latest available Antigravity evidence was read from:

- `reports/antigravity/AI_TEAM_AUTONOMOUS_QA.md`
- `reports/antigravity/qa-issues.json`
- `qa-issues.json`
- independent control-plane review output supplied during this run

## QA issue disposition

| Severity | Findings | Disposition |
| --- | ---: | --- |
| P0 | 0 | None supplied |
| P1 | 2 | Repaired in `automation/` and covered by regression tests |
| P2 | 4 | Repaired in `automation/` and covered by regression tests |
| P3 | 1 | `QA-AUTO-001` remains closed; external skill description warning only |

The two P1 findings were untrusted QA task control leakage and release evidence being reported as completed despite a blocked release check. The P2 findings were issue-ID-only resolution, missing Git lineage verification, non-replayable validation evidence, and workspace-write quota recovery. A further lease recovery hardening was included for dead coordinator owners.

## Policy decision

Automatic QA repair is enabled by `autonomy.auto_promote_qa=true`. Promotion is server-built under `automatic-qa-repair-v1`; the source QA payload remains evidence only. The generated task uses fixed prompt, role DAG, provider, validation, write paths, forbidden paths and commit policy. Production merge, deployment, real payment, real email and destructive operations remain blocked.

## Pipeline order

`plan -> read-only stages -> isolated workspace-write -> reviewer/QA stages -> Antigravity QA import -> regression -> release-check -> commit evidence`

Workspace-write receipts bind commit SHA, approved tree, validation log hash, staged secret-scan hash, attempt nonce and QA evidence. Quota and dead-owner recovery return a stage to a new attempt instead of accepting orphaned evidence.

## Release status

`CONDITIONAL`: local control-plane tests are passing. Antigravity provider-native execution and external service validation remain External required; no production deployment or push was performed.
