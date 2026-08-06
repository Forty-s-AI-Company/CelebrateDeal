# FIN-08T AGY QA

- AGY Fast attempt 1: `FIRST_OUTPUT_TIMEOUT`
- AGY Fast attempt 2: `FIRST_OUTPUT_TIMEOUT`
- AGY Fast classification: `TOOL_BLOCKED`
- AGY Deep fallback: wrapper completed without a verifiable model verdict;
  headless read-file permission was denied. Classification:
  `QA_RECEIPT_UNAVAILABLE`
- LUNA fallback: no local `luna` command or wrapper is installed;
  classification: `TOOLCHAIN_MISSING`

AGY output was not used as product acceptance. Deterministic tests, sanitized
receipt verification, and Sol High acceptance remain authoritative.
