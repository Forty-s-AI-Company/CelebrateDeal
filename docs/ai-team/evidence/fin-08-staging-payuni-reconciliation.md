# FIN-08 staging PayUni reconciliation

## Result

- Status: `FIN08_DEFERRED_WAITING_STAGING_VERSION`
- Classification: `STAGING_VERSION_FRESHNESS_GATE_FAIL` (not schema drift)
- Execution mode: one-shot Preview broker attempt
- Receipt: `.ai-team/reports/fin08-staging-payuni-reconciliation.json`

## Sanitized evidence

- Vercel project matched: `true`
- Preview target matched: `true`
- Deployment READY: `true`
- Deployment identity present: `true`
- WP-187 marker matched: `false`
- WP-187 source digest matched: `false`
- Health HEAD status: `200`
- Health probe redirected: `false`
- Broker child entered: `false`
- Database connections: `0`
- Database writes: `0`
- PayUni provider queries: `0`
- Replay disposition: `NOT_RUN`
- Score applied: `false`

## Safety

- `.env*` / dotenv read: `false`
- Raw environment values persisted: `false`
- Raw provider response persisted: `false`
- Credentials, tokens, cookies persisted: `false`
- Production or shared database access: `false`
- Production side effects: `0`

## Decision

The Preview deployment is reachable and READY, but it does not carry the accepted WP-187 marker/source digest. FIN-08 therefore stopped before broker, database, and PayUni work. Do not retry this FIN-08 receipt; deploy the accepted WP-187 lineage to Preview and plan a fresh FIN-08 authorization/receipt afterward.

## Read-only QA

- AGY Fast: `TOOL_BLOCKED_NO_STRUCTURED_OUTPUT` after the bounded two-attempt wrapper request; raw output was not persisted.
- AGY Deep: wrapper process returned `SUCCESS`, but no verifiable structured verdict was retained; classified `FALLBACK_HANDOFF_REQUIRED` and not treated as QA pass.
- Native Luna review: required by the control-plane fallback chain; not auto-started by PowerShell or MCP.
