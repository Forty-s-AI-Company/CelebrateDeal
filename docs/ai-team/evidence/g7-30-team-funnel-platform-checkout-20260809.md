# G7-30 團隊漏斗平台商品 checkout checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。團隊漏斗的商品槽現在能區分 CelebrateDeal 平台商品與外部商品。平台商品會在 server 確認商家、啟用狀態、履約類型、售價與庫存後導向平台 checkout；外部商品仍只保存 click／lead 邊界。

## 實際修改

- 商品槽可將同 vendor、active、`fulfillmentTypeConfirmed`、`priceCents > 0`、`inventory > 0` 且沒有外部 checkout URL 的商品解析為 `/checkout/{vendorId}/{productId}`。
- 未確認履約、售罄、零價格、inactive、unsafe URL 或跨 vendor 商品一律回到 missing state，不輸出可購買連結。
- 公開夥伴頁清楚標示「平台安全結帳」或「外部連結」，並分別說明平台訂單與外部付款的責任範圍。
- 公開商品 click 仍先建立 server-resolved `TeamClickAttribution`。沒有 active affiliate code 時，也可使用同 visitor、同 vendor、DB 驗證過的 team click clue 保存 `affiliateClickId` 至 checkout metadata。
- Payment webhook 的 paid 事件會優先採用 verified lead snapshot；沒有 lead 時，以 server-owned team click snapshot 建立 immutable `TeamConversionAttribution`。
- Checkout page、admission API 與 final checkout API 都新增 `priceCents > 0`，direct URL 無法繞過零價格 fail-closed 條件。
- Active affiliate 仍需同 vendor、active 且 referral code 相符才可進入 affiliate commission metadata；team click fallback 不會憑空建立 referral code。

## Ownership 與安全邊界

- 公開 page slug、team、promoter、content owner、seminar owner 與 product relation 全部由 server 依已儲存關聯解析。
- 平台 checkout URL 使用 product relation 的 vendor id，且必須與 attribution vendor 完全一致。
- Browser 傳入的 owner、product vendor 或 referral code 都不能決定歸因；checkout 會重新查詢 click、visitor、vendor、active affiliate 或 team attribution。
- 外部 URL 仍限制為無帳密的 HTTP(S)，外部付款不會被標示為 CelebrateDeal 成交。
- 沒有讀取或傳送 `.env*`、Token、Cookie、正式 Secret、正式客戶或付款資料。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T07:40:58.3437508Z`。
- Final related regression：13 test files、`136/136 PASS`、failed=`0`、exit code=`0`。
- 新增與關鍵 cases：平台商品解析、未確認履約／售罄／零價格／跨 vendor fail closed、source-page team click metadata、lead-first／click-fallback conversion、immutable replay conflict。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck`：PASS，exit code=`0`。
- Scoped `git diff --check`：exit code=`0`；只有既有 Windows LF／CRLF warning，沒有 whitespace error。
- Fixed-function score reconciliation：`4/4 PASS`、exit code=`0`；evidence path／SHA-256、固定 inventory、canonical 74.0 與 blocker 宣告都一致。
- 一次較廣測試曾執行 13 files：12 files、131 tests PASS；`src/lib/inventory-reservations.test.ts` 的 7 tests 因目前預設 local test DB 缺少既有 `fulfillmentType` 欄位而 FAIL。該命令 exit code=`1`，沒有把它記為 PASS，也沒有重跑同一失敗命令。
- 本 WP 沒有 schema 或 migration 修改，沒有執行 disposable PostgreSQL。
- 本 WP 沒有執行 Browser、staging、Sandbox 或 Production 操作；未執行項目不列為 PASS。

## Reviewer

- 第一輪唯讀 reviewer 找到 2 個 P1：direct checkout 未拒絕零價格，以及 sourcePage-only team click 無法進入 paid conversion attribution。
- 修正後同一 reviewer 複核兩個 P1 都為 `RESOLVED`，最終沒有未解決 P0／P1。
- Reviewer 保留 1 個 P2：既有 attribution cookie 是 base64url clue，會再經 visitor、vendor 與 DB relation 驗證，但本身尚未使用 HMAC 簽章。
- Reviewer 全程唯讀、沒有修改檔案，也沒有執行測試。

## Source digests

- `6611bd5b7dc4c396c6856a82a33bbeaaf844bce0e72858a472850b659e2486ba  src/lib/team-funnel-product-slots.ts`
- `7db9b3ed0cbb6de14fcece3ad9e52e993be4e62eb52faf6d3c2cf97680099faa  src/lib/team-funnel-product-slots.test.ts`
- `9c8e503b7af9d19e3a012385f1e0ae4ddd097ce64fc33b02872a156fb12e6f60  src/lib/team-funnel-public-page.ts`
- `505749d61c950b6801d699f0061602316eb1d013e7f6beea7701076a032bbbf3  src/lib/team-funnel-public-page.test.ts`
- `b21979233ac5eb9af2fa79f71da3dc9b38ce4a921ee99f9529bc567897082a2a  src/components/team-funnel-public-page.tsx`
- `dd0b909bb8d8d640a7c66c042a47903e9800bdbb0ece200b3543cd3d846b1ba5  src/components/team-funnel-public-page.test.tsx`
- `9a2c15b5a06473d302a27d09dba7e810194a2cce72a30297b9d04d49f897b87d  src/components/tracked-team-funnel-product-link.tsx`
- `449d09f6ee3bc7585f9a41274435faf841c34fc69c36f968a8a8b18b28dc3f14  src/app/api/affiliate-clicks/route.ts`
- `9301fda9bd4a41d7846aff6416b9c5e3837e7fb66451a7bca2a29baa46ba4136  src/app/api/payments/checkout/admission/route.ts`
- `0f0d8fa883bf78bc8cb351c7ced99c0d1d20ad5e01a06ec347d737b1a91f7c3e  src/app/api/payments/checkout/route.ts`
- `311378bdd8a0ed524e5479cada4946685c2e81fc1a1b9a237253ed14b31c2265  src/app/checkout/[vendorId]/[productId]/page.tsx`
- `2cdc0ff101ceee44a1c07831c09b0bde89ffd97ee3ce7e08e50eee5b0e9c0c9f  src/lib/payment-webhooks.ts`
- `e51d2907c762d9c1a0fba723201bad969fe7133a30fec90429f9afb85b60b1f0  src/lib/payment-webhook-team-conversion.test.ts`

## 分數判斷

- 固定功能 `Checkout／付款`：`8.0 → 8.2`。
- 固定功能 `團隊漏斗／Stream／營運後台`：`8.3 → 8.5`。
- 提升來源：內建平台商品可從夥伴頁進入可追蹤 checkout，direct URL 與漏斗入口共用可售條件，無 affiliate code 的合法 B page 也能保存 paid conversion snapshot，外部商品責任邊界仍清楚。
- Latest canonical total 維持 `74.0`。這份本機功能證據不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 保持 blocker，不阻擋其他產品工作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 人工與外部 blocker

- 本 WP 沒有新增需要使用者立即處理的事項。
- CAT04 仍需 fresh staging／PayUni Sandbox provider 與 reconciliation evidence。
- CAT10 仍需真人法律、隱私、退款、財務、客服 SLA、release acceptance 與外部監控交付。

## 回滾範圍

- 回滾範圍限於 team-funnel product resolver／public page、affiliate click cookie issuance、checkout sellability／metadata、paid team conversion reconciliation 與對應 tests。
- 沒有 schema、migration、外部服務或正式資料副作用。
- 若只回滾 public link 而保留 webhook fallback，不會影響既有 lead conversion；完整回滾應移除 click-fallback metadata 與 reconciliation 的同一 scope。

## 下一個最高價值工作

補上 attribution cookie HMAC 與版本化驗證，讓 cookie clue 除了 visitor／vendor／DB relation revalidation 外，也具備 tamper evidence；同時保留舊 cookie 的明確失效策略與不影響 checkout 的 recovery。
