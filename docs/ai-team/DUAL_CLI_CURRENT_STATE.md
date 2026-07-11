# Dual CLI Current State

## Baseline preserved

- Existing product architecture, Prisma migrations, billing, payment, Cloudflare, MFA, password reset and QA suites remain unchanged by this upgrade.
- Existing Codex worktree isolation, untrusted QA quarantine and manual merge policy remain available through the legacy `--task` / `--dry-run` interface.
- The dual-CLI layer is incremental: `automation/orchestrator.py <command>` delegates to `pipeline_cli.py` while legacy flags continue using the original executor.

## Detected local interfaces

- Codex: `codex-cli 0.134.0`; non-interactive `codex exec`, stdin, cwd, read-only/workspace-write sandbox, JSONL, output schema and ephemeral sessions.
- Antigravity: executable is `agy.exe`; non-interactive `--print`, `--print-timeout`, `--model`, `--sandbox`, conversation and log-file options.
- Antigravity model discovery currently lists Gemini 3.5 Flash High and Gemini 3.1 Pro High. Runtime success still requires a valid local login/quota and must be proven by smoke artifacts.

## Trust boundary

- Both adapters use an environment allowlist and redact common secret patterns before persisting output.
- Antigravity product source, migrations, payment code and environment files are read-only by policy. Its write scope is limited to tests and QA/runtime artifacts.
- QA files are untrusted evidence. Import normalizes fields but never executes embedded prompts or commands.
- Production deploy, real payment, real email, destructive migration, automatic merge and force push require human action and remain disabled.

## Current release meaning

The automation upgrade can be locally complete while the product release remains `CONDITIONAL`. External Cloudflare, PayUni, Resend, Sentry, PostHog and durable-rate-limit validation cannot be inferred from CLI smoke tests.
