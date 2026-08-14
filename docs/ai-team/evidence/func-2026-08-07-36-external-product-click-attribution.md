# FUNC-2026-08-07-36 — External partner product click attribution closure

## 發現與修正

本 WP 關閉外部產品導流的真實功能缺口：夥伴公開頁的商品連結原本直接離站，沒有留下 B 的來源頁／商品 slot click attribution。這會讓 CelebrateDeal 只能看到頁面或報名，無法可靠回答「哪個夥伴公開頁把使用者導向外部商品」。

修正範圍：

- 公開頁商品連結改由 client component 先呼叫既有 server-validated `/api/affiliate-clicks`，帶入 vendor、live、來源頁 slug、slot 與 server-rendered referral code。
- click endpoint 仍由伺服器重新驗證商家、Live lifecycle、公開頁與團隊歸屬；瀏覽器不能自行宣告 owner 或跨租戶 attribution。
- tracking request 失敗時仍會導向外部商品站，避免分析服務故障阻斷商業導流。
- 公開頁明確標示「這裡只記錄推薦點擊」；外部付款、退款與外部佣金仍由外部平台處理，沒有產生 CelebrateDeal 的 paid／refund claim。

## 驗證證據

- focused suite：4 files／35 tests PASS（35 passed、0 failed、0 skipped），包含既有 affiliate click API regression、public page renderer、public page resolver 與新 outbound-link component。
- `npm run typecheck`：PASS。
- touched source/test scoped ESLint：PASS，0 errors。
- `git diff --check`：PASS；僅有既有 LF/CRLF normalization warning，沒有實際 diff error。
- 本 WP 沒有 schema 或 migration 變更，因此沒有啟動 disposable migration；既有 affiliate-click API 的 tenant／source-page regression suite 已在本機執行。

## 分數與安全邊界

- canonical total：73.5；CAT04 6.0、CAT10 4.5；`current_goal_score_change=0`。
- 這是 local product closure，不預支 CAT04 staging／PayUni Sandbox provider receipt，也不預支 CAT10 真人 owner／external monitoring evidence。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 未操作 Production、正式 DB、正式付款／退款、寄信、deployment、push、merge；未讀取 secrets；未重試 FIN-08AA、WP-196、WP-197 或任何 terminal external command。
- 最近 authoritative global coverage 仍為 statements 42.36%、branches 48.07%、functions 51.11%、lines 61.68%，對 threshold 63/57/60/65 的 `FAIL_REMAINING_SOURCE_INVENTORY`；本 WP 沒有降低 threshold、exclude、inventory、skip 或 assertion。

## 回滾

回滾範圍僅為 public page view model、outbound product-link component、公開頁說明與對應 tests；沒有 migration 或外部副作用。既有 server click API 未被削弱。
