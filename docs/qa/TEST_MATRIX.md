# CelebrateDeal Test Matrix

## Test layers

| Layer | 工具 | 目的 | 必要 evidence |
| --- | --- | --- | --- |
| Unit | Vitest | 純函式、簽章、狀態與金額 | Coverage summary |
| Integration/API | Vitest + disposable PostgreSQL | Route/service/transaction/tenant | DB setup/teardown log |
| Security | Vitest/Playwright | 跨租戶、provider、URL、CSRF、rate limit | Negative assertion |
| E2E smoke | Playwright Chromium desktop | 最短可販售路徑 | HTML + trace on failure |
| Responsive | Playwright 1440/1280/768/390 | 版面與流程 | Screenshots |
| Accessibility | axe-core + keyboard | WCAG 2.1 AA 基線 | Violation report |
| Visual | Playwright snapshots | 防止 UI 漂移 | Reviewed baseline/diff |
| Performance | Lighthouse | Login/public live baseline | HTML/JSON report |
| External | Fixture + staging sandbox | Cloudflare/PayUni/Resend/Sentry/PostHog | Timestamped validation report |

## Roles

- Anonymous visitor.
- Vendor owner.
- Vendor staff.
- Vendor accountant/finance read-only.
- Platform admin before and after MFA.
- Affiliate/promoter.

## Data states

- Empty, loading, validation error, unauthorized, provider failure, success, duplicate, expired, refunded, large list.
- Two-vendor fixtures are mandatory for ownership, relation, finance and export tests.

## Viewports

- Desktop 1440x900.
- Laptop 1280x800.
- Tablet 768x1024.
- Mobile 390x844.

## Current priority gaps

1. Unknown/demo payment provider rejection in production.
2. Platform admin vs vendor finance isolation.
3. Vendor-scoped payout/payment account queries.
4. Same-tenant relation connect validation.
5. Safe external URL tests.
6. Unknown order, refund, commission and reconciliation idempotency.

