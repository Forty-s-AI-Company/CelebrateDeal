# G7-57 Checkout response-loss recovery closure

日期：2026-08-10（Asia/Taipei）  
狀態：`LOCAL_IMPLEMENTATION_ACCEPTED`  
Canonical readiness：維持 `75.5/100`，CAT04=`6.0`、CAT10=`4.5`

## 產品問題與完成內容

公開 Checkout 原本只把 idempotency key 保存在 React 記憶體。付款請求若已在 server 建立 transaction／order 並扣住庫存，但瀏覽器在收到 response 前斷線或重新整理，下一次送出會產生新的 key。這會讓買家失去既有 checkout 的復原入口，也增加孤兒訂單或重複 checkout 的風險。

- idempotency key 以 `vendorId + productId` scope 保存在 `sessionStorage`；只接受 UUID，跨商品、跨商家或 malformed 值不會被使用。
- Admission API 可接受既有 key，並將 key 綁入 signed admission token；server 仍以 HttpOnly checkout session、vendor、product、product revision 與 key 作為安全邊界。
- 既有 key 只可重發給相同商品的 pending transaction；finished transaction、跨商品或不相符狀態一律 409 fail closed。
- 最後一件庫存已被第一次 request 保留時，頁面 reload 仍可透過有效的 scoped recovery key 顯示結帳表單；沒有有效 key 的新買家維持售罄狀態。
- 425、5xx、network／response loss 保留 key，讓買家可恢復；已知成功與 terminal 409 會清除 key。
- Browser contract 會先讓 server 完成第一次 request，再中止回傳給瀏覽器；reload 後用同一 key 重送，驗證 transaction、order 與 inventory 都不再增加。
- Recovery-only 顯示在 hydration 後從 storage 判定；目前使用 cancellable microtask，避免 effect 內同步 setState，並維持 unmount 安全。

## 驗證證據

### Deterministic／static

- Current-source targeted Vitest：5 files／22 tests PASS。
- TypeScript：`npx tsc --noEmit` PASS。
- Scoped ESLint：exit 0，0 errors／0 warnings。
- Browser QA runner contract：23/23 PASS，包含 G7-57 exact focused contract、source attestation 與 desktop／mobile screenshot requirement。
- `npm audit --omit=dev`：0 vulnerabilities；782 total dependencies。

### Disposable PostgreSQL／production build／Browser

Final receipt：`docs/ai-team/evidence/g7-57-checkout-recovery-browser-qa-c3bd4bab4e7097f2.json`  
SHA-256：`F3075D15453540A6AD6D0A5D807555B4C21A31614FDA1C1597EF0D876C443464`

- runId：`c3bd4bab4e7097f2`。
- Prisma generate／validate／deploy／status PASS；53 migrations applied。
- Next production build、loopback server 與 focused Browser 1/1 PASS。
- Exact contract：`public checkout recovers one committed order after response loss and page refresh` PASS。
- 同一 idempotency key 恢復既有 checkout；reload／resubmit 後 transaction、order、inventory 均未再增加，成功後 storage key 清除。
- Desktop／mobile RWD PASS；Axe critical／serious 0。
- Desktop screenshot SHA-256：`b747736fbe127e9704c61e5dc9903ae6acf91705850abd8bd111a0934d93ab38`。
- Mobile screenshot SHA-256：`7680e47fd7cd078d0c5e494a31707779047fc4ba6ee59ce2e61097ecc277cd64`。
- server、container、temporary root cleanup 均 PASS。
- loopback only、PostgreSQL tmpfs、未讀 `.env*`、未使用使用者 Chrome profile、未執行外部或 Production 操作。

Source lineage 已核對：receipt 記錄的 `src/components/commerce-checkout-form.tsx` SHA-256 為 `b81553c336995d3ec18fddfcffc33cec1692434669f01e868995fa19dbdf9260`，與 final review 時目前檔案完全相符；checkout route、admission route、checkout admission／idempotency library、E2E spec 與 runner 亦由 receipt attestation 綁定。

### 保留的失敗證據

- `g7-57-checkout-recovery-browser-qa-6959042f9d359783.json`：產品 alert 正確，但測試使用 broad role locator，與 Next route announcer 衝突；未算 PASS，已改成 exact `#checkout-live-status`。
- `g7-57-checkout-recovery-browser-qa-fce04b29e38d75ef.json`：第一個 request 保留最後庫存後，reload 只顯示售罄且沒有復原表單；此證據揭露真實產品缺口，完成 recovery-only sold-out gate 後才另取 final PASS。
- `g7-57-checkout-recovery-browser-qa-05efdbe754b736c9.json`：當時 Browser PASS，但後續 lint 修正改變 component hash；reviewer 因 source lineage mismatch 判定 REJECT，未用作 final acceptance。

## AI Team acceptance

- 第一輪 final reviewer：`REJECT`，唯一 P1 為舊 Browser receipt 與目前 component hash 不一致；產品邏輯未發現 P0／P1。
- 以目前 source 重跑完整 focused runner並取得 `c3bd4bab4e7097f2` 後，同一 reviewer 重核 receipt hash與所有關鍵 source lineage，結果 `ACCEPT`。
- Final finding：P0=0、P1=0、P2=0；G7-57 可作為 checkout response-loss recovery 的 acceptance evidence。
- Focused Browser 沒有驗證全產品 tenant isolation、PII envelope 或其他 commerce contracts，這些 `NOT_VERIFIED` 欄位不外推為 PASS。

## 評分、阻擋與回滾

- 固定功能 `checkout_payment`：`8.8 → 9.2`。核心 2.8、錯誤復原 2.0、UX 1.8、完整性安全 1.0、fresh evidence 1.6。
- Canonical CAT04 與總分維持 `6.0`／`75.5`。本機 synthetic checkout、disposable PostgreSQL 與 loopback Browser 不能取代 fresh staging／PayUni Sandbox provider evidence。
- CAT10 真人法務、隱私、退款政策、客服 SLA、財務與 release acceptance 仍 pending，本輪未預支分數。
- 未執行 Production deploy、正式 DB、正式付款／退款、正式寄信、push、merge，也未重跑 FIN-08AA、WP-196、WP-197 禁止路徑。
- 回滾範圍限於 G7-57 checkout admission／idempotency／replay、sold-out recovery gate、相關 tests、focused Browser runner與本輪 evidence；沒有 schema migration。
- 下一個最高產品價值候選：訊息模板表單在 validation redirect 後保存未提交草稿，避免商家輸入內容整頁遺失。
