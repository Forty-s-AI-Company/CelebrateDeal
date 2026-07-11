# Tenancy Matrix

| Data class | Tenant key | Normal reader | Platform reader | Required negative test |
| --- | --- | --- | --- | --- |
| Product/video/form/live/script/role | `vendorId` | Active member with feature permission | Explicit support/admin path | Other vendor ID cannot read/connect |
| Payment account/transaction/refund | `vendorId` | Owner/admin/accountant, vendor-only view | Platform admin | Other vendor cannot list/export/mutate |
| Settlement/invoice/payout | `vendorId` | Vendor read-only view | Platform admin mutation | Vendor finance role cannot operate globally |
| Affiliate/click/commission | `vendorId` plus affiliate ownership | Authorized vendor role/promoter view | Platform admin | Referral code cannot cross tenant |
| Audit/webhook | platform or vendor scope | Redacted vendor subset only | Platform admin | Payload cannot reveal another tenant/secret |

Use application guards now and plan PostgreSQL RLS as defense in depth. RLS does not replace server authorization or audit.

