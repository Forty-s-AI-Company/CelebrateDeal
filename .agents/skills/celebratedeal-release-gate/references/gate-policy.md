# Release Gate Policy

| Change surface | Mandatory gate |
| --- | --- |
| Any code | lint, typecheck, unit tests, build |
| Prisma/schema | generate, migration deploy/status on disposable PostgreSQL, backup/rollback review |
| Auth/tenant/admin | negative authorization and cross-tenant tests, audit review |
| Payment/refund/commission | signature, duplicate, out-of-order, partial/full refund, reconciliation tests |
| UI/UX | E2E, accessibility, supported viewport screenshots, console/network checks |
| External adapter | fixture tests plus sandbox evidence; production remains External required |
| Release | preflight, secret scan, artifact retention, rollback owner |

Never release with an unresolved critical or high tenant/payment vulnerability.
