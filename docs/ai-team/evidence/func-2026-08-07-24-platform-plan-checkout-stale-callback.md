# FUNC-2026-08-07-24 — Platform plan checkout replay／stale callback closure

## 結果

本輪完成本機可驗證的平台訂閱結帳一致性修復，狀態為 LOCAL_FUNCTIONAL_CLOSURE。同一 vendor／plan 的重複結帳不會再無條件建立第二筆 pending subscription；較舊的 paid callback 也不會再啟用已被新選擇 supersede 的方案。

主要修復：

- server action 建立 vendor／plan scoped deterministic checkout key。
- 只有 server metadata、pending subscription 與已保存 checkout session 完整相符時才 reuse；不相符直接 fail closed。
- 新 checkout 會將舊 pending subscription 標記為 payment_superseded。
- webhook 對 payment_superseded 或已有更新 pending subscription 的舊 callback 不啟用舊方案。
- platform referral commission 只對明確 reconciled active subscription 產生新 accrual。
- 既有 AffiliateCommission void action 抽至獨立 domain，root action 保留相容 re-export。
- 同步更新 WP23 live admission boundary 測試，以及目前 64 models／23 migrations 的 inventory／schema contract gate。

## 實際驗證

- targeted platform plan／payment webhook：2 files，48 passed、0 failed、0 skipped。
- full Vitest：193 files，1369 passed、0 failed、0 skipped。
- Node contract：679 passed、0 failed、0 skipped。
- architecture boundary：4/4 passed。
- npm run typecheck：PASS。
- scoped ESLint：0 errors。
- npm run secret:scan：secret_scan_passed。
- git diff --check：PASS，只有既有 LF／CRLF normalization warnings。
- node scripts/readiness-truth-reconciliation.mjs：PASS，10 categories、canonical total 73.5、G1 CLOSED、SANDBOX_READY false、PRODUCTION_READY false。

## 為什麼總分仍是 73.5

這輪修復提高了販售功能的實際可靠性，但沒有產生新的 CAT04 或 CAT10 可計分驗收條件。CAT04 仍缺 fresh staging reconciliation 與 PayUni Sandbox provider receipt；CAT10 仍缺商家、客服、法律／隱私、退款、財務、release owner 的真人 evidence 與 external monitoring evidence。readiness runner 輸出的 score_change=0.5 是歷史 WP-131 欄位，不是本輪分數變化，因此本輪 current_goal_score_change=0。

最新 canonical snapshot：

| Category | 分數 | 目前狀態 |
|---|---:|---|
| CAT01 | 7.5 | 已達標 |
| CAT02 | 8.0 | 已達標 |
| CAT03 | 8.0 | 已達標 |
| CAT04 | 6.0 | 等 staging／PayUni receipt |
| CAT05 | 8.5 | 已達標 |
| CAT06 | 7.0 | 已達標 |
| CAT07 | 9.0 | 已達標 |
| CAT08 | 7.5 | 已達標 |
| CAT09 | 7.5 | 已達標 |
| CAT10 | 4.5 | 等真人 owner／external monitoring |
| **Total** | **73.5** | **Goal 尚未完成** |

## 邊界與安全

- 沒有讀取或輸出 .env*、credential、token、cookie、production secret、production customer／payment data。
- 沒有執行 production payment／refund／email、staging mutation、PayUni Sandbox call、deployment、push 或 merge。
- 沒有重試 FIN-08AA、WP-196 或 WP-197 terminal path。
- 沒有新增 schema migration，沒有降低 coverage threshold、inventory、exclude、skip、assertion。
- worktree 保持未 staged；部分檔案含前序使用者／WP dirty hunks，回滾只能按 ownership 做 inverse patch。

## 下一步

優先順序仍是：取得明確授權後完成 CAT04 fresh staging／PayUni provider reconciliation；若外部邊界仍未開放，繼續選擇下一個本機 P1 販售功能。CAT10 必須等待真人 owner evidence，AI 不代替法律、財務或 release 簽核。
