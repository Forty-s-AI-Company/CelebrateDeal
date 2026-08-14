# FUNC-2026-08-07-21：團隊 membership 與上下線關係本機 closure

驗證時間：2026-08-07 14:11（Asia/Taipei）  
狀態：`LOCAL_FUNCTIONAL_CLOSURE`，不是 staging、PayUni 或人工 release acceptance。

## 完成範圍

- owner 建立團隊時，透過 Serializable transaction 自動加入建立者。
- owner 可加入同一商家的 active VendorMember；既有 inactive membership 會重新啟用，不建立 duplicate row。
- owner 可設定、移除 direct upline；舊關係寫入 `endedAt`，不覆蓋歷史。
- server action 以 vendor、team、active membership scope 驗證輸入，阻擋跨商家、self-upline 與循環關係。
- 停用 membership 前結束該成員作為 upline 或 downline 的 active relationship。
- 新增 owner-only `/settings/team` 頁面，並從安全設定提供入口。

## 實際驗證

| 檢查 | 實際結果 |
|---|---|
| `npx vitest run src/app/actions/team-membership-actions.test.ts src/app/(app)/settings/team/page.test.tsx` | 2 files、7 tests PASS |
| `npm run typecheck` | PASS |
| scoped ESLint | 0 errors |
| `npm run secret:scan` | `secret_scan_passed` |
| scoped `git diff --check` | 無實際 diff error；僅 LF/CRLF normalization warning |

## 分數與驗收界線

canonical readiness 仍為 `73.5`：CAT04 `6.0`、CAT10 `4.5`，本輪 `score_change=0`。這是正確結果：本輪只證明本機功能與安全邊界，沒有執行 staging、PayUni Sandbox、正式付款／退款，也沒有真人 legal、support、finance 或 release owner 簽核，因此不能替 CAT04 或 CAT10 加分。

本輪沒有重試 FIN-08AA、WP-196、WP-197 或既有 terminal external path，沒有降低 coverage threshold、exclude、skip、assertion，也沒有讀取 secret 或 production data。

完整 sanitized machine-readable receipt：`.ai-team/reports/func-2026-08-07-21-team-membership-closure.json`。
