# G7-31 歸因 Cookie HMAC 與 visitor replay 防護 checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。聯盟／團隊漏斗歸因 Cookie 已從可自行編碼的 JSON clue 改為版本化 HMAC token，表單與 checkout 仍會依 visitor、vendor、click 與 DB relation 重新驗證。舊 unsigned、被竄改、逾期、跨 visitor 或缺少簽章設定的 Cookie 都會安全失效，不會讓 lead capture 或 checkout 變成 500。

## 實際修改

- 新增 `ta1.<payload>.<signature>` 格式，使用用途隔離的 SHA-256 HMAC key；signature 以 constant-time comparison 驗證。
- payload 僅接受精確的 `clickId`、`visitorId`、`issuedAt`，並限制 ID、payload、signature 與整體 Cookie 長度。
- unsigned legacy base64url JSON 不再接受；下次有效 click 會取得新版 signed Cookie。
- `decodeURIComponent` 異常、缺少／過短 server key、錯誤版本、竄改 payload／signature、未來時間與逾期 token 都回傳 null。
- Affiliate-click route 在簽章設定不可用時仍保存 server click 並回應 200，但不發出可偽造的 sticky attribution Cookie。
- Form submission 新增同 visitor 驗證；signed Cookie 被另一個 visitor 重播時不查 click，也不寫入 `affiliateClickId`。
- Checkout 保留既有 visitor、vendor、active affiliate／team attribution 與 recent click 再驗證；unsigned legacy Cookie 被忽略後仍可正常完成 checkout。
- URL、Referer 與 JSON body 的 Live share clue 統一限制為 `tls1.` 加 32 到 155 個 entropy 字元，整體不超過 160；超長 clue 在 DB lookup 前拒絕。
- Live-share route fixture 改為正確的 B 推廣者 affiliate identity，避免測試把 `B-CODE` 錯綁成 A。

## Ownership 與安全邊界

- Cookie 只保存非機密的 click clue，不宣稱加密；HMAC 提供完整性與來源驗證。
- 簽章 key 由既有 deployment secret 做 purpose-separated derivation。本 WP 沒有讀取或輸出 `.env*`、secret、Token、Cookie、正式客戶或付款資料。
- Cookie 即使通過 HMAC，也不能直接決定 affiliate、team、vendor 或 commission；server 仍以 DB current relation 與 active 狀態判斷。
- 缺少簽章設定採 fail closed attribution、fail open navigation：不建立 sticky attribution，但正常 public click／lead／checkout 流程不因而中斷。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T08:08:51.4990049Z`。
- Final related regression：7 test files、`116/116 PASS`、failed=`0`、exit code=`0`。
- 關鍵 cases：valid signed round trip、unsigned legacy、payload／signature tamper、different key、missing key、malformed percent encoding、future／expired token、cross-visitor form replay、checkout recovery、Live-share commercial flow、oversized share clue。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck -- --pretty false`：PASS，exit code=`0`。
- Scoped `git diff --check`：exit code=`0`；只有既有 Windows LF／CRLF warning，沒有 whitespace error。
- Fixed-function score reconciliation：`4/4 PASS`、exit code=`0`；evidence path／SHA-256、固定 inventory、canonical 74.0 與 blocker 宣告一致。
- 第一次 6-file integration regression 為 5 files、100 tests PASS，`live-share-commercial-flow.test.ts` 1 test FAIL，exit code=`1`。原因是 test fixture 缺少新版 server-selected affiliate 欄位；補齊 `vendorId`、`isActive`、team attribution 後，後續 final regression PASS。失敗沒有被標記為 PASS。
- `typecheck:strict-index` 第一次找出本 WP token part 的 3 個 narrowing errors及既有其他檔案 errors；修正本 WP 3 個 errors 後重跑，相關檔案已無 strict-index error，但全域仍因 billing invoice、support case、actions、policies、interaction roles、live sharing 與 usage estimation 的既有 errors 而 exit code=`1`。沒有把全域 strict-index 記為 PASS。
- 本 WP 沒有 schema 或 migration 修改，沒有執行 disposable PostgreSQL。
- 本 WP 沒有執行 Browser、staging、Sandbox 或 Production 操作；未執行項目不列為 PASS。

## Reviewer

- 第一輪唯讀 reviewer 找到 1 個 P1：form route 未比對 visitor，signed Cookie 可跨 visitor replay。
- 第一輪另有 2 個 P2：URL／Referer share clue 無長度上限，以及 Live-share route fixture 把 B code 對到 A affiliate。
- 三項都已修正。原 reviewer 複核為 `RESOLVED`，最終沒有未解決 P0／P1／P2。
- Reviewer 全程唯讀、沒有修改檔案，也沒有執行測試。

## Source digests

- `8c435e550fdd88374aba7d3a609c2b197faa6b0f3364cab70391f117d825fa46  src/lib/team-funnel-attribution.ts`
- `be50fa635ea4df61a6f000b9bd91e7631e19da00dce197be0fcf92496d9de16d  src/lib/team-funnel-attribution.test.ts`
- `4907de235f632fa06ccf6ef67df34d8480608999bd3392b200d92523281e7859  src/lib/team-funnel-attribution-source-attribution.test.ts`
- `23565363414fd017d6a9d31b7da05bcd2c978843569ef7d901022d094cebed0d  src/lib/team-funnel-live-sharing.ts`
- `80df8130e49c9459f2f8018d0ea31b0fd3985e8bc1b89db79a74dc1b01dfa0cd  src/lib/team-funnel-live-sharing.test.ts`
- `df26068ff14a0453765adac17d12339e9d5d0ba8d9e6b1369d2426d7b8a7f281  src/app/api/affiliate-clicks/route.ts`
- `34d34dcaa0c77267310eda3f02e0a7cd932c2d0f0ade12fd1b7d200925d77f25  src/app/api/affiliate-clicks/route.test.ts`
- `d53f06f2a07bd5762d10ee5a0038b497061054924ceba5e36be48135eaab4ddd  src/app/api/form-submissions/route.ts`
- `76a33568f4ee7d173dfad44c1e349bfedc1db71472c919ec7fc58df582e5426a  src/app/api/form-submissions/route.test.ts`
- `2a3ef0a30c8aaec8e9edda8b5df1521904a44aeadd21aa294db33d5e7bf204b2  src/app/api/payments/checkout/route.test.ts`
- `a770a48e077cfe633a8068f4b577df6bc82b39322ad03cf6e717e06663cd5572  src/app/api/live-share-commercial-flow.test.ts`

## 分數判斷

- 固定功能 `報名表單`：`8.0 → 8.1`，fresh evidence `1.4 → 1.5`。
- 固定功能 `Checkout／付款`：`8.2 → 8.3`，recovery `1.8 → 1.9`。
- 固定功能 `團隊漏斗／Stream／營運後台`：`8.5 → 8.6`，fresh evidence `1.5 → 1.6`。
- 提升來源：歸因 clue 具備 tamper evidence，click signing outage 不阻斷 public flow，表單與 checkout 都有跨 visitor replay 防護，完整商業流程有 fresh deterministic regression。
- Latest canonical total 維持 `74.0`。本機歸因證據不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 保持 blocker，不阻擋其他產品工作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 人工與外部 blocker

- 本 WP 沒有新增需要使用者立即處理的事項。
- CAT04 仍需 fresh staging／PayUni Sandbox provider 與 reconciliation evidence。
- CAT10 仍需真人法律、隱私、退款、財務、客服 SLA、release acceptance 與外部監控交付。

## 回滾範圍

- 回滾範圍限於 attribution token encode／parse、form visitor binding、share clue input boundary、affiliate click issuance 與對應 tests。
- 沒有 schema、migration、外部服務或正式資料副作用。
- 回滾 HMAC 會重新接受可自行編碼的 unsigned clue，不建議只回滾 parser；若要回滾應連同 issuance 與所有依賴新版格式的 tests 一起處理。

## 下一個最高價值工作

回到產品操作流程，重新盤點尚未有完整 pending／disabled／success／failure／aria-live 回饋的高風險商家與買家動作，優先修正最可能造成重複付款、重複發布或誤以為按鈕無作用的功能，並用 Browser 加 deterministic tests 驗收。
