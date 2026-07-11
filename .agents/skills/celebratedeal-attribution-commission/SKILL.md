---
name: celebratedeal-attribution-commission
description: Design, implement, test, or reconcile CelebrateDeal referrals, attribution windows, affiliate clicks, checkout binding, commissions, refunds, negative adjustments, settlements, payouts, and external storefront link replacement. Use for payment webhooks, referralCode handling, order attribution, commission ledgers, reconciliation, refund logic, or affiliate reporting.
---

# CelebrateDeal Attribution and Commission

## Workflow

1. Read [attribution-state-machine.md](references/attribution-state-machine.md).
2. Define the immutable identifiers: provider, event ID, order number, pending transaction, vendor, affiliate, product/live, visitor/session, and attribution record.
3. Capture a referral candidate from URL/cookie/session, but bind the accepted attribution server-side at checkout.
4. Create commission only after verified paid conversion and only once per eligible conversion.
5. Apply refund and chargeback as idempotent void or append-only negative adjustment.
6. Reconcile webhook totals, transaction totals, refund records, commission ledger, settlement, and payout.
7. Test duplicates, partial refunds, out-of-order events, expired links, invalid affiliate, self-referral policy, and provider retry.

## Invariants

- Unknown orders do not create authoritative paid transactions in production.
- Client price, vendor, affiliate, and commission rate never override server records.
- Provider event IDs and refund adjustments have database uniqueness appropriate to the provider.
- Locked settlement is immutable; later corrections use adjustments.
- External storefront click is not a conversion without external order evidence.

## Output format

Provide:

1. Event/state table.
2. Source-of-truth fields.
3. Idempotency keys and unique constraints.
4. Ledger entries and signs.
5. Reconciliation equations.
6. Abuse cases and tests.
7. External required.

## Prohibitions

- Do not calculate commission from an unverified webhook or arbitrary URL referral code.
- Do not mutate historical paid ledger entries to hide corrections.
- Do not create multiple negative adjustments for one provider refund event.
- Do not report click-through as revenue.

