# Discovery and Triage

`npm run ai:discover` captures the current Git baseline and runs the AI control-plane deterministic checks. Add `-- --quality` to include lint, typecheck, product tests, build and preflight.

`npm run ai:triage` rebuilds candidate task controls on the server side. Provider, role, command, validation and write-scope fields from discovered evidence are ignored. P0/P1 and high-risk paths are never auto-executable.

`npm run ai:auto-cycle:once` chooses an existing trusted pending task when one exists. When the queue is empty it runs discovery and triage and writes the decision to `reports/ai-team/runtime/auto-cycle.json`. Generated candidates remain separate from committed trusted backlog until provenance is recorded by the control-plane commit gate.

Runtime discovery state is not a release receipt. A task must still produce its role DAG, scoped artifacts, validation evidence and attested stage receipts.
