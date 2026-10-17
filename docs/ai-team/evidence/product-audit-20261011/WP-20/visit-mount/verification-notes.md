# Public page mount and real Chromium lifecycle

LiveMetricVisit mounts on ready public live page only if server signing configuration is present and runtime is not unavailable. Only vendor/live IDs cross the RSC boundary; signing value never serialized. Client effect owns a scoped driver in ref, preserving it during React StrictMode effect replay. Up to three delayed retries1/5/15s retain event ID; unmount prevents scheduling and cancels pending retry timer. No playback UI/control mutations, no secret/cookie logging. Current in-flight HTTP may finish after unmount; it still represents that actual page visit.

React checklist: client boundary explicit; effects depend on primitive scope IDs; no side effects/ref mutation during render; no duplicated UI or accessibility impact; no unrelated playback refactor. Skill vercel:react-best-practices applied.

Validation browser/lint/full tsc PASS62e15513aaaad4a8a47c9a967faa90a955619671d18e70ff06fc4d3992f96573. Real Chromium development React StrictMode, two pages in same fresh browser context, actual navigator.locks: exactly two prepares/two logical page events and no overlapping prepare-to-visit interval. Unmount after synthetic503 cancels retry. Browser/server cleanup PASS. Harness uses owned127.0.0.1 and synthetic HTTP responses, not actual Next route/DB/HttpOnly cookie flow; full HTTPS E2E NOT_RUN. No deployment or secret configuration performed.

Outstanding: current cookie version/expiry transition handling, actual HTTP+DB+browser cookie integration, missing-collection gap evidence, durable coverage, full metric pipeline/UI, independent Auth review. Retries exhausted are not evidence of complete collection. No global completion claim.

Rollback: remove component/import/wrapper/conditional from public page and new browser script; no external state.
