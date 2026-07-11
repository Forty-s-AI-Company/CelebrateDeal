# QA Release Checklist

## Local and CI

- [x] `npm run security:secrets`
- [x] `npm run ai:validate`
- [x] `npm run db:generate`
- [x] `npm run db:migrate:status`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:coverage`
- [x] `npm run build`
- [x] `npm run preflight`
- [x] `npm run e2e:smoke`
- [x] `npm run e2e:a11y`
- [x] Material UI change has reviewed visual snapshots.
- [x] Lighthouse report meets current accessibility/best-practice floor.

## Security and finance

- [x] No unresolved critical/high security findings after final independent re-review.
- [x] Two-tenant negative tests pass.
- [x] Payment provider/signature/order amount/source are server verified.
- [x] Duplicate/refund/partial refund/out-of-order tests pass.
- [x] Locked settlement and payout audit/rollback evidence exists.
- [x] Secrets and personal/financial data are redacted from artifacts.
- [ ] GitHub secret scanning is enabled; repo regex scan is only a local baseline.

## External required

- [ ] Cloudflare Stream staging.
- [ ] PayUni sandbox.
- [ ] Resend verified domain and receipt.
- [ ] Sentry/PostHog events and alerts.
- [ ] Durable rate limit.
- [ ] Supabase backup/restore and migration.
- [ ] GitHub `staging` environment restricts deployment branches to `master` and requires reviewers.

Release manager must return `READY`, `CONDITIONAL`, or `BLOCKED`; unchecked production-critical external items cannot receive `READY`.

## 2026-07-11 Local Evidence

- PostgreSQL：25 migrations，schema up to date；clean deploy、0630/0655 atomic rollback、legacy refund、missing subscription fail-closed 與 tenant FK drills 通過。
- Secret scan：505 tracked/untracked files passed。
- AI setup：11 agents、9 skills；orchestrator 10 tests passed。
- Unit/integration/API：31 files、169 tests passed；coverage statements 78.92%、branches 67.71%、functions 79.03%、lines 82.88%。
- Coverage：statements 78.60%、branches 67.00%、functions 77.51%、lines 82.68%。
- Build：72 routes passed。
- E2E smoke：13/13，Playwright retries=0。
- Accessibility：7/7，serious/critical axe violations=0。
- Visual：32/32 desktop/laptop/tablet/mobile comparison passed；video 固定 frame 並等待 analytics 完成後清理 fixture。
- Lighthouse login：Performance 0.81、Accessibility 1.00、Best Practices 1.00、SEO 1.00。
- Artifacts：`reports/playwright-html`、`reports/playwright-results`、`reports/lighthouse`。
