# QUAL-2026-08-07-30｜Current-tree coverage contract reconciliation

## 結果

完成 WP40／WP41 產品 source changes 後的 current-tree quality reconciliation。這輪先修正 coverage runner 揭露的真實 contract drift，再完整執行既有測試；功能測試與 Node contract 全數通過，但 global coverage gate 仍未達門檻，因此只記為 coverage inventory 尚未完成，不把它誤記成產品功能失敗。

## 本輪修正

- 保留 billing plans page 的既有 `超額：` source attribution signal，同時保留目前 Stream 額度用完會暫停新播放、未啟用自動超額扣款的產品說明。
- 將 Prisma invariant inventory 與目前 66 models／31 migration directories 對齊，並補列本輪 additive migration。
- 將 AffiliatePayout schema contract 改為只檢查後續 course migration 不會重建或混入 AffiliatePayout，允許合法的後續 nullable compatibility migration。
- 將 type-safety policy test 的執行 timeout 調整為 30 秒；沒有改變 assertion、掃描範圍、threshold、exclude 或 skip。

## 驗證

- targeted contract regression：6 files／23 tests，23 passed、0 failed、0 skipped。
- full Vitest：216 files，1511 passed、0 failed、0 skipped。
- Node contract：679 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。

## Global coverage 真實結果

| 指標 | 實際 | 門檻 |
|---|---:|---:|
| Statements | 42.53%（13588/31943） | 63% |
| Branches | 48.19%（12591/26127） | 57% |
| Functions | 51.34%（2535/4937） | 60% |
| Lines | 61.86%（11661/18849） | 65% |

combined runner exit code 為 1，分類為 `FAIL_REMAINING_SOURCE_INVENTORY`。Coverage gate 仍開啟，但沒有阻擋功能測試或 E2E 的合理執行；本輪不降低既有門檻，也不新增 skip／exclude。

## 分數與邊界

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false。
- current Goal score change：0。
- CAT04 仍需最新授權 staging reconciliation 與 PayUni Sandbox provider receipt；CAT10 仍需商家、客服、法務／隱私／退款、財務與 release owner 的真人證據及外部 monitoring。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197，也沒有 staging、PayUni、Production、部署、push 或 merge。

下一步回到非 terminal 的產品 source family，優先處理 Stream per-member／per-page quota policy 與通知／停用語意；coverage 會保留本次精確失敗結果，避免讓品質工作取代功能完善。
