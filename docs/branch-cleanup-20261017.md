# 分支清理清單（2026-10-17）

基準：`origin/master` = `efb8b7e9`。完整 ref 備份（SHA）見同目錄 `branch-refs-backup-20261017.txt`，刪除後可依 SHA 還原。

| 類別 | 數量 |
|---|---|
| PATCH_EQUIV | 224 |
| MERGED_PR_HEAD | 129 |
| CLOSED_PR_HEAD | 16 |
| NO_PR | 15 |
| ANCESTOR | 13 |
| TREE_EQUIV | 10 |
| LARGE_DIVERGED | 8 |
| AFTER_MERGED_PR | 7 |
| AFTER_CLOSED_PR | 5 |
| OPEN_PR | 2 |

## A. 已整合，可刪除

分支所在 worktree 仍有未提交變更者標 `worktree 有未提交變更`，先保存再刪。

| 範圍 | 分支 | SHA | 判定 | 備註 |
|---|---|---|---|---|
| remote | `codex/a1-native-review-rate-classification-20261010` | 0fdc61fc | commit patch 已在 master |  |
| local | `codex/ab-testing-contract-20260920` | 272b7346 | commit patch 已在 master |  |
| remote | `codex/accessibility-login-isolation-20260920` | 9f899e44 | commit patch 已在 master |  |
| remote | `codex/affiliate-withholding-payout-20261007` | 35cc5086 | PR 已合併且分支停在合併時的 head #380 | worktree 有未提交變更 |
| remote | `codex/agy-claude-stdin-fix-20261006` | cc407020 | commit patch 已在 master |  |
| remote | `codex/ai-team-final-review-policy-20261009` | be5bfd4d | PR 已合併且分支停在合併時的 head #395 |  |
| remote | `codex/announcement-truth-20260926` | a6eaba1e | PR 已合併且分支停在合併時的 head #319 |  |
| remote | `codex/apply-stage-diagnostics-20260925` | c55069b1 | PR 已合併且分支停在合併時的 head #308 |  |
| remote | `codex/auto-affiliate-performance-list-bombmy-parity-retry-b07e0e3b` | 38bbb045 | commit patch 已在 master |  |
| remote | `codex/auto-auto-add-vendor-member-email-invitation-0ce8f8e8` | 79494a34 | PR 已合併且分支停在合併時的 head #86 |  |
| remote | `codex/auto-auto-affiliate-click-paid-order-attribution-f7538669` | 114689cc | PR 已合併且分支停在合併時的 head #131 |  |
| remote | `codex/auto-auto-align-settlement-platform-fee-refunds-087dd8f2` | 0f8f58f8 | commit patch 已在 master |  |
| remote | `codex/auto-auto-block-untracked-checkout-fallback-17dd29e7` | ebdbf2e0 | PR 已合併且分支停在合併時的 head #129 |  |
| remote | `codex/auto-auto-checkout-failure-update-fallback-fc6dd84f` | 39b8dedf | PR 已合併且分支停在合併時的 head #126 |  |
| remote | `codex/auto-auto-checkout-metadata-failure-compensation-5088a79f` | 227c102b | PR 已合併且分支停在合併時的 head #134 |  |
| remote | `codex/auto-auto-checkout-metadata-write-failure-7ce63750` | b92d3e91 | PR 已合併且分支停在合併時的 head #127 |  |
| remote | `codex/auto-auto-checkout-response-no-store-b059af2b` | 1a918f9e | PR 已合併且分支停在合併時的 head #135 |  |
| remote | `codex/auto-auto-checkout-transaction-create-failure-eff9bf94` | 2401481c | PR 已合併且分支停在合併時的 head #128 |  |
| remote | `codex/auto-auto-clarify-team-report-financial-periods-e85fba2a` | 5b91672e | commit patch 已在 master |  |
| remote | `codex/auto-auto-clear-consumed-form-attribution-cookie-0ba12ab0` | 3c7a5c82 | commit patch 已在 master |  |
| remote | `codex/auto-auto-confirm-vendor-member-deactivation-3f8fb123` | 3ace54c1 | PR 已合併且分支停在合併時的 head #120 |  |
| remote | `codex/auto-auto-dedupe-refund-commission-retries-b8852f88` | cd26e31c | commit patch 已在 master |  |
| remote | `codex/auto-auto-detach-live-from-interaction-script-e8ccc0ff` | 638707f9 | PR 已合併且分支停在合併時的 head #122 |  |
| remote | `codex/auto-auto-fix-full-refund-affiliate-adjustments-b93d1f46` | 1897c453 | commit patch 已在 master |  |
| remote | `codex/auto-auto-fix-live-analytics-kpi-window-ef3a2883` | 36b38ad2 | PR 已合併且分支停在合併時的 head #123 |  |
| remote | `codex/auto-auto-guard-late-paid-webhook-commission-32405d2a` | 918b0c87 | commit patch 已在 master |  |
| remote | `codex/auto-auto-handle-password-reset-email-failure-f444b1d2` | 62fb1655 | PR 已合併且分支停在合併時的 head #121 |  |
| remote | `codex/auto-auto-harden-login-rate-limits-367f02af` | fd315e6c | PR 已合併且分支停在合併時的 head #90 |  |
| remote | `codex/auto-auto-hide-retired-billing-plans-fd8e1c24` | d901dcd8 | commit patch 已在 master |  |
| remote | `codex/auto-auto-live-analytics-empty-states-cd25b32d` | 30230f4a | PR 已合併且分支停在合併時的 head #124 |  |
| remote | `codex/auto-auto-live-checkout-failure-feedback-7a44bfcb` | 1ff1b513 | PR 已合併且分支停在合併時的 head #132 |  |
| remote | `codex/auto-auto-make-payout-csv-download-read-only-f041294c` | ea9dc388 | commit patch 已在 master |  |
| remote | `codex/auto-auto-mark-checkout-provider-failures-14cc4e06` | 67b3fffd | PR 已合併且分支停在合併時的 head #125 |  |
| remote | `codex/auto-auto-net-monthly-revenue-after-refunds-6776de67` | 36c25820 | commit patch 已在 master |  |
| remote | `codex/auto-auto-net-platform-fees-after-refunds-8df43b10` | 04c10ff7 | commit patch 已在 master |  |
| remote | `codex/auto-auto-persist-interaction-script-reorder-e2e-ffc4cf00` | 320d63b9 | commit patch 已在 master |  |
| remote | `codex/auto-auto-persist-interaction-timeline-reorder-a2a160eb` | b3a393a0 | commit patch 已在 master |  |
| remote | `codex/auto-auto-persist-lead-attribution-through-checkout-5927e20d` | 101b8402 | commit patch 已在 master |  |
| remote | `codex/auto-auto-preserve-payment-occurrence-on-refund-a5b20cc2` | 60f652fe | commit patch 已在 master |  |
| remote | `codex/auto-auto-prevent-concurrent-manual-refund-overdraw-fd62bbbd` | f43f5be0 | commit patch 已在 master |  |
| remote | `codex/auto-auto-prevent-duplicate-live-checkout-313cb628` | 94e66bdf | PR 已合併且分支停在合併時的 head #130 |  |
| remote | `codex/auto-auto-protect-partner-profile-email-8674ef8a` | 2be8fbb4 | commit patch 已在 master |  |
| remote | `codex/auto-auto-rate-limit-mfa-verification-1cc12a43` | e7abdc17 | commit patch 已在 master |  |
| remote | `codex/auto-auto-rate-limit-password-reset-server-action-a5a9d8df` | 280197db | commit patch 已在 master |  |
| remote | `codex/auto-auto-rate-limit-vendor-member-invitations-eef6dbb2` | 3225b461 | commit patch 已在 master |  |
| remote | `codex/auto-auto-record-team-conversion-attribution-15e880f4` | bb610057 | commit patch 已在 master |  |
| remote | `codex/auto-auto-refresh-member-invitation-after-resend-06339e6d` | 69777162 | commit patch 已在 master |  |
| remote | `codex/auto-auto-refresh-team-funnel-audit-8610acda` | 2b122ece | commit patch 已在 master |  |
| remote | `codex/auto-auto-reject-mismatched-payment-webhook-vendor-identifiers-ebbe8cd3` | 64a6ecd0 | commit patch 已在 master |  |
| remote | `codex/auto-auto-reject-unknown-payment-webhook-provider-bd0fca24` | 57946984 | commit patch 已在 master |  |
| remote | `codex/auto-auto-reject-unscoped-payment-webhooks-87aeb639` | 1be712f4 | commit patch 已在 master |  |
| remote | `codex/auto-auto-remove-vendor-payout-export-button-7ee25ba0` | 2e4166b5 | commit patch 已在 master |  |
| remote | `codex/auto-auto-resend-vendor-member-invitation-0253ef56` | 031b47ac | commit patch 已在 master |  |
| remote | `codex/auto-auto-restrict-payment-webhook-provider-79d0e42f` | f62c7243 | commit patch 已在 master |  |
| remote | `codex/auto-auto-retry-serializable-refund-conflicts-1ed9f441` | 7d78e77e | commit patch 已在 master |  |
| remote | `codex/auto-auto-scope-billing-usage-monthly-transactions-ae8ec7a1` | d17f4191 | commit patch 已在 master |  |
| remote | `codex/auto-auto-scope-billing-usage-record-to-current-month-7a2cfa02` | 031f481b | commit patch 已在 master |  |
| remote | `codex/auto-auto-scope-vendor-payouts-page-9673b0b8` | 365070ae | commit patch 已在 master |  |
| remote | `codex/auto-auto-secure-webhook-order-authority-a2605f45` | acb5b5fa | commit patch 已在 master |  |
| remote | `codex/auto-auto-show-team-attributed-conversions-111fb900` | 01c8db6c | commit patch 已在 master |  |
| remote | `codex/auto-auto-submit-payuni-checkout-form-8b5a4e44` | 90e3a9d7 | commit patch 已在 master |  |
| remote | `codex/auto-auto-team-performance-date-scoped-refunds-c27f8b70` | 912ea80d | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-admin-analytics-smoke-route-00cb84a4` | 1cf2701d | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-admin-cloudflare-ops-routes-a69e2520` | e2e85858 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-admin-ops-email-route-59f4c2a8` | f1eec5b0 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-admin-preflight-route-e504cc9b` | c37c9f80 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-cloudflare-resource-endpoint-auth-1fc52db7` | 3b01efad | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-health-api-route-f45fa790` | 53fe02c4 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-live-stepper-preview-8d4b75c7` | 7f1b3fd2 | PR 已合併且分支停在合併時的 head #118 |  |
| remote | `codex/auto-auto-test-monitoring-smoke-endpoint-97b0f459` | 5762d213 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-password-reset-confirm-route-3ff4807b` | 1a809d1f | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-password-reset-request-route-1f04be46` | 53f2e7f0 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-system-role-library-import-094d9cd7` | 65417af2 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-team-funnel-pages-route-3c1efddb` | da200266 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-team-funnel-partner-profile-route-95d86b41` | 3d378de9 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-team-funnel-product-slots-route-8a450add` | d195a2e7 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-team-funnel-share-claim-route-d7f91e7e` | 1d106f93 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-team-funnel-template-publish-route-d6b3a898` | d9537673 | commit patch 已在 master |  |
| remote | `codex/auto-auto-test-vendor-member-deactivation-399b7b28` | 2cceebba | PR 已合併且分支停在合併時的 head #119 |  |
| remote | `codex/auto-auto-test-webhook-retry-job-route-08292622` | e2a9029b | commit patch 已在 master |  |
| remote | `codex/auto-auto-validate-interaction-script-timestamps-f1ad5709` | 20a9abe0 | commit patch 已在 master |  |
| remote | `codex/auto-auto-validate-manual-refund-fees-a8884f1a` | 07b43774 | commit patch 已在 master |  |
| remote | `codex/auto-auto-validate-manual-refund-remaining-amount-a3fa1a59` | 569a2490 | commit patch 已在 master |  |
| remote | `codex/auto-auto-validate-refund-settlement-month-436c7d85` | 77f24127 | commit patch 已在 master |  |
| remote | `codex/auto-auto-validate-settlement-month-key-1693da3b` | c96c1780 | commit patch 已在 master |  |
| remote | `codex/auto-auto-vendor-invoice-csv-export-841d59b9` | c83d2ebc | commit patch 已在 master |  |
| remote | `codex/auto-auto-verify-checkout-referral-attribution-6b406470` | ded82898 | PR 已合併且分支停在合併時的 head #133 |  |
| remote | `codex/auto-auto-verify-interaction-timeline-drag-drop-e2e-18a9a618` | 5786ed85 | commit patch 已在 master |  |
| remote | `codex/auto-cloudflare-diagnostics-redaction-regressions-a4b40a18` | 3f0eb497 | commit patch 已在 master |  |
| remote | `codex/auto-cloudflare-production-official-signature-d60049d5` | c15be272 | commit patch 已在 master |  |
| remote | `codex/auto-csp-report-only-regressions-9f13a855` | 178a8302 | commit patch 已在 master |  |
| remote | `codex/auto-csp-report-rate-limit-429-regressions-7c770a60` | 2b775029 | commit patch 已在 master |  |
| remote | `codex/auto-dashboard-seven-day-conversion-funnel-138c807a` | 72fa82fa | commit patch 已在 master |  |
| remote | `codex/auto-dashboard-upcoming-live-countdown-24f1b9e8` | 8b740384 | commit patch 已在 master |  |
| remote | `codex/auto-health-database-ok-e2e-regressions-93737079` | e0ae3a39 | commit patch 已在 master |  |
| remote | `codex/auto-job-secret-endpoint-401-regressions-47e6734e` | 06d0bd5a | commit patch 已在 master |  |
| remote | `codex/auto-live-analytics-conversion-funnel-e52533a7` | 8b3a8477 | commit patch 已在 master |  |
| remote | `codex/auto-login-rate-limit-audit-e2e-regressions-e8279702` | 7e019b90 | commit patch 已在 master |  |
| remote | `codex/auto-password-reset-ui-smoke-isolated-email-regressions-cf0963fd` | 541049f5 | commit patch 已在 master |  |
| remote | `codex/auto-payment-webhook-test-fixture-isolation-6a70376d` | cfaffa91 | commit patch 已在 master |  |
| remote | `codex/auto-public-json-origin-guard-regressions-ff8b3f06` | 61fb072e | commit patch 已在 master |  |
| remote | `codex/auto-public-route-rate-limit-429-regressions-b7657b95` | 62f3fea5 | commit patch 已在 master |  |
| remote | `codex/auto-rate-limit-provider-fail-closed-regressions-1a6eed23` | f3685f77 | commit patch 已在 master |  |
| remote | `codex/auto-reconcile-cloudflare-integration-report-67363dbd` | 506068c7 | commit patch 已在 master |  |
| remote | `codex/auto-reconcile-interaction-drag-sort-report-2f84c183` | 851fe73e | commit patch 已在 master |  |
| remote | `codex/auto-reconcile-password-reset-mfa-report-8810c4c0` | e259055e | commit patch 已在 master |  |
| remote | `codex/auto-security-password-reset-smoke-isolation-regressions-f0bef089` | 8f988acd | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-architecture-baseline-30371aa7` | 9ef1b540 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-attribution-registration-ef0c2d52` | 01bab501 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-authorization-scope-cc5772e6` | 94680515 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-browser-e2e-visual-qa-573eca99` | 83ead8f0 | PR 已合併且分支停在合併時的 head #54 |  |
| remote | `codex/auto-team-funnel-completion-audit-f3db1725` | 6759087f | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-domain-model-94474d24` | 8b943327 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-dynamic-field-catalog-8aa1c17e` | 0802d766 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-dynamic-fields-29600e53` | e1ac994c | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-page-template-services-abd771d4` | 3edd225b | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-partner-page-ui-4665c01d` | 536c22bd | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-partner-product-slots-cf93509d` | 08bc2833 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-performance-reporting-8f344c87` | 10acdee8 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-public-page-rendering-68778a80` | 92cb4a4f | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-share-copy-service-d4f832d0` | 0f3aa739 | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-template-management-ui-259d80f4` | 20aaa3fd | commit patch 已在 master |  |
| remote | `codex/auto-team-funnel-template-text-renderer-208103e5` | e6df2099 | commit patch 已在 master |  |
| remote | `codex/auto-webhook-retry-worker-regressions-27e3474f` | b9747621 | commit patch 已在 master |  |
| remote | `codex/canonical-domain-workflows-20261007` | 9518bc61 | commit patch 已在 master |  |
| local | `codex/checkout-pending-replay-20260924` | 91933268 | commit patch 已在 master |  |
| remote | `codex/commission-main-integration-20261007` | d5160bf6 | PR 已合併且分支停在合併時的 head #386 |  |
| local | `codex/consultation-actions-contract-20260920` | 71a4d4ad | commit patch 已在 master |  |
| local | `codex/consultation-actions-integration` | 638b7bec | master 的祖先 | worktree 有未提交變更 |
| local | `codex/consultation-automation-contract-20260920` | 3adb8d74 | 分支改過的每個檔案與 master 相同 |  |
| local | `codex/consultation-automation-schema-20260920` | a22fb6a1 | PR 已合併且分支停在合併時的 head #235 |  |
| local | `codex/consultation-core-contract-20260920` | 6e9fc31a | PR 已合併且分支停在合併時的 head #233 |  |
| local | `codex/consultation-ui-adapter-20260920` | c7c74b8e | commit patch 已在 master |  |
| remote | `codex/core-ready-20260926b` | d48b9d6d | commit patch 已在 master |  |
| remote | `codex/core-ready-status-20260926` | 3185d23f | PR 已合併且分支停在合併時的 head #339 |  |
| remote | `codex/core-staging-acceptance-20260925` | d8bb7ff5 | commit patch 已在 master |  |
| remote | `codex/core-staging-integration-20260925` | 5b742338 | PR 已合併且分支停在合併時的 head #304 |  |
| remote | `codex/core-staging-remaining-20260929` | 26a4c888 | commit patch 已在 master |  |
| local | `codex/current-exact-staging-backup-gate-20260925` | 91933268 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/current-provider-probe-20260925` | e59d4239 | commit patch 已在 master |  |
| local | `codex/current-source-evidence-20260903` | 1806f4b8 | master 的祖先 | worktree 有未提交變更 |
| remote | `codex/current-staging-status-20260925` | 2b934cb2 | PR 已合併且分支停在合併時的 head #314 |  |
| remote | `codex/dashboard-details-client-20260927` | bcc4d161 | PR 已合併且分支停在合併時的 head #340 |  |
| remote | `codex/dashboard-details-latency-20260926` | 5fa001fe | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/dashboard-kpi-bounded-reads-20260927` | c0b681a6 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/dashboard-stream-diagnostic-20260926` | ef3dd7da | commit patch 已在 master |  |
| local | `codex/electronic-invoice-20260922` | 4c87dc4e | PR 已合併且分支停在合併時的 head #260 |  |
| local | `codex/evergreen-domain-20260919` | 7a19cc77 | PR 已合併且分支停在合併時的 head #224 |  |
| remote | `codex/evergreen-webinar-settings` | 4dd249d7 | commit patch 已在 master |  |
| remote | `codex/f2-buyer-preflight-20261011` | 3bbd0ff3 | commit patch 已在 master |  |
| remote | `codex/f2-current-proof-capability-20261011` | 0635cece | PR 已合併且分支停在合併時的 head #418 |  |
| remote | `codex/f2-issued-pending-state-20261011` | a7497528 | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/f2-preflight-diagnosis-20261011` | b01c20d2 | commit patch 已在 master |  |
| local | `codex/funnel-automation-settings-20260921` | e0f45f15 | PR 已合併且分支停在合併時的 head #255 |  |
| local | `codex/funnel-automation-vertical-slice-20260921` | b941e1f1 | commit patch 已在 master |  |
| local | `codex/funnel-automation-voucher-20260921` | 95c55f35 | PR 已合併且分支停在合併時的 head #256 |  |
| local | `codex/funnel-browser-gate-20260919` | f770e2b5 | master 的祖先 |  |
| remote | `codex/funnel-browser-gate-20260922` | 117e2231 | commit patch 已在 master |  |
| remote | `codex/funnel-browser-harness-20260920` | 2efcd44c | PR 已合併且分支停在合併時的 head #241 | worktree 有未提交變更 |
| local | `codex/funnel-browser-harness-20260920` | 0390c5ce | master 的祖先 | worktree 有未提交變更 |
| remote | `codex/funnel-commerce-order-bump` | bc7efc04 | PR 已合併且分支停在合併時的 head #269 |  |
| local | `codex/funnel-commerce-service-20260921` | 28159132 | commit patch 已在 master |  |
| local | `codex/funnel-create-20260921` | 435aaaf1 | commit patch 已在 master |  |
| local | `codex/funnel-crm-manual-voucher-20260921` | 261f3456 | commit patch 已在 master |  |
| local | `codex/funnel-domain-contracts-20260920` | 059cf575 | PR 已合併且分支停在合併時的 head #244 |  |
| local | `codex/funnel-domain-foundation-20260920` | 5e0984a9 | PR 已合併且分支停在合併時的 head #243 |  |
| local | `codex/funnel-editor-data-20260921` | c3c2f868 | commit patch 已在 master |  |
| remote | `codex/funnel-editor-navigation-diagnostic-20260928` | c76d43ed | PR 已合併且分支停在合併時的 head #341 |  |
| local | `codex/funnel-editor-ui-20260921` | b754ecce | PR 已合併且分支停在合併時的 head #251 |  |
| local | `codex/funnel-goals-qa` | afc1152f | commit patch 已在 master |  |
| local | `codex/funnel-landing-actions-20260921` | d8cb0207 | commit patch 已在 master |  |
| local | `codex/funnel-management-list-20260921` | 39339fbe | PR 已合併且分支停在合併時的 head #246 |  |
| local | `codex/funnel-operations-20260920` | 2069f827 | master 的祖先 |  |
| remote | `codex/funnel-operations-docs-20260922` | c8e6b79d | commit patch 已在 master |  |
| local | `codex/funnel-operations-editor-20260921` | c159f463 | commit patch 已在 master |  |
| remote | `codex/funnel-operations-lazy-reports-20260927` | 2759b214 | PR 已合併且分支停在合併時的 head #338 | worktree 有未提交變更 |
| local | `codex/funnel-operations-qa` | 2c8da6f3 | PR 已合併且分支停在合併時的 head #265 |  |
| remote | `codex/funnel-operations-single-scope-20260927` | 5a65ff91 | commit patch 已在 master | worktree 有未提交變更 |
| local | `codex/funnel-operations-ui-20260920` | 5cd7a9fe | PR 已合併且分支停在合併時的 head #245 |  |
| local | `codex/funnel-public-checkout-20260921` | aef27cb2 | commit patch 已在 master |  |
| remote | `codex/funnel-public-render-diagnostic-20260928` | 1731795f | commit patch 已在 master |  |
| local | `codex/funnel-public-runtime-20260921` | 36f6dce9 | PR 已合併且分支停在合併時的 head #253 |  |
| remote | `codex/funnel-renderer-runtime-20260920` | c96788bb | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/integrate-browser-isolation-20261005` | e3b25074 | PR 已合併且分支停在合併時的 head #365 |  |
| remote | `codex/integrate-final-dispositions-20261005` | df417519 | commit patch 已在 master |  |
| remote | `codex/integrate-funnel-recovery-20261004` | 24d9c7c7 | PR 已合併且分支停在合併時的 head #355 |  |
| remote | `codex/integrate-line-menu-drafts-20261004` | 23fcae98 | PR 已合併且分支停在合併時的 head #354 |  |
| remote | `codex/integrate-original-auth-smoke-20261005` | 1184c122 | PR 已合併且分支停在合併時的 head #359 |  |
| remote | `codex/integrate-original-funnel-boundaries-20261005` | 0eec941b | PR 已合併且分支停在合併時的 head #364 |  |
| remote | `codex/integrate-original-live-interactions-20261005` | 202cafcd | PR 已合併且分支停在合併時的 head #363 |  |
| remote | `codex/integrate-original-mfa-ui-20261005` | ea576e1a | PR 已合併且分支停在合併時的 head #362 |  |
| remote | `codex/integrate-original-onboarding-20261005` | 25e6827c | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/integrate-original-routing-20261005` | a139b9d9 | PR 已合併且分支停在合併時的 head #358 |  |
| remote | `codex/integrate-original-shell-20261005` | bb220731 | PR 已合併且分支停在合併時的 head #360 |  |
| remote | `codex/integrate-remaining-funnel-20261005` | 64878308 | PR 已合併且分支停在合併時的 head #367 |  |
| local | `codex/interaction-card-runtime-20260919` | 228170bb | PR 已合併且分支停在合併時的 head #226 |  |
| local | `codex/interaction-card-timeline-20260919` | 0aa714e1 | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/isolate-mfa-test-env` | e3d276de | commit patch 已在 master |  |
| local | `codex/landing-page-qa` | 7c89ef29 | commit patch 已在 master |  |
| remote | `codex/launch-final-handoff-20260924` | 1b2053ea | commit patch 已在 master |  |
| remote | `codex/launch-handoff-20260924` | 05c45e57 | commit patch 已在 master |  |
| remote | `codex/launch-integration-20260924` | 235b496a | PR 已合併且分支停在合併時的 head #274 |  |
| remote | `codex/launch-receipts-20260928` | 92ed6b70 | PR 已合併且分支停在合併時的 head #342 |  |
| remote | `codex/line-oa-delivery-report` | 5b9d599d | commit patch 已在 master |  |
| remote | `codex/line-oa-notification-closure` | 992e9450 | PR 已合併且分支停在合併時的 head #203 |  |
| remote | `codex/line-receipt-path-fix` | 7c30ac74 | commit patch 已在 master |  |
| remote | `codex/line-receipt-validation-fix` | 52730692 | PR 已合併且分支停在合併時的 head #205 |  |
| remote | `codex/line-runner-binding-diagnostic` | c14160e7 | commit patch 已在 master |  |
| remote | `codex/line-runner-stage-diagnostic` | 3cf0c7b4 | commit patch 已在 master |  |
| remote | `codex/live-admission-retry-backoff` | 74c61991 | commit patch 已在 master |  |
| remote | `codex/live-interaction-analytics` | 4f697b30 | PR 已合併且分支停在合併時的 head #271 |  |
| local | `codex/live-interaction-contracts-20260919` | d541ba29 | commit patch 已在 master |  |
| local | `codex/live-interaction-runtime-20260919` | 4082fc0d | PR 已合併且分支停在合併時的 head #225 |  |
| local | `codex/live-interaction-schema-20260919` | 95e3e786 | PR 已合併且分支停在合併時的 head #222 |  |
| local | `codex/live-media-contract-20260920` | 653c8292 | commit patch 已在 master |  |
| remote | `codex/live-private-chat-purchase-broadcast-20261007` | f92e2d11 | PR 已合併且分支停在合併時的 head #381 | worktree 有未提交變更 |
| local | `codex/live-question-domain-20260919` | 5e083c2c | commit patch 已在 master |  |
| remote | `codex/master-receipt-counters-20260918` | 9c2f5663 | PR 已合併且分支停在合併時的 head #212 |  |
| local | `codex/mobile-consultation-cockpit-20260920` | d66343c5 | commit patch 已在 master |  |
| remote | `codex/mvp-payuni-e2e-20260903` | a9748571 | commit patch 已在 master |  |
| local | `codex/next-diff-audit-20260922` | 947c03f2 | master 的祖先 |  |
| remote | `codex/nonproduction-recovery-ops-20261006` | 3d32b0a0 | PR 已合併且分支停在合併時的 head #379 | worktree 有未提交變更 |
| local | `codex/one-stop-diff-audit` | 154a4908 | master 的祖先 |  |
| remote | `codex/payuni-callback-amount-validation-20260925` | 1893edb4 | PR 已合併且分支停在合併時的 head #296 | worktree 有未提交變更 |
| remote | `codex/payuni-first-webhook-event-race-20260925` | 6dcf882d | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/payuni-preview-return-origin` | 0616beaa | commit patch 已在 master |  |
| remote | `codex/payuni-reference-classification-20260927` | 47742546 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/payuni-webhook-transaction-timeout` | 259083f1 | commit patch 已在 master |  |
| remote | `codex/portal-localization-pwa-20261006` | 489d4ae1 | PR 已合併且分支停在合併時的 head #375 | worktree 有未提交變更 |
| local | `codex/postpurchase-upsell-20260921` | 1678c4ce | PR 已合併且分支停在合併時的 head #258 |  |
| remote | `codex/prelaunch-engineering-20260929` | ff9f4467 | PR 已合併且分支停在合併時的 head #351 |  |
| local | `codex/presenter-browser-live-20260922` | 1a486915 | PR 已合併且分支停在合併時的 head #262 |  |
| remote | `codex/provider-presence-20260925` | 7026b476 | commit patch 已在 master |  |
| local | `codex/provider-presence-20260925` | 20d354db | commit patch 已在 master |  |
| remote | `codex/q1-callback-rejection-diagnosis-20261010` | 6da02765 | commit patch 已在 master |  |
| remote | `codex/q1-diagnostic-failure-receipt-20261010` | f8f937fb | commit patch 已在 master |  |
| remote | `codex/q1-exact-callback-state-20261010` | 7b6dac2e | commit patch 已在 master |  |
| remote | `codex/q1-exact-provider-state-20261010` | c6512848 | PR 已合併且分支停在合併時的 head #402 |  |
| remote | `codex/q1-exact-state-details-20261010` | e2c9ffff | PR 已合併且分支停在合併時的 head #401 |  |
| remote | `codex/q1-finance-redirect-dom-20261010` | aa2c3b3d | PR 已合併且分支停在合併時的 head #397 |  |
| remote | `codex/q1-fixed-state-diagnostic-20261010` | 87811d85 | PR 已合併且分支停在合併時的 head #398 |  |
| remote | `codex/q1-merchant-schema-rollout-20261010` | 54de3d50 | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/q1-original-callback-runner-20261010` | 4e7084e4 | PR 已合併且分支停在合併時的 head #405 |  |
| remote | `codex/q1-original-refund-proof-20261011` | a76330b5 | PR 已合併且分支停在合併時的 head #414 |  |
| remote | `codex/q1-original-refund-query-diagnostic-20261011` | 18c9b45d | commit patch 已在 master |  |
| remote | `codex/q1-original-refund-runner-20261011` | 0a705406 | PR 已合併且分支停在合併時的 head #415 |  |
| remote | `codex/q1-original-unrefunded-contract-20261011` | 6ec7bf35 | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/q1-processing-preconditions-20261010` | 322997b6 | commit patch 已在 master |  |
| remote | `codex/q1-processing-schema-diagnosis-20261010` | aabda237 | commit patch 已在 master |  |
| remote | `codex/q1-protected-runner-bootstrap-20261009` | beaacbb0 | PR 已合併且分支停在合併時的 head #394 |  |
| remote | `codex/q1-readonly-runtime-preflight-20261010` | 2a73a3c3 | commit patch 已在 master |  |
| remote | `codex/q1-remaining-budget-runner-20261010` | 313763e6 | commit patch 已在 master |  |
| remote | `codex/q1-retry-audit-classification-20261010` | a2130dcc | PR 已合併且分支停在合併時的 head #409 |  |
| remote | `codex/q1-safe-failure-classification-20261010` | 7ca31677 | PR 已合併且分支停在合併時的 head #411 |  |
| remote | `codex/q1-schema-recovery-runner-20261011` | 0b521b1f | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/recover-funnel-tests-20261004` | e4d726fd | PR 已合併且分支停在合併時的 head #352 |  |
| remote | `codex/recover-staging-provider-binding-20261004` | 936e7124 | PR 已合併且分支停在合併時的 head #356 |  |
| remote | `codex/recover-student-portal-20261004` | a214d277 | PR 已合併且分支停在合併時的 head #357 |  |
| remote | `codex/referral-share-cards-20261008` | 85fe9988 | PR 已合併且分支停在合併時的 head #385 | worktree 有未提交變更 |
| remote | `codex/refund-qa-exact-transaction-20261006` | 360b2a8c | PR 已合併且分支停在合併時的 head #371 |  |
| remote | `codex/remaining-affiliate-portal-20261006` | ff9ea278 | PR 已合併且分支停在合併時的 head #374 |  |
| remote | `codex/remaining-capabilities-20261005` | 00d43f48 | commit patch 已在 master |  |
| remote | `codex/remaining-course-learning-20261006` | 84cdb475 | PR 已合併且分支停在合併時的 head #370 |  |
| remote | `codex/remaining-student-community-20261006` | 5db558da | PR 已合併且分支停在合併時的 head #373 | worktree 有未提交變更 |
| remote | `codex/sandbox-order-readonly-20260928` | ece12542 | commit patch 已在 master |  |
| remote | `codex/sandbox-payment-only-20260928` | 35a10e40 | PR 已合併且分支停在合併時的 head #347 | worktree 有未提交變更 |
| local | `codex/schema-project-index-contract-20260920` | 5239a033 | commit patch 已在 master |  |
| local | `codex/scripted-roles-contract-20260920` | 16fcc2dc | commit patch 已在 master |  |
| remote | `codex/sharp-security-patch-20261007` | 85aa6e43 | PR 已合併且分支停在合併時的 head #378 |  |
| remote | `codex/source-map-security-patch-20261006` | 17a3c632 | commit patch 已在 master |  |
| remote | `codex/staging-additive-migration-20260925` | 66ac5305 | commit patch 已在 master |  |
| remote | `codex/staging-alias-diagnostics-20260925` | fecab1bb | PR 已合併且分支停在合併時的 head #312 |  |
| remote | `codex/staging-backup-migration-gate-20260925` | 5dcde0f0 | commit patch 已在 master |  |
| remote | `codex/staging-blocker-handoff-20260928` | a92148d4 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/staging-browser-phase-diagnostic-20260926` | 8ffb698d | PR 已合併且分支停在合併時的 head #317 |  |
| remote | `codex/staging-browser-smoke-20260925` | bc5cefa0 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/staging-current-20260926` | aa8f35bb | PR 已合併且分支停在合併時的 head #322 |  |
| remote | `codex/staging-current-followup-20260925` | a9e83081 | PR 已合併且分支停在合併時的 head #295 |  |
| remote | `codex/staging-current-payment-followup-20260925` | af736f82 | PR 已合併且分支停在合併時的 head #298 |  |
| remote | `codex/staging-current-pr299-20260925` | 4b65e0f6 | PR 已合併且分支停在合併時的 head #300 |  |
| remote | `codex/staging-current-truth-20260925` | d1bc4009 | commit patch 已在 master |  |
| remote | `codex/staging-db-identity-diagnostics-20260925` | 8c0d2f97 | commit patch 已在 master |  |
| remote | `codex/staging-db-query-classification-20260925` | e2df9d87 | commit patch 已在 master |  |
| remote | `codex/staging-db-safe-query-hints-20260925` | da30b528 | commit patch 已在 master |  |
| remote | `codex/staging-diagnostic-source-fetch-20260925` | 0ccd6a01 | commit patch 已在 master |  |
| remote | `codex/staging-encrypted-recovery-drill-20260925` | 92a34031 | PR 已合併且分支停在合併時的 head #290 |  |
| remote | `codex/staging-encrypted-retained-backup-20260925` | 8c051294 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/staging-evidence-handoff-20260925` | b54827a1 | PR 已合併且分支停在合併時的 head #286 |  |
| remote | `codex/staging-fixture-diagnostics-20260925` | 067a2872 | PR 已合併且分支停在合併時的 head #280 |  |
| remote | `codex/staging-funnel-create-feedback-20260927` | 9bb5d629 | commit patch 已在 master |  |
| remote | `codex/staging-funnel-diagnostic-20260927` | b038db39 | commit patch 已在 master |  |
| remote | `codex/staging-funnel-navigation-diagnostic-20260927` | f1055720 | PR 已合併且分支停在合併時的 head #335 | worktree 有未提交變更 |
| remote | `codex/staging-funnel-smoke-20260926` | 04c5bbca | PR 已合併且分支停在合併時的 head #329 |  |
| local | `codex/staging-isolated-migration-drill-20260925` | d1fbc07e | commit patch 已在 master |  |
| remote | `codex/staging-isolated-restore-aggregate-20260925` | 06a2af1f | commit patch 已在 master |  |
| remote | `codex/staging-live-receipts-20260928` | d334f726 | PR 已合併且分支停在合併時的 head #348 |  |
| remote | `codex/staging-migration-compat-preflight-20260925` | c68a3228 | PR 已合併且分支停在合併時的 head #292 |  |
| remote | `codex/staging-migration-recovery-20260925` | f55417ae | PR 已合併且分支停在合併時的 head #283 |  |
| remote | `codex/staging-migration-rollback-history-20260925` | 3b70af02 | commit patch 已在 master |  |
| remote | `codex/staging-payuni-binding-attestation-20260925` | 50d6c8d9 | commit patch 已在 master |  |
| remote | `codex/staging-preview-cutover-20260928` | bfb7fc48 | commit patch 已在 master |  |
| local | `codex/staging-provider-binding-attestation-20260925` | 86056007 | 分支改過的每個檔案與 master 相同 |  |
| remote | `codex/staging-r2-image-check-20260926` | 455dcd26 | PR 已合併且分支停在合併時的 head #326 |  |
| remote | `codex/staging-r2-image-diagnostic-20260926` | 6267ecc1 | commit patch 已在 master |  |
| remote | `codex/staging-r2-image-external-read-20260927` | c59cbf06 | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/staging-release-20260928` | 5d5b8146 | master 的祖先 |  |
| remote | `codex/staging-smoke-announcer-20260926` | d21050c4 | commit patch 已在 master |  |
| remote | `codex/staging-source-handoff-20260926` | f7c28344 | commit patch 已在 master |  |
| remote | `codex/staging-status-20260926` | ec43e3f5 | commit patch 已在 master |  |
| remote | `codex/staging-stream-receipt-20260929` | 50125f2f | commit patch 已在 master |  |
| local | `codex/staging-validation-diagnostics-20260925` | 2b095e27 | master 的祖先 | worktree 有未提交變更 |
| local | `codex/student-portal-action-state-20260920` | 6e6e87f6 | commit patch 已在 master |  |
| remote | `codex/team-video-delivery-20261007` | 1dd0409c | 分支改過的每個檔案與 master 相同 |  |
| local | `codex/vendor-feature-toggles-20260922` | b38b047b | PR 已合併且分支停在合併時的 head #261 |  |
| local | `codex/webinar-funnel-qa` | e21c7fc9 | PR 已合併且分支停在合併時的 head #268 |  |
| remote | `codex/wp2-db-failure-classification` | 74e55f89 | commit patch 已在 master |  |
| remote | `codex/wp2-pooler-readonly` | f82adc4c | commit patch 已在 master |  |
| remote | `codex/wp2-receipt-preservation` | b9468346 | commit patch 已在 master |  |
| remote | `codex/wp2-restore-extension-placement` | 146f8db0 | PR 已合併且分支停在合併時的 head #145 |  |
| remote | `codex/wp2-squash-lineage` | 2be14ad2 | commit patch 已在 master |  |
| remote | `codex/wp4-binding-annotation-20260903` | f902d24a | commit patch 已在 master |  |
| remote | `codex/wp4-binding-preflight-20260903` | 1745f92e | commit patch 已在 master |  |
| remote | `codex/wp4-browser-network-diagnostic-20260903` | c457a7c4 | commit patch 已在 master |  |
| remote | `codex/wp4-buyer-callback-retry` | f9e2f870 | commit patch 已在 master |  |
| remote | `codex/wp4-buyer-existing-continuation` | c3bc84c7 | commit patch 已在 master |  |
| remote | `codex/wp4-buyer-payment-check` | cfdc9f3d | PR 已合併且分支停在合併時的 head #200 |  |
| remote | `codex/wp4-buyer-status-20260926` | 4b6798f6 | PR 已合併且分支停在合併時的 head #325 |  |
| remote | `codex/wp4-callback-proof-20260903` | 0b38bfeb | commit patch 已在 master |  |
| remote | `codex/wp4-current-preview-recovery` | ec49b0ea | PR 已合併且分支停在合併時的 head #195 |  |
| remote | `codex/wp4-eventual-refund-reconcile` | b7bfc488 | commit patch 已在 master |  |
| remote | `codex/wp4-eventual-refund-reconcile-clean` | 70a1d83f | commit patch 已在 master |  |
| remote | `codex/wp4-exact-preview-004ac887` | a1ffc4a9 | PR 已合併且分支停在合併時的 head #154 |  |
| remote | `codex/wp4-exact-preview-800746c` | 800746cb | master 的祖先 |  |
| remote | `codex/wp4-executor-enabled-preview` | 3f6f230d | PR 已合併且分支停在合併時的 head #152 |  |
| remote | `codex/wp4-existing-refund-recovery` | fea1e5ff | commit patch 已在 master |  |
| remote | `codex/wp4-fixed-executor-v3` | e1105745 | PR 已合併且分支停在合併時的 head #162 |  |
| remote | `codex/wp4-fixture-count-20260925` | fa736840 | commit patch 已在 master |  |
| remote | `codex/wp4-fixture-diagnostic-20260925` | 80d90504 | commit patch 已在 master |  |
| remote | `codex/wp4-fixture-root-cause-20260903` | f31ee23b | commit patch 已在 master |  |
| remote | `codex/wp4-http-diagnostic-20260925` | ff97a2bd | commit patch 已在 master |  |
| remote | `codex/wp4-lineage-candidate-fix-20260903` | caa26450 | commit patch 已在 master |  |
| remote | `codex/wp4-lineage-status-url-fix` | e18e15ef | commit patch 已在 master |  |
| remote | `codex/wp4-master-979ff07` | 979ff079 | master 的祖先 |  |
| remote | `codex/wp4-master-exact-preview` | 065fb82b | PR 已合併且分支停在合併時的 head #153 |  |
| remote | `codex/wp4-network-error-classification-20260903` | ec980b7f | commit patch 已在 master |  |
| remote | `codex/wp4-payment-page-host-20260903` | 29d7be61 | commit patch 已在 master |  |
| remote | `codex/wp4-payuni-browser-stage-20260903` | 500f4477 | PR 已合併且分支停在合併時的 head #171 |  |
| remote | `codex/wp4-payuni-navigation-classifier-20260903` | 6666a4d2 | commit patch 已在 master |  |
| remote | `codex/wp4-payuni-navigation-commit-20260903` | d25214e4 | commit patch 已在 master |  |
| remote | `codex/wp4-payuni-navigation-race-20260903` | 2e21f109 | PR 已合併且分支停在合併時的 head #172 |  |
| remote | `codex/wp4-payuni-navigation-response` | e7c139e8 | commit patch 已在 master |  |
| remote | `codex/wp4-payuni-network-cause-20260903` | edae9d63 | commit patch 已在 master |  |
| remote | `codex/wp4-payuni-scheduled-submit-20260903` | bf0f85bd | commit patch 已在 master |  |
| local | `codex/wp4-payuni-secure-runner` | 20bc8973 | master 的祖先 | worktree 有未提交變更 |
| local | `codex/wp4-payuni-secure-runner-20260903` | 20bc8973 | master 的祖先 |  |
| remote | `codex/wp4-payuni-success-card-20260903` | dbc34001 | commit patch 已在 master |  |
| remote | `codex/wp4-payuni-vendor-egress-20260903` | 0974dcb6 | commit patch 已在 master |  |
| remote | `codex/wp4-pin-chromium-payuni-egress-20260903` | 7d162a65 | PR 已合併且分支停在合併時的 head #179 |  |
| remote | `codex/wp4-preserve-payuni-dns-order-20260903` | 2fe1911f | commit patch 已在 master |  |
| remote | `codex/wp4-receipt-remediation-20260903` | c1bcc0b5 | PR 已合併且分支停在合併時的 head #163 |  |
| remote | `codex/wp4-reconciliation-fallback` | 34133663 | commit patch 已在 master |  |
| remote | `codex/wp4-recovery-database-diagnostics` | 0d862d95 | commit patch 已在 master |  |
| remote | `codex/wp4-recovery-local-classification` | ba69689e | commit patch 已在 master |  |
| remote | `codex/wp4-recovery-transaction-stage` | b8180304 | commit patch 已在 master |  |
| remote | `codex/wp4-refund-projection-window` | 1052a46d | commit patch 已在 master |  |
| remote | `codex/wp4-refund-rejection-recovery` | 88084d04 | commit patch 已在 master |  |
| remote | `codex/wp4-reservation-diagnostic-20260903` | 2540d245 | commit patch 已在 master |  |
| remote | `codex/wp4-sandbox-executor-master` | aecd0d18 | PR 已合併且分支停在合併時的 head #156 |  |
| remote | `codex/wp4-sandbox-executor-v2` | 46a9e36c | PR 已合併且分支停在合併時的 head #159 |  |
| remote | `codex/wp4-secure-runner` | 7b320ff0 | PR 已合併且分支停在合併時的 head #157 |  |
| remote | `codex/wp4-secure-runner-cbae30af` | cf33299a | commit patch 已在 master | worktree 有未提交變更 |
| remote | `codex/wp4-secure-runner-executor` | 6ef0908b | commit patch 已在 master |  |
| remote | `codex/wp4-secure-runner-master` | 73825fad | PR 已合併且分支停在合併時的 head #146 |  |
| remote | `codex/wp4-source-bound-checkout` | 23fdee6d | PR 已合併且分支停在合併時的 head #161 |  |
| remote | `codex/wp4-subscription-runner` | 93b4db2c | PR 已合併且分支停在合併時的 head #196 |  |
| remote | `codex/wp4-whole-twd-refund` | 0d58cefd | commit patch 已在 master |  |

## B. 尚未整合，需逐一審查

| 範圍 | 分支 | SHA | 判定 | 領先 | 落後 | 最後 commit |
|---|---|---|---|---|---|---|
| local | `codex/payuni-success-idempotency-20260925` | 2c419848 | AFTER_CLOSED_PR | 5 | 110 | 2026-09-25 |
| local | `codex/staging-apply-gate-v2-20260925` | 708a8d77 | AFTER_CLOSED_PR | 3 | 110 | 2026-09-25 |
| local | `codex/staging-browser-flow-20260925` | 0f44aea7 | AFTER_CLOSED_PR | 4 | 110 | 2026-09-25 |
| local | `codex/staging-runtime-provider-probe-20260925` | 7dba71b8 | AFTER_CLOSED_PR | 5 | 110 | 2026-09-25 |
| local | `codex/payuni-production-query-hard-blocker` | abc55736 | AFTER_CLOSED_PR | 1 | 224 | 2026-09-03 |
| remote | `codex/editor-advanced-interactions-20261006` | fc6f9582 | AFTER_MERGED_PR | 14 | 42 | 2026-10-07 |
| local | `codex/canonical-domain-workflows-20261007` | ae88c13f | AFTER_MERGED_PR | 2 | 39 | 2026-10-07 |
| local | `codex/nonproduction-recovery-ops-20261006` | fb9cbd1b | AFTER_MERGED_PR | 24 | 40 | 2026-10-07 |
| local | `codex/team-video-delivery-20261007` | 58d9cd1a | AFTER_MERGED_PR | 17 | 41 | 2026-10-07 |
| local | `codex/staging-migration-compat-preflight-20260925` | 4c44431c | AFTER_MERGED_PR | 2 | 118 | 2026-09-25 |
| local | `codex/wp4-lineage-candidate-fix-20260903` | cd3571dd | AFTER_MERGED_PR | 2 | 234 | 2026-09-03 |
| local | `codex/wp4-receipt-remediation-20260903` | c06fdd1e | AFTER_MERGED_PR | 1 | 237 | 2026-09-03 |
| remote | `ai-team/isolated-write-smoke-20260712-0405` | d8c85fbb | CLOSED_PR_HEAD#1 | 3 | 395 | 2026-07-12 |
| remote | `codex/auto-live-stepper-grounded-preview-63bea109` | f5512bf0 | CLOSED_PR_HEAD#13 | 1 | 371 | 2026-07-15 |
| remote | `codex/payuni-production-query-hard-blocker` | 177554e1 | CLOSED_PR_HEAD#177 | 3 | 222 | 2026-09-03 |
| remote | `codex/master-dependency-audit-20260918` | 7f07a5f6 | CLOSED_PR_HEAD#213 | 6 | 192 | 2026-09-18 |
| local | `codex/consultation-deps-integration` | 429bc93d | CLOSED_PR_HEAD#234 | 1 | 172 | 2026-09-20 |
| remote | `codex/staging-backup-gate-20260925` | f669d5b5 | CLOSED_PR_HEAD#284 | 1 | 124 | 2026-09-25 |
| remote | `codex/staging-browser-diagnostic-20260925` | 0b10ff68 | CLOSED_PR_HEAD#285 | 1 | 124 | 2026-09-25 |
| remote | `codex/staging-apply-gate-v2-20260925` | b447582b | CLOSED_PR_HEAD#299 | 4 | 109 | 2026-09-25 |
| remote | `codex/staging-runtime-provider-probe-20260925` | 6c25a938 | CLOSED_PR_HEAD#301 | 6 | 109 | 2026-09-25 |
| remote | `codex/staging-browser-flow-20260925` | 3e6bf78b | CLOSED_PR_HEAD#302 | 5 | 109 | 2026-09-25 |
| remote | `codex/payuni-success-idempotency-20260925` | 6d63dd97 | CLOSED_PR_HEAD#303 | 6 | 109 | 2026-09-25 |
| remote | `codex/staging-observability-20260926` | 4fac5493 | CLOSED_PR_HEAD#320 | 1 | 94 | 2026-09-26 |
| remote | `codex/recover-live-preview-20261004` | 49e884ff | CLOSED_PR_HEAD#353 | 39 | 63 | 2026-10-04 |
| remote | `codex/integrate-direct-url-load-20261005` | 9af80668 | CLOSED_PR_HEAD#366 | 94 | 51 | 2026-10-05 |
| remote | `codex/f2-protected-recovery-runner-20261009` | 8655efcb | CLOSED_PR_HEAD#391 | 6 | 25 | 2026-10-10 |
| remote | `codex/claude-review-terminal-classification-20261010` | dd1e1ecd | CLOSED_PR_HEAD#396 | 2 | 25 | 2026-10-10 |
| local | `codex/one-stop-webinar-flow` | ca527734 | LARGE_DIVERGED | 556 | 263 | 2026-10-17 |
| remote | `codex/one-stop-webinar-flow` | b7956d80 | LARGE_DIVERGED | 554 | 263 | 2026-09-19 |
| local | `codex/master-integration-sync-20260918` | 60132971 | LARGE_DIVERGED | 553 | 263 | 2026-09-18 |
| local | `codex/staging-migration-apply-gate` | 60132971 | LARGE_DIVERGED | 553 | 263 | 2026-09-18 |
| remote | `codex/funnel-goal3-only` | b5397dbb | LARGE_DIVERGED | 532 | 263 | 2026-09-17 |
| local | `codex/pr210-secret-scan-fix` | e1f38be3 | LARGE_DIVERGED | 484 | 263 | 2026-09-17 |
| local | `codex/wp4-receipt-fix-20260903` | eac0a343 | LARGE_DIVERGED | 342 | 263 | 2026-09-01 |
| remote | `chore/ai-team-v5.1-migration` | 937f796d | LARGE_DIVERGED | 191 | 263 | 2026-08-15 |
| local | `codex/post-purchase-commerce-20261007` | cb21db70 | NO_PR | 26 | 31 | 2026-10-11 |
| remote | `codex/post-purchase-commerce-20261007` | 1300f62d | NO_PR | 25 | 31 | 2026-10-09 |
| remote | `codex/learner-notifications-20261007` | 75b57e4d | NO_PR | 34 | 32 | 2026-10-08 |
| remote | `codex/remaining-affiliate-commission-policy-20261006` | f3e65b97 | NO_PR | 2 | 44 | 2026-10-06 |
| local | `codex/integrate-original-dev-hygiene-20261005` | 5e6c962a | NO_PR | 25 | 56 | 2026-10-05 |
| local | `codex/branch-integration-20261004` | b3ddc37b | NO_PR | 37 | 63 | 2026-10-04 |
| local | `codex/reconcile-sandbox-qa-history-20261004` | cc55ea81 | NO_PR | 8 | 59 | 2026-10-04 |
| remote | `codex/staging-release-20260926` | 29ba9f6a | NO_PR | 13 | 72 | 2026-09-28 |
| remote | `codex/consultation-slot-engine-20260920` | c166007e | NO_PR | 4 | 168 | 2026-09-20 |
| local | `codex/funnel-browser-harness-20260920-next` | 2efcd44c | NO_PR | 3 | 166 | 2026-09-20 |
| local | `codex/funnel-goal3` | de515182 | NO_PR | 33 | 192 | 2026-09-17 |
| local | `codex/payuni-query-hard-blocker-20260903` | 45612059 | NO_PR | 1 | 224 | 2026-09-03 |
| remote | `codex/payuni-sandbox-external-qa` | 35d8f593 | NO_PR | 117 | 263 | 2026-07-24 |
| local | `codex/recovery-live-stepper-qa-20260719` | 22f06a69 | NO_PR | 2 | 263 | 2026-07-19 |
| remote | `codex/ai-team-skills-automation-foundation` | bf45235f | NO_PR | 13 | 398 | 2026-07-12 |
| remote | `codex/server-tracking-webhooks-20261007` | 831a2bf2 | OPEN_PR#384 | 8 | 32 | 2026-10-09 |
| remote | `codex/notifications-main-20261011` | c1b694ce | OPEN_PR#420 | 38 | 3 | 2026-10-11 |
