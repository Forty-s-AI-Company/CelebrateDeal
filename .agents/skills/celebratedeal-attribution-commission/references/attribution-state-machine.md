# Attribution and Commission State Machine

| Event | Preconditions | Durable result | Idempotency key |
| --- | --- | --- | --- |
| Referral visit | Active vendor/affiliate/link, within policy | Candidate attribution/click | Visitor + campaign + bounded time bucket |
| Checkout start | Server product/live and accepted attribution | Pending transaction with frozen amount/affiliate | Vendor + order number |
| Provider paid | Valid signature, known pending order, amount match | Paid transaction and positive commission | Provider + event ID; conversion unique key |
| Partial refund | Valid signature, known transaction, amount delta | Refund record and negative commission adjustment | Provider + refund event ID |
| Full refund | Valid signature, remaining refundable amount | Refunded transaction and commission void/offset | Provider + refund event ID |
| Settlement lock | Reconciliation clean, approved period | Immutable settlement snapshot | Vendor + period |
| Payout | Locked eligible settlement, approved account | Payout item/batch state | Batch + settlement |

Reconciliation:

- `transaction.refundedAmount = sum(valid refund records)`
- `net commission = positive commission + void/negative adjustments`
- `settlement payable = collected - refunds - fees - commissions + adjustments`

