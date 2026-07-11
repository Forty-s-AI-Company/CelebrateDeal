# Role Registry Report

- Canonical registry: `automation/role-registry.yaml`
- Codex roles: `14`
- Antigravity QA roles: `10`
- Existing native Codex TOML agents preserved: `11`
- Skills reused: `9`
- Validation: every canonical role has provider, requested model/reasoning, responsibilities, task types, Skills, input/output contracts, read/write/forbidden paths, output schema, DoD, reviewer, QA role, handoff, retry/fallback and token/context budgets.
- Antigravity requested models are limited to discovered `Gemini 3.5 Flash (High)` and `Gemini 3.1 Pro (High)`.
- Antigravity product source, Prisma, env, package and CI paths are forbidden.
