# Product Domain Map

| Actor | Primary scope | Must not do |
| --- | --- | --- |
| Platform admin | Platform billing, provider diagnostics, global operations | Impersonate vendor activity without audit |
| Organization owner | Own vendor, members, products, lives, billing views | Read or mutate another vendor |
| Instructor/upline | Authorized courses, lives, products, promoter policy | Change platform settlement rules |
| Promoter/downline | Own referral links and permitted storefront overrides | Set commission after conversion |
| Staff | Explicitly granted operational work | Assume owner/finance access |
| Visitor | Public live/form/product interactions | Access back-office or private analytics |

Core sequence:

`campaign/live -> referral candidate -> visit/click -> lead -> checkout -> provider-paid -> commission -> settlement -> payout`

Refund sequence:

`provider refund -> refund record -> transaction refunded amount -> commission void/negative adjustment -> settlement adjustment -> reconciliation`

External storefront sequence:

`referral context -> promoter product URL if valid -> vendor default URL -> click event -> optional external order evidence`

