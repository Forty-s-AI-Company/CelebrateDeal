# Skill Role Matrix

| Skill | Primary Codex roles | Primary Antigravity roles |
|---|---|---|
| `celebratedeal-product-domain` | product-architect, system-architect, backend-engineer | product-flow-auditor |
| `celebratedeal-multi-tenant-security` | database-security-engineer, backend-engineer, security-reviewer | tenant-isolation-auditor |
| `celebratedeal-attribution-commission` | attribution-engineer, commission-engineer, security-reviewer | attribution-qa-engineer, commission-qa-engineer |
| `celebratedeal-design-system` | ux-design-lead, frontend-engineer, code-reviewer | ui-ux-auditor, visual-regression-reviewer, mobile-qa-engineer |
| `celebratedeal-browser-qa` | test-engineer, release-manager | browser-qa-engineer, regression-verifier, accessibility-auditor |
| `celebratedeal-release-gate` | security-reviewer, release-manager, ai-team-orchestrator | regression-verifier |
| `web-design-guidelines` | ux-design-lead, code-reviewer | ui-ux-auditor, accessibility-auditor |
| `vercel-react-best-practices` | frontend-engineer, code-reviewer | browser-qa-engineer, mobile-qa-engineer |
| `frontend-design` | ux-design-lead, frontend-engineer | ui-ux-auditor, visual-regression-reviewer |

## Loading policy

- Reuse the checked-in Skills and `skills-lock.json`; do not redownload them during routine pipeline execution.
- A role loads only the Skills listed in its manifest to limit context and reduce conflicting instructions.
- Provider prompts always include the shared handoff contract. Provider-specific prompts add execution constraints but do not override `AGENTS.md`.
- Missing or unreadable Skill paths fail validation before a role starts.
