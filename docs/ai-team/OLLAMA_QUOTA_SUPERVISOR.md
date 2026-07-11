# Ollama Quota Supervisor

The local supervisor keeps the control loop alive when Codex or Antigravity reports quota exhaustion. It does not replace either provider and cannot satisfy provider-native stages.

Allowed models:

- `qwen2.5-coder:1.5b`: default quota-state summary and supervisor report.
- `qwen3:8b`: optional local analysis when the workstation can run it reliably.
- `qwen2.5-coder:7b`: documentation and simple metadata assistance.
- `qwen2.5-coder:1.5b`: formatting-only work.
- `qwen2.5vl:3b`: lightweight screenshot notes.
- `nomic-embed-text:latest`: local document retrieval.

Ollama receives a redacted state summary and writes only a runtime report artifact. It receives neither `AI_PIPELINE_ATTESTATION_KEY` nor provider credentials. Every local result records `providerRequirementSatisfied=false`, `capabilityEquivalent=false` and `requiresProviderResume=true`.
