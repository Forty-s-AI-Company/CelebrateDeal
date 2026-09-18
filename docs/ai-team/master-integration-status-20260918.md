# CelebrateDeal master 整合與分支完成度（2026-09-18）

本表區分「patch 整合狀態」與「產品完成度」。沒有以 ahead／cherry + 數量當成功能數；無足夠語意證據者保留，不能宣稱完成。

## 本輪 checkpoint

- origin/master 基準：4747314743330ca783bc1ae6387aa528d20eb7bd。
- one-stop-webinar-flow 已合併遠端 6 個 CI 修正並推送 e1700a86；後續掃描修正 d5a1d71e 已推送。PR #210 仍有 master 衝突，strict-index 已修正並推送 c2fec462；CI 已通過 strict-index，後續發現 3 個測試檔的過期 mock；已修正，頁面 8/8 與付款 webhook 6/6 targeted tests 通過，等待新 checkpoint CI。
- 本機隔離 generate/typegen/typecheck 通過；Funnel targeted 43/43；同步修正 targeted 15/16 初次通過，inventory 根因修正後 1/1 通過；node evidence contracts 5/5；lint 0 errors（3 個既有圖片 warnings）。
- 原有 .codex/config.toml 未提交變更保留；未進 commit。
- PR #212 / 0f378146：PayUni receipt 保留副作用計數；67 mock/workflow tests、lint 通過，獨立小 diff 審查無 blocking finding。master 現有 production dependency audit 阻擋合併。
- 依賴 PR #213 / caa822d1 獨立在 codex/master-dependency-audit-20260918：Next.js／sharp 公告漏洞，未降低 audit 門檻。已補齊跨平台 lockfile 與 Playwright core 1.61.1 peer 對齊；標準 npm ci dry-run 通過，required quality 待驗。
- 已刪除 108 條本地分支：95 條一般 auto 分支全部 patch 等價、無獨有 merge commit、無在用 worktree、遠端保留；11 條 checkout 歷史分支經實際語意比對後確認由 master 承接，另 2 條為 master 祖先。沒有刪除遠端分支或工作目錄。

## 批次與保留決策

| 批次 | 範圍 | 狀態／下一步 |
|---|---|---|
| A | one-stop 本機／遠端同步 | 已推送；strict-index 與 16 targeted tests 通過，等待 exact-head CI；不在 conflict 狀態 merge |
| B | master dependencies | 修 Next.js／sharp audit；獨立 PR 通過 required quality 後合併 |
| C | PayUni receipt integrity | PR #212，只移植最小 helper/test；待 B 後重驗 |
| D | 低風險歷史分支清理 | 108 條 local refs 已清理；remote 保留 |
| E | 長期分支剩餘 UI／Funnel／workspace | 保留來源，先按 src 實際差異及依賴分批；不整份覆蓋 master |
| F | 高風險 runner／LINE／退款 | master 後續實作優先；僅經實際 diff 證明的新增功能才移植 |

安全 runner 已比對 11 個具體檔案：master 的 9 個固定 task、pagination/read budget、read-only restore、LINE canonical receipt path 優於長期分支；唯一已證實缺漏為 C 批次。此結論不擴張為所有 PayUni 分支都完成。

## 逐分支完成度與處置

初始盤點 201 條 local refs（含本輪暫建分支）；本表補列後續新分支與 1 條 remote-only 歷史分支。PATCH_EQUIVALENT 只證明提交變更等價，不替產品宣稱 100% 完成。

| 分支 | HEAD | 整合完成度 | 處置／證據 |
|---|---|---|---|
| ai-team/isolated-write-smoke-20260712-0405 | d8c85fbb | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| chore/ai-team-v5.1-migration | 937f796d | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/ai-team-skills-automation-foundation | bf45235f | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-affiliate-performance-list-bombmy-parity-retry-b07e0e3b | 38bbb045 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-add-vendor-member-email-invitation-0ce8f8e8 | 79494a34 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-affiliate-click-paid-order-attribution-f7538669 | 114689cc | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-align-settlement-platform-fee-refunds-087dd8f2 | 0f8f58f8 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-block-untracked-checkout-fallback-17dd29e7 | ebdbf2e0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-checkout-failure-update-fallback-fc6dd84f | 39b8dedf | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-checkout-metadata-failure-compensation-5088a79f | 227c102b | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-checkout-metadata-write-failure-7ce63750 | b92d3e91 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-checkout-response-no-store-b059af2b | 1a918f9e | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-checkout-transaction-create-failure-eff9bf94 | 2401481c | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-clarify-team-report-financial-periods-e85fba2a | 5b91672e | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-clear-consumed-form-attribution-cookie-0ba12ab0 | 3c7a5c82 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-confirm-vendor-member-deactivation-3f8fb123 | 3ace54c1 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-dedupe-refund-commission-retries-b8852f88 | cd26e31c | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-detach-live-from-interaction-script-e8ccc0ff | 638707f9 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-fix-full-refund-affiliate-adjustments-b93d1f46 | 1897c453 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-fix-live-analytics-kpi-window-ef3a2883 | 36b38ad2 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-guard-late-paid-webhook-commission-32405d2a | 918b0c87 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-handle-password-reset-email-failure-f444b1d2 | 62fb1655 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-harden-login-rate-limits-367f02af | fd315e6c | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-hide-retired-billing-plans-fd8e1c24 | d901dcd8 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-live-analytics-empty-states-cd25b32d | 30230f4a | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-live-checkout-failure-feedback-7a44bfcb | 1ff1b513 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-make-payout-csv-download-read-only-f041294c | ea9dc388 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-mark-checkout-provider-failures-14cc4e06 | 67b3fffd | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-net-monthly-revenue-after-refunds-6776de67 | 36c25820 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-net-platform-fees-after-refunds-8df43b10 | 04c10ff7 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-persist-interaction-script-reorder-e2e-ffc4cf00 | 320d63b9 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-persist-interaction-timeline-reorder-a2a160eb | b3a393a0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-persist-lead-attribution-through-checkout-5927e20d | 101b8402 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-preserve-payment-occurrence-on-refund-a5b20cc2 | 60f652fe | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-prevent-concurrent-manual-refund-overdraw-fd62bbbd | f43f5be0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-prevent-duplicate-live-checkout-313cb628 | 94e66bdf | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-protect-partner-profile-email-8674ef8a | 2be8fbb4 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-rate-limit-mfa-verification-1cc12a43 | e7abdc17 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-rate-limit-password-reset-server-action-a5a9d8df | 280197db | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-rate-limit-vendor-member-invitations-eef6dbb2 | 3225b461 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-record-team-conversion-attribution-15e880f4 | bb610057 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-refresh-member-invitation-after-resend-06339e6d | 69777162 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-refresh-team-funnel-audit-8610acda | 2b122ece | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-reject-mismatched-payment-webhook-vendor-identifiers-ebbe8cd3 | 64a6ecd0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-reject-unknown-payment-webhook-provider-bd0fca24 | 57946984 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-reject-unscoped-payment-webhooks-87aeb639 | 1be712f4 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-remove-vendor-payout-export-button-7ee25ba0 | 2e4166b5 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-resend-vendor-member-invitation-0253ef56 | 031b47ac | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-restrict-payment-webhook-provider-79d0e42f | f62c7243 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-retry-serializable-refund-conflicts-1ed9f441 | 7d78e77e | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-scope-billing-usage-monthly-transactions-ae8ec7a1 | d17f4191 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-scope-billing-usage-record-to-current-month-7a2cfa02 | 031f481b | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-scope-vendor-payouts-page-9673b0b8 | 365070ae | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-secure-webhook-order-authority-a2605f45 | acb5b5fa | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-show-team-attributed-conversions-111fb900 | 01c8db6c | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-submit-payuni-checkout-form-8b5a4e44 | 90e3a9d7 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-team-performance-date-scoped-refunds-c27f8b70 | 912ea80d | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-admin-analytics-smoke-route-00cb84a4 | 1cf2701d | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-admin-cloudflare-ops-routes-a69e2520 | e2e85858 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-admin-ops-email-route-59f4c2a8 | f1eec5b0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-admin-preflight-route-e504cc9b | c37c9f80 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-cloudflare-resource-endpoint-auth-1fc52db7 | 3b01efad | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-health-api-route-f45fa790 | 53fe02c4 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-live-stepper-preview-8d4b75c7 | 7f1b3fd2 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-test-monitoring-smoke-endpoint-97b0f459 | 5762d213 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-password-reset-confirm-route-3ff4807b | 1a809d1f | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-password-reset-request-route-1f04be46 | 53f2e7f0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-system-role-library-import-094d9cd7 | 65417af2 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-team-funnel-pages-route-3c1efddb | da200266 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-team-funnel-partner-profile-route-95d86b41 | 3d378de9 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-team-funnel-product-slots-route-8a450add | d195a2e7 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-team-funnel-share-claim-route-d7f91e7e | 1d106f93 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-team-funnel-template-publish-route-d6b3a898 | d9537673 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-test-vendor-member-deactivation-399b7b28 | 2cceebba | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-auto-test-webhook-retry-job-route-08292622 | e2a9029b | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-validate-interaction-script-timestamps-f1ad5709 | 20a9abe0 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-validate-manual-refund-fees-a8884f1a | 07b43774 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-validate-manual-refund-remaining-amount-a3fa1a59 | 569a2490 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-validate-refund-settlement-month-436c7d85 | 77f24127 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-validate-settlement-month-key-1693da3b | c96c1780 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-vendor-invoice-csv-export-841d59b9 | c83d2ebc | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-verify-checkout-referral-attribution-6b406470 | ded82898 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-auto-verify-interaction-timeline-drag-drop-e2e-18a9a618 | 5786ed85 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-cloudflare-diagnostics-redaction-regressions-a4b40a18 | 3f0eb497 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-cloudflare-production-official-signature-d60049d5 | c15be272 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-csp-report-only-regressions-9f13a855 | 178a8302 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-csp-report-rate-limit-429-regressions-7c770a60 | 2b775029 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-dashboard-seven-day-conversion-funnel-138c807a | 72fa82fa | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-dashboard-upcoming-live-countdown-24f1b9e8 | 8b740384 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-health-database-ok-e2e-regressions-93737079 | e0ae3a39 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-job-secret-endpoint-401-regressions-47e6734e | 06d0bd5a | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-live-analytics-conversion-funnel-e52533a7 | 8b3a8477 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-live-stepper-grounded-preview-63bea109 | f5512bf0 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-login-rate-limit-audit-e2e-regressions-e8279702 | 7e019b90 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-password-reset-ui-smoke-isolated-email-regressions-cf0963fd | 541049f5 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-payment-webhook-test-fixture-isolation-6a70376d | cfaffa91 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-public-json-origin-guard-regressions-ff8b3f06 | 61fb072e | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-public-route-rate-limit-429-regressions-b7657b95 | 62f3fea5 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-rate-limit-provider-fail-closed-regressions-1a6eed23 | f3685f77 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-reconcile-cloudflare-integration-report-67363dbd | 506068c7 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-reconcile-interaction-drag-sort-report-2f84c183 | 851fe73e | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-reconcile-password-reset-mfa-report-8810c4c0 | e259055e | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-security-password-reset-smoke-isolation-regressions-f0bef089 | 8f988acd | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-architecture-baseline-30371aa7 | 9ef1b540 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-attribution-registration-ef0c2d52 | 01bab501 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-authorization-scope-cc5772e6 | 94680515 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-browser-e2e-visual-qa-573eca99 | 83ead8f0 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/auto-team-funnel-completion-audit-f3db1725 | 6759087f | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-domain-model-94474d24 | 8b943327 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-dynamic-field-catalog-8aa1c17e | 0802d766 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-dynamic-fields-29600e53 | e1ac994c | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-page-template-services-abd771d4 | 3edd225b | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-partner-page-ui-4665c01d | 536c22bd | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-partner-product-slots-cf93509d | 08bc2833 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-performance-reporting-8f344c87 | 10acdee8 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-public-page-rendering-68778a80 | 92cb4a4f | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-share-copy-service-d4f832d0 | 0f3aa739 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-template-management-ui-259d80f4 | 20aaa3fd | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-team-funnel-template-text-renderer-208103e5 | e6df2099 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/auto-webhook-retry-worker-regressions-27e3474f | b9747621 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/current-source-evidence-20260903 | 1806f4b8 | master 已包含全部提交 | 保留在用 worktree；保留（主分支／worktree／遠端 reference） |
| codex/funnel-goal3 | de515182 | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/funnel-goal3-only | b5397dbb | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/isolate-mfa-test-env | e3d276de | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/line-oa-delivery-report | 5b9d599d | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/line-oa-notification-closure | 992e9450 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/line-receipt-path-fix | 7c30ac74 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/line-receipt-validation-fix | 52730692 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/line-runner-binding-diagnostic | c14160e7 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/line-runner-stage-diagnostic | 3cf0c7b4 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/live-admission-retry-backoff | 74c61991 | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/master-dependency-audit-20260918 | 35275928 | 實作／驗證中 | 保留；獨立修復 dependency audit |
| codex/master-integration-sync-20260918 | c2fec462 | 同步已推送，整合未完成 | 保留；PR #210 conflict 保留；strict-index 本機已通過，CI 進行中 |
| codex/master-receipt-counters-20260918 | 0f378146 | 本機通過，PR 待 CI | 保留；PR #212，需先解除 dependency audit |
| codex/mvp-payuni-e2e-20260903 | a9748571 | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/one-stop-webinar-flow | e1700a86 | 同步已推送，整合未完成 | 保留；PR #210 conflict 保留；strict-index 本機已通過，CI 進行中 |
| codex/openhands-ai-team-reset | b2e3eebb | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/payuni-preview-return-origin | 0616beaa | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/payuni-production-query-hard-blocker | abc55736 | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/payuni-query-hard-blocker-20260903 | 45612059 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/payuni-sandbox-external-qa | 35d8f593 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/payuni-webhook-transaction-timeout | 259083f1 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/pr210-secret-scan-fix | e1f38be3 | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/recovery-live-stepper-qa-20260719 | 22f06a69 | 已由後續實作取代 | 保留 reference；master 測試檔已包含該分支所修正的 React element traversal helper 與即時預覽 assertions，顯示測試需求已被後續 master 版本承接。 |
| codex/wp2-db-failure-classification | 74e55f89 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp2-pooler-readonly | f82adc4c | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp2-receipt-preservation | b9468346 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp2-restore-extension-placement | 146f8db0 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp2-squash-lineage | 2be14ad2 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-binding-annotation-20260903 | f902d24a | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-binding-preflight-20260903 | 1745f92e | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-browser-network-diagnostic-20260903 | c457a7c4 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-buyer-callback-retry | f9e2f870 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-buyer-existing-continuation | c3bc84c7 | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-buyer-payment-check | cfdc9f3d | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-callback-proof-20260903 | 0b38bfeb | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-current-preview-recovery | ec49b0ea | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-eventual-refund-reconcile | b7bfc488 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-eventual-refund-reconcile-clean | 70a1d83f | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-exact-preview-004ac887 | a1ffc4a9 | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-executor-enabled-preview | 3f6f230d | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-existing-refund-recovery | fea1e5ff | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-fixed-executor-v3 | e1105745 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-fixture-root-cause-20260903 | f31ee23b | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-lineage-candidate-fix-20260903 | cd3571dd | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-lineage-status-url-fix | e18e15ef | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-master-979ff07 | 979ff079 | 已整合 | 已刪本地 ref；遠端／master 保存，可依 HEAD 還原 |
| codex/wp4-master-exact-preview | 065fb82b | 待實際差異審查 | 保留在用 worktree；保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-network-error-classification-20260903 | ec980b7f | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payment-page-host-20260903 | 29d7be61 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-browser-stage-20260903 | 500f4477 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-payuni-navigation-classifier-20260903 | 6666a4d2 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-navigation-commit-20260903 | d25214e4 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-navigation-race-20260903 | 2e21f109 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-payuni-navigation-response | e7c139e8 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-network-cause-20260903 | edae9d63 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-scheduled-submit-20260903 | bf0f85bd | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-secure-runner | 20bc8973 | master 已包含全部提交 | 保留在用 worktree；保留（主分支／worktree／遠端 reference） |
| codex/wp4-payuni-secure-runner-20260903 | 20bc8973 | master 已包含全部提交 | 保留在用 worktree；保留（主分支／worktree／遠端 reference） |
| codex/wp4-payuni-success-card-20260903 | dbc34001 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-payuni-vendor-egress-20260903 | 0974dcb6 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-pin-chromium-payuni-egress-20260903 | 7d162a65 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-preserve-payuni-dns-order-20260903 | 2fe1911f | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-receipt-fix-20260903 | eac0a343 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-receipt-remediation-20260903 | c06fdd1e | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-reconciliation-fallback | 34133663 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-recovery-database-diagnostics | 0d862d95 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-recovery-local-classification | ba69689e | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-recovery-transaction-stage | b8180304 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-refund-projection-window | 1052a46d | patch 已等價整合 | 保留在用 worktree；保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-refund-rejection-recovery | 88084d04 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-reservation-diagnostic-20260903 | 2540d245 | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-sandbox-executor-master | aecd0d18 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-sandbox-executor-v2 | 46a9e36c | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-secure-runner | 7b320ff0 | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-secure-runner-cbae30af | cf33299a | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-secure-runner-executor | 6ef0908b | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| codex/wp4-secure-runner-master | 73825fad | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-source-bound-checkout | 23fdee6d | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-subscription-runner | 93b4db2c | 待實際差異審查 | 保留；無法以歷史提交數判斷產品完成度 |
| codex/wp4-whole-twd-refund | 0d58cefd | patch 已等價整合 | 保留遠端；本地非一般 auto 範圍或仍有 worktree |
| master | 47473147 | master 已包含全部提交 | 保留（主分支／worktree／遠端 reference） |
| origin/codex/wp4-exact-preview-800746c | 800746cb | master 已包含全部提交 | 保留（主分支／worktree／遠端 reference） |

## CelebrateDeal-* 目錄刪除條件

GitHub 有 commit **不等於整個目錄已備份**。必須同時確認 HEAD 可由遠端 ref 到達、沒有 tracked/untracked 變更、ignored 內容只含可重建產物，且工作不再需要；確認後用 git worktree remove 處理登錄。此輪只盤點，不刪目錄。

大量 ignored 項目主要是 node_modules，不能因檔名含 secret/token 就認定是真正憑證；本輪沒有讀取任何這類內容。下表「候選」仍需確認 ignored 產物是否需要保留。

| 目錄（CelebrateDeal- 前綴省略） | HEAD | dirty | 遠端保存 | 判定 |
|---|---|---:|---|---|
| ai-write-00daa6a5 | b2e3eebb | 0 | 是 | 候選；無 ignored |
| ai-write-2c6dabd6 | d8c85fbb | 0 | 是 | 先保留；隔離測試工作與 ignored 尚需確認 |
| ai-write-3b192754 | b2e3eebb | 0 | 是 | 候選；node_modules 等可重建內容需確認 |
| ai-write-696c1196 | b2e3eebb | 0 | 是 | 候選；無 ignored |
| ai-write-d7e4e038 | b2e3eebb | 0 | 是 | 候選；node_modules 等可重建內容需確認 |
| current-source-evidence | 1806f4b8 | 5 | 是 | 保留：未提交變更 |
| live-admission-fix | 74c61991 | 0 | 是 | 候選；ignored 產物需確認 |
| mvp-payuni-e2e | a9748571 | 0 | 是 | 候選；tsconfig.tsbuildinfo |
| mvp-payuni-sandbox-e2e | 20bc8973 | 2 | 是 | 保留：未提交變更 |
| openhands-disposable | 8f8ba658 | 0 | 是 | 候選；無 ignored |
| payuni-query-hard-blocker-20260903 | abc55736 | 0 | 是 | 保留：分支實際差異待判斷 |
| recovery-runner | ec49b0ea | 0 | 是 | 保留：runner 後續替代需逐分支確認 |
| risk-mvp-current | 1052a46d | 0 | 是 | 候選；.vercel 與 node_modules 等本地內容需確認 |
| subscription-runner | c3bc84c7 | 0 | 是 | 候選；ignored 產物需確認 |
| wp4-binding-preflight | f902d24a | 0 | 是 | 候選；ignored 產物需確認 |
| wp4-callback-proof | 0b38bfeb | 0 | 是 | 候選；tsconfig.tsbuildinfo |
| wp4-diagnostic-fix | 065fb82b | 0 | 是 | 保留：runner 後續替代需逐分支確認 |
| wp4-exact-004ac887 | a1ffc4a9 | 0 | 是 | 保留：實際差異待判斷 |
| wp4-lineage-candidate-fix | cd3571dd | 0 | 否 | 保留：HEAD 無遠端 ref |
| wp4-lineage-fix | e18e15ef | 0 | 是 | 候選；無 ignored |
| wp4-payuni-secure-runner-20260903 | 20bc8973 | 0 | 是 | 候選；master 已包含，ignored 需確認 |
| wp4-payuni-secure-runner-20bc897 | 20bc8973 | 4 | 是 | 保留：未提交變更 |
| wp4-remediation | eac0a343 | 0 | 是 | 保留：receipt 分支未完成差異判斷 |
| wp4-remediation-master | a86e0f55 | 0 | 否 | 保留：HEAD 無遠端 ref |
| wp4-secure-runner-cbae30af | cf33299a | 1 | 是 | 保留：未提交變更 |

本輪新建 CelebrateDeal-integration-20260918 仍為使用中的整合 worktree，保留。其他本輪 master 小批次 worktree 位於 Local/Temp，不在上述目錄刪除範圍。

## 還原與安全界線

- 本地分支可用 git branch <原分支名> <表列完整 SHA 或仍保留遠端分支> 重建；完整 SHA 另存同目錄 JSON inventory。
- 未刪遠端 branch、未 force push、未直接 push master、未 bypass required checks。
- 不操作 production、不讀 Secret／.env*；未跑真實付款／退款／寄信。
