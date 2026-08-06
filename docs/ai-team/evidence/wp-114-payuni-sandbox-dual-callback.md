# WP-114 — PayUni Sandbox dual callback evidence

Date: 2026-07-31 (Asia/Taipei)  
Result: `PARTIAL_NON_2XX_CALLBACK_OBSERVED`

## Confirmed evidence

- Payment preflight passed: Sandbox process controls, non-Production Preview alias, public direct callback route, 117-test disposable schema prerequisite, syntax, lint, TypeScript, and diff check.
- Exactly one official PayUni Sandbox synthetic payment runner was started.
- Its new handoff receipt is `PENDING_REFUND`; browser checkout, payment callback match, and provider reconciliation are all `passed`.
- Bounded Preview logs contain one fixed-schema `POST return 200` and one `POST notify 200`.

## Fail-closed boundary

The same bounded log window also contains one fixed-schema `POST notify 500`. Therefore the WP-114 acceptance criterion of no non-2xx callback in the isolated window is not met. No second payment, manual replay, patch, deploy, provider query, or refund was performed after observing it.

CAT04 remains **6.0/10** pending Sol review. This evidence is neither Sandbox-ready nor Production-ready.

## Safety

The saved evidence contains only source, method, fixed path, status and timestamp categories; no raw identifiers, body, headers, query, card, credentials, cookies, IPs or raw logs are retained. AGY Fast produced no usable structured response and is `TOOL_BLOCKED`.
