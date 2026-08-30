# G7-19 Checkout payment return checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。本工作已取得 hermetic production build、disposable PostgreSQL 與 5/5 Browser contract 證據；未宣告 staging／PayUni Sandbox 或 canonical 加分。

## 產品問題與修正

- PayUni 的 `ReturnURL` 與 `NotifyURL` 原先共用 webhook route，付款人回站可能看到原始 JSON。
- 精確的 PayUni payer return 現在以 `303` 導向同源 `/checkout/result?payment=<bounded-outcome>`；server-to-server Notify 仍維持 JSON ack。
- 導向只允許 `updated`、`pending`、`unverified`，不攜帶交易 ID、訂單 ID、Email 或 provider 原始內容。
- 新增安全付款結果頁、loading 與 error UI。頁面只使用目前瀏覽器持有的 buyer support capability 查詢訂單，顯示遮罩 Email 與資料庫中的實際付款狀態。
- error UI 有 pending、disabled、`aria-busy` 與可見狀態回饋。
- production `Secure` buyer capability 保持不變。HTTP loopback Browser 驗收使用明確記錄的 synthetic TLS cookie bridge，未修改 production cookie policy。

## Deterministic evidence

- 付款、結帳、PayUni adapter、buyer capability、結果頁與 API registry：`123/123 PASS`，共 11 個 test files。
- webhook route 與結果頁修正後 targeted：`34/34 PASS`。
- commerce runner unit tests：`12/12 PASS`。
- scoped ESLint：`PASS`。
- hermetic Next production build：`PASS`，見最後三份 Browser receipt。
- 本機 `npm run typecheck` 曾在修正後 `PASS`；後續再跑被本機 `.next/dev/types` stale route validator 阻擋。未刪除本機 `.next`，未把後一次結果標為通過。

## Browser 與 disposable PostgreSQL evidence

最終 receipt：`docs/ai-team/evidence/g7-04-browser-qa-f450f482f8b58599.json`

- canonical migrations：`PASS`
- hermetic production build：`PASS`
- loopback server：`PASS`
- Browser contracts：`5/5 PASS`、`0 FAIL`、`0 SKIP`
- 已通過：桌機商品建立、手機商品 RWD/Axe、桌機訂單與履約、手機訂單 RWD/Axe、公開買家建立單一 reservation 並安全查看付款狀態。
- Axe critical／serious：`0`；RWD、tenant isolation、PII envelope leak 與 product catalog contracts 全部 `PASS`。
- 新付款結果 contract 已驗證 Secure capability 發行、明確 synthetic TLS bridge、付款結果頁、遮罩資料與實際 pending 訂單狀態。
- cleanup：server、container、temp root 全部 `PASS`。

失敗演進保留如下：

- `g7-04-browser-qa-8fc6252308389c03.json`：App Router page 額外 export 導致 production build typecheck fail，已修正為獨立 library。
- `g7-04-browser-qa-1d826bf2eeb92d78.json`：production build pass，結果頁 Browser contract 首次暴露 Axe 對比問題。
- `g7-04-browser-qa-95cd51f21fc4d423.json`：深色結果頁 link 後仍失敗，確認 selector 不足以定位根因。
- `g7-04-browser-qa-75f1a7b1e9aa57fb.json`：Secure capability 與 synthetic TLS bridge 均通過，剩餘失敗定位到 `PublicPolicyShell` footer 的 `.mt-4 text-slate-500` 說明文字。
- `g7-04-browser-qa-f450f482f8b58599.json`：footer 改為 `text-slate-700` 後，production build 與 5/5 Browser contracts 全 PASS，三項 cleanup 全 PASS。

## 尚未完成

- staging HTTPS 與 PayUni Sandbox payer-return 尚未執行，不以 loopback bridge 冒充外部驗收。
- 本輪沒有需要使用者立即手動處理的事項。

## 分數判斷

- canonical 總分維持 `73.5`。
- Checkout／Payment 固定功能分由 `7.0` 重算為 `7.5/10`：core `2.2→2.3`、recovery `1.4→1.5`、UX `1.1→1.3`、fresh evidence `1.3→1.4`，integrity/security 維持 `1.0`。依據為安全 payer return、狀態頁、錯誤復原、5/5 Browser 與 hermetic build evidence。
- 外部 PayUni Sandbox 尚未完成，因此 fresh evidence 只調到 `1.4/2`，沒有以 local evidence 取代外部證據。
- CAT04 與 CAT10 外部／真人 blocker 沒有被本工作重跑，也沒有阻擋此功能推進。

## 回滾範圍

- payment webhook payer-return redirect helper
- checkout result page、loading、error 與 outcome library
- API contract registry
- commerce Browser contract、source attestation 與 synthetic loopback TLS bridge

## 下一個最高價值工作

回到固定功能 scorecard，選擇分數最低且交易／商家成功影響最高的下一個產品工作，不轉做 coverage。
