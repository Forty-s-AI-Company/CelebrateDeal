# G7-48：數位／課程／服務付款後交付與買家存取

## 結果

- 狀態：`PASS_LOCAL_DISPOSABLE`。
- 產品範圍：商家交付設定、公開 HTTPS allowlist、加密設定、不可變訂單 item 快照、付款後 entitlement、HttpOnly exact-order buyer capability、同源領取頁、legacy fallback、全額退款撤銷與不可用狀態。
- 分數影響：CAT01 `8.0 → 8.5`，canonical total `74.0 → 74.5`。CAT04 `6.0`、CAT10 `4.5` 不變；不把本機 demo provider 當成 PayUni Sandbox 或真人驗收。

## 最終驗收證據

- 最終 receipt：`docs/ai-team/evidence/g7-48b-buyer-delivery-browser-qa-c0de9982255ebec7.json`
- Receipt SHA-256：`d2cda72dcfd95076343ecf5f33c845101450b34096780822e53cbb7483308768`
- 完成時間：`2026-08-09T16:53:00.986Z`
- 隔離環境：loopback production server、disposable PostgreSQL tmpfs、fresh Prisma generate、51 migrations、無外部操作。
- Phases：mirror、Prisma generate／validate／deploy／status、Next production build、server、Browser 全部 `PASS`。
- Browser：1/1 contract PASS、Axe critical／serious `0`、RWD `PASS`、buyerDelivery `PASS`。
- Cleanup：server、container、tempRoot 全部 `PASS`。

### 截圖與雜湊

- `product-delivery-desktop.png`：`3c07ac9071f698cacc526dbd364ac9051d69342881b8b436054119ce7dc8da0a`
- `product-delivery-mobile.png`：`8b450978d194f9d5197a7334516c14cabc98e86609ae2c68d5bec50782be55b6`
- `buyer-delivery-desktop.png`：`d93d3e34aa9d42fc6a2932ecb157118530be6cf8b0661001fe277142efd331f6`
- `buyer-delivery-mobile.png`：`f492027dfbcb2dcf329b77ae5ac68c2d6c2fa8326784a9c6b8c068dd3cb0445a`
- 人工視覺檢視：四張皆為完整目標頁；最後一張 mobile 已等待內容標題與安全入口完成後才截圖，沒有拿 loading state 充當證據。

## Deterministic checks

- G7-48B targeted：5 files／39 tests PASS（含 app URL、buyer grant／allowlist／解密、退款撤銷、訂單頁與領取頁）。
- 最終 unavailable-state targeted：5 files／31 tests PASS。
- Runner contract：18/18 PASS。
- Scoped ESLint：PASS。
- Scoped `git diff --check`：PASS；僅曾出現 Git 的 LF→CRLF 提示，沒有 whitespace error。
- 本機 `npx tsc --noEmit`：FAIL，原因為工作區 `node_modules` 的既有 Prisma Client 尚未包含新 models；未把此結果標成 PASS，也未原樣重跑。最終隔離 runner 已在 fresh Prisma generate 後完成 Next production build PASS。

## 安全與資料行為

- destination／instructions 使用 AES-GCM，綁定 vendor、product/config/revision 或 vendor、order/item/snapshot；錯誤綁定或竄改會 fail closed。
- 公開頁與訂單主頁只讀安全摘要；只有 exact HttpOnly grant、paid／partially_refunded order、active fulfillment、non-revoked snapshot 同時成立，領取頁才在伺服器解密。
- 解密後再次驗證 HTTPS、hostname 與 pathPrefix 必須和下單時 allowlist snapshot 完全一致；拒絕 credentials、query、fragment、IP、localhost 與內網 suffix。
- 全額退款會撤銷 delivery snapshot 與 entitlement，清除 entitlement access envelope；退款後 unavailable 頁不含入口、交付說明、原始 URL 或加密欄位。
- 舊訂單沒有交付快照時顯示客服 fallback，不假裝可自動交付。

## 失敗證據與修復歷程

- 早期 receipts 保留 schema one-to-one unique、nullable JSON、locator、checkout provider admission、舊 unique key、Axe file-input label、Next streamed notFound status expectation等失敗；沒有刪除或改標 PASS。
- `g7-48b-buyer-delivery-browser-qa-0e1e5e9639a06108.json` 如實保留退款後 HTTP 200 的框架語意失敗；後續改驗證專屬 unavailable UI 與內容零洩漏。
- `g7-48b-buyer-delivery-browser-qa-8052aabbe545057b.json` 雖為 PASS，但人工檢視發現 mobile screenshot 仍是 loading；因此未採為最終證據，增加明確等待後以 `c0de9982255ebec7` 取代。

## 邊界、人工 blocker 與回滾

- 未執行 staging、PayUni Sandbox、Production、正式付款／退款、寄信、deploy、push 或 merge；未重試 FIN-08AA、WP-196、WP-197。
- CAT04 仍需全新的授權 staging／PayUni Sandbox provider reconciliation evidence。
- CAT10 仍需真人法律、財務、客服 SLA、監控與 release owner 簽核。
- 程式回滾範圍：product delivery schema／migration、product actions/form、commerce snapshot、buyer support resolver/pages、refund convergence、runner與對應測試。Migration 為 additive；已部署環境不做破壞性 down migration，若需回復採 forward fix。
