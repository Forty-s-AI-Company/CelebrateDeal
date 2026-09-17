# Funnel secondary tabs implementation contract

## Persistence and non-destructive migration plan
- Add nullable `LandingPage.operations` JSON (schemaVersion 1); reuse LandingPage.revision for atomic compare-and-swap across editor/settings. Absent value reads defaults; invalid stored data fails closed.
- Add `FunnelVisit` with id, vendorId, pageId, stepId, logicalStepId, visitorId (opaque random pseudonym), experimentId?, arm?, createdAt; composite FK to LandingPage(vendorId,id), unique id. Server emits page delivery events only after published page resolution. No client-provided revenue or submission counts.
- Add `FunnelSubmission` with id, vendorId, pageId, stepId, submissionId unique, visitId?, createdAt, composite page FK, submission FK, and composite visit FK binding vendor/page/visit. Only server-validated public form submission may create attribution.
- Migration is additive SQL only; no backfill fabricating events. Validate/generate locally; deploy only to an explicitly isolated synthetic database. No production migration or destructive commands.
- Existing PaymentTransaction.metadata.funnel.pageId/stepId is server-validated at checkout; Sales joins CommerceOrder.primaryPaymentTransaction and excludes test orders. Read paid/refunded projection, not browser events.

## Settings contract
operations = {schemaVersion:1, experiment:null|{id,status:'draft'|'running'|'stopped'|'winner',controlStepId,variantStepId,controlWeight,variantWeight,winner:null|'control'|'variant'}, deadline:{enabled,timezone,expiresAt:null|ISO-UTC,behavior:'closed'|'redirect',redirectPath}, reports:{stats:{stepId,days},leads:{stepId,days},sales:{stepId,days}}}.
Weights are integers 0..100, sum 100; running requires positive weights and distinct existing non-system published steps. Running allocation immutable; stop then create new experiment ID to rebalance. Winner requires chosen arm. Assignment hashes pageId + experimentId + visitor pseudonym. Control URL chooses arm; variant is excluded from normal progression metrics.
Deadline uses explicit IANA timezone and absolute offset-bearing timestamp; boundary now >= expiresAt. Redirect is same-funnel valid non-system step, cannot self-loop; target remains accessible after deadline. Public server decision precedes render and form/checkout side effects; client receives server decision, never overrides it.
Name/slug persisted in LandingPage; flow.name/domain/currency synchronized via revision CAS. Domain currently means canonical /lp/{slug} path, not unverified custom hostname. Currency uses supported product currency checks.
Report filters persist independently as part of operations CAS; source records are immutable. Leads return IDs, step, time and verification status only, no name/email/phone/answers. Report reads always constrain vendor + project + page; bounded time windows/pagination and clearly visible caps.

## Automation
Reuse AutomationRule and AutomationExecutionLog. Add nullable funnelPageId scope to rule and optional funnelPageId to server AutomationEvent; scoped rules run only when trusted event page matches. MVP form_registered -> add_customer_tag only, no new external side effects. Persist rule version CAS, tenant/project checks and CSRF. Existing vendor-wide automation remains unchanged.

## Verification / rollback
Deterministic assignment, legal weights, aggregation and ordered step drop-off, timezone boundaries, tenant isolation, CAS conflicts, automation idempotency, browser save/reload and public expiry tests. Synthetic data only. Roll back application via exact checkpoint revert; leave additive columns/tables intact rather than deleting data. Record actual commands/results and remaining deployment requirements in evidence.

## Implementation checkpoint
- Reused shared LandingPage revision across settings/editor; references are guarded on draft save, step changes, publish and rollback.
- All new submission + provenance writes commit in one transaction. Duplicate registrations never rewrite origin.
- Webinar public pages and play handoff also execute deadline gates. Redirect destination may render but cannot submit/checkout after expiry.
- Stable allocation additionally rejects reusing an experiment identity with historical assignment events.
- AI review fallback: no callable Claude/Gemini review capability was available; independent native Terra review found Webinar bypass and missing observed-visit enforcement, both fixed and re-reviewed successfully.
- Existing `.github/workflows/ci.yml` already triggers on push and pull_request, runs ESLint, typecheck and unit/coverage plus E2E. New tests join those existing gates; no production deployment trigger was added.
