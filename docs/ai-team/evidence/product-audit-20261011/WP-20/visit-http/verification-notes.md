# HTTP prepare and visit entry

POST /api/live-metrics/[vendorId]/[liveId]/visits accepts strict {action:prepare} or {action:visit,eventId}. Uses canonical same-origin+client-header check, trusted-entry rate limiter120/min, 1024-byte body bound, explicit scope, private no-store on all handled responses. prepare calls uncounted prepareMetricVisit; visit calls proof-required collectPreparedMetricVisit. Scope-specific __Host cookie is Secure/HttpOnly/SameSiteStrict/Path=/, effective server expiry. Proof/visitor ID never in response JSON; no raw error logs. Errors mapped generically403/404/503; no identity reset on failures.

Dedicated LIVE_METRIC_VISITOR_KEYRING is read by application code only from injected process configuration; strict JSON current{id,key64hex}, optional<=2previous, no fallback key. Tools did not read environment values, secrets, real cookies or .env. No key configured/deployment performed by this work. Tests use mocked provider and synthetic configuration only.

Validation targeted HTTP/config tests, scoped lint, full tsc PASS4ff92e4bd9f52962366682d4cec5a73e2f01095460be05d1fb2c690e7b289024. Initial test assumed NextResponse.cookies on general Response; corrected to assert actual Set-Cookie header, failure preserved. Services mocked for HTTP tests; real HTTP->DB/browser E2E NOT_RUN. Existing DB134 evidence is separate prior lower-layer validation, not HTTP E2E.

Outstanding before activation: browser cross-tab preparation serialization, actual HTTPS cookie behavior, lifecycle change handling when cookie scope retains old version, expiry-cookie deletion vs proof recovery semantics, full collector coverage/pipeline, independent Auth review. Duplicate cookie getAll behavior not browser-verified. This is implemented source, not deployed or end-to-end enabled collection.

Rollback: remove new visits route/test and config helper/test; no external state to revert.
