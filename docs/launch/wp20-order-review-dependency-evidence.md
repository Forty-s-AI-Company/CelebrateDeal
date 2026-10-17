# WP-20 orders review dependency evidence

Status: developer evidence supplement, NOT reviewer adjudication or acceptance. Original findings remain in coverage/order-producer-binding-review.json.

## COUNT revision / ABA

- Migration 20261015210000_live_metric_order_tenant_revision attaches LiveMetricOrderTenantSource_immutable BEFORE UPDATE OR DELETE and no_truncate BEFORE TRUNCATE. It also revokes all table/sequence/function rights from PUBLIC and configured API roles and enables RLS.
- The reused wp20_metric_order_source_immutable definition is in 20261015140000_live_metric_order_source: always raises 23514 except DELETE after the owning Vendor no longer exists. This is not a general retention/pruning allowance.
- 20261015170000_live_metric_registration_source_revision likewise protects registration ledger. The vendor cascade exception must be assessed with the whole FK chain: Vendor removal also removes its LiveMetricVersion and version-owned proofs/reports. It is not permission to prune events for an existing tenant.
- Actual owned-disposable evidence already checks tenant ledger UPDATE/DELETE/TRUNCATE rejection and unchanged count; API roles denied. Source CommerceOrder/PaymentTransaction TRUNCATE checks added this turn; see terminal receipt before claiming PASS.
- Need reviewer confirmation of dependency-based disposition; no automatic MAJOR closure.

## Classifier dependency inventory

Source: src/lib/live-metric-order-audit.ts, not inferred from commerce business requirements.

| Read input | Fence / evidence | Remaining limit |
| --- | --- | --- |
| CommerceOrder.vendorId, primaryPaymentTransactionId, createdAt, status | tenant trigger compares all four, INSERT/DELETE tracked, old/new vendor events | vendor transfer dedicated proof lifecycle not yet tested |
| CommerceOrder.id keyset/digest | migration112 adds ID to tenant trigger tuple; actual update increases revision | proof lifecycle after ID-only change still pending |
| PaymentTransaction presence/vendorId/metadata | tenant INSERT/DELETE/vendorId/whole metadata UPDATE; old/new vendor events | migration112 explicitly tracks ID; actual update increases revision |
| Payment status/amount | not read by this classifier | cannot assert these are missing classifier fences |
| FormSubmission.liveId/formId/verificationStatus/verifiedAt/id | registration authoritative ledger compares these fields; verified old/new live tracked | order-specific all-input mutation matrix not yet complete |
| Live.formId / RegistrationForm.vendorId | existing source invalidation and ownership constraint probes | attach exact trigger/FK definitions for final review |
| LiveMetricRegistration identity/verifiedAt | immutable identity guards, insert/delete projection ledger | existing registration lifecycle tests; order-specific proof matrix pending |
| LiveMetricVersion scope/window/origin | version sourceRevision increments; identity/origin immutable; collection toggle tested | changing clock availability is not a source revision |

## Other findings

- Audit digest already hashes canonical scope plus rows and revisions. Producer now explicitly hashes scope into v2 proofId and SELECT-verifies all persisted columns. Actual collision fixture returns conflict, preserves the mismatched row; distinct empty windows have distinct IDs. Review still pending.
- Coverage reader now uses a MATERIALIZED revisions CTE. Large ledger +10000 coverage audit benchmark remains required; no claim of performance closure.
- Tenant-wide invalidation/liveness is real design scope still unresolved. Do not replace with a per-tenant shared counter merely to obtain O(1): original Serializable contention gate remains failed and the counter could worsen it. Any window fence must include old/new dates, unattributed orders, metadata edits and cross-tenant moves.
- Existing direct owner fixture writes test DB guards only; they do not establish deployed worker permissions or producer authorization.
- Original20 synchronized Serializable payment gate remains FAIL. No waiver, no exposure/deploy, no whole-WP completion.

Identity supplement: migration20261016000000_live_metric_order_identity_revision includes order/payment IDs in update comparisons. order-identity-revision-db.json proves both actual ID updates increase tenant revision; rolled back afterward. This is developer remediation evidence, not reviewer closure.
