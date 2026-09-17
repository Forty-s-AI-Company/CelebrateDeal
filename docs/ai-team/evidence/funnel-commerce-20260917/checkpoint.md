# Goal 3：Funnel Sell 安全結帳 checkpoint

## 範圍與完成狀態

模式為 `ai-team-pro`。本 checkpoint 涵蓋本機實作與隔離驗證，不代表真實金流 sandbox 或正式上線驗收已完成。

- 訂單步驟可選擇同商家、同專案的有效商品與相容加購品，設定單頁／兩步驟結帳及額外條款。
- 商品參照保存於可選 `PageDocument.commerce` v1；不保存可信金額、provider、收款 owner 或回跳網址。
- 商品綁定支援 Undo/Redo、儲存重載與換模板保留。預覽不可付款；公開付款元件使用相同 renderer 與伺服器商品投影。
- 既有 Checkout／Order 負責可信核價、admission、冪等與付款結果，不新增假付款成功流程。
- 新交易驗證發布版本及商品 revision。pending 重試不因本單已保留最後一份庫存而誤建新單；來源或條款已改變時仍 fail closed。
- 主品與加購品採同一資料庫交易原子保留庫存，失敗、過期、退款與遲到付款依 immutable snapshot 處理；歷史 null snapshot 不推測加購庫存。

## Work Package checkpoints

1. 商品／文件合約與設定 UI：schema、可信商品目錄、元件 renderer、模板相容性與文件測試完成。
2. Checkout 信任邊界：ownership、價格／版本防竄改、條款、跨專案歸因與 pending 冪等測試完成。
3. 加購庫存：新增 nullable snapshot migration，多品項並發、失敗回滾及 legacy 相容性測試完成；獨立 reviewer 檢查後無剩餘高風險問題。
4. 隔離驗證：source-only mirror、不載入 `.env*`、獨立 Prisma client、新建 loopback PostgreSQL 與 synthetic browser fixtures。完整結果以 `receipt.json` 為準。

## 證據與已修正問題

最終 `receipt.json` 為 **PASS（本機隔離驗證）**：86 個 migrations、285 項單元／整合測試（0 failed、0 pending）、typecheck、production-mode build、1 條完整 browser journey 與 disposable container cleanup 全部通過。加上獨立執行的 112 項 provider 合約測試，共 397 項單元／整合／合約測試通過；不重複加總診斷重跑次數。

瀏覽器驗證涵蓋商品目錄 scope、商品／加購／條款設定、儲存重載、發布、Preview 不收款、公開可信價格、兩步驟、加購總額、API 拒絕非法 payload、503 可行動提示、重試沿用同一 idempotency key、結果頁不誤報付款成功及零 page errors。付款 transport 是 mock，測試全程沒有真實訂單或收款。`commerce-transport-mock.png` 僅含 synthetic fixture；已人工檢視。

應用程式 source SHA-256：`b0ea593a2e3edf561ea5c3ece2b0268a6ccbcc806950c69ca2cb42064fcb6da6`。最終 browser test SHA-256：`99d836946c79e76bdd479521fc9d4be9b455c34340daa5bd15220bc6a0353c47`。歷次失敗 receipt 保留，以免掩蓋診斷過程。

- 第一輪整合測試為 283 通過、2 失敗；原因是驗證 runner 將瀏覽器 E2E 模式帶進 production 防護單元測試。已限定單元測試 `E2E_TEST_MODE=false`，未修改安全斷言，重跑 285 項全數通過。
- Windows 本機 Prisma DLL 被既有開發程序占用，因此 runner 改在 source-only mirror 產生獨立 client；沒有關閉使用者伺服器。`.prisma` 不得 junction 回 workspace，產生前驗證 realpath。
- 86 個 canonical migrations 已於新 disposable DB 套用並驗證。
- 修改範圍 ESLint 通過；隔離 Next typegen 與全專案 TypeScript 檢查通過。
- 另於相同應用程式 source digest 的 source-only mirror，以獨立乾淨測試環境執行 `vitest run src/lib/payment-providers`：6 個檔案、112 項合約測試全數通過（PayUni、Stripe、ECPay、ECPay-like、demo、types），沒有對外付款。
- Production-mode `next build --webpack` 通過。後續僅調整 browser test selectors 的執行使用 source digest 相同的建置，仍重新跑 migrations、285 項測試與 typecheck；瀏覽器最終結果請見 receipt。
- Browser 診斷已確認 App Router 隱藏串流片段會讓 `getByLabel` 命中隱藏副本，巢狀網址前綴、select options 與 textarea 初始文字也會影響 label 字串。改用 accessible role + 唯一名稱定位；沒有 `force`、移除可見性檢查、放寬業務斷言或改寫頁面 DOM。
- 後續整段業務 journey 已通過，但零瀏覽器錯誤 gate 抓出兩個 React #419。最後取得的 error digest 為 `CSS failed to load`：既有編輯器建置 CSS 含 `https://rsms.me/inter/inter.css` 的外部字型匯入，被測試的全外連封鎖中止。測試只對這個 exact URL 提供 inert local CSS fixture，其餘外部請求仍封鎖；沒有忽略 React 錯誤、開放金流外連或修改產品 CSS。這輪不驗證遠端字型服務可用性。

## 尚未完成的 release evidence

真實金流商 sandbox 的成功／失敗／取消回跳證據尚未執行。瀏覽器 transport mock、API 單元測試及本機 PostgreSQL 測試不是 provider sandbox 證據，因此 Goal 3 不標記為完整驗收通過。

現有 `.github/workflows/secure-staging-validation.yml` 僅允許受保護 `master` 上的固定 task，且需要 exact source SHA 與相符 Preview deployment lineage。本 checkpoint 只有本機變更，沒有部署這個版本，也不會拿其他部署或舊 sandbox receipt 冒充此次結果。下一步須將此版本帶入符合規範的 Preview 驗證流程，再由受保護 trusted runner 產生 sanitized receipt；若固定 task 未涵蓋 Funnel 路徑，須先依既有政策審查、合併相應驗證合約，不能在 feature branch 直接取得 Secret。

功能限制：手動優惠碼、獨立運費規則、週期訂閱不在本次已完成能力內。Coupon 沿用現有領券折抵；運費不額外加收，介面明示配送成本需含於售價。這些不是 systeme.io 帳戶配額。

## Migration 與回滾

新增 `20260917093000_inventory_reservation_items_snapshot`，只增加 `InventoryReservation.items JSONB NULL`。尚未套用至使用者現有開發資料庫、staging 或 Production。實際啟用新程式前需依部署流程套用新增欄位並重新產生 Prisma client。

程式回滾前先停止新增多品項結帳，讓多品項 pending reservations 由相容版本處理完畢；不可直接退回只辨識主品的舊程式。nullable 欄位可保留，不執行破壞性 down migration。

沒有正式付款、正式寄信、Production 資料操作、push、merge 或部署。既有 push／PR CI 已包含 ESLint 與單元測試，未新增重複 workflow 或降低門檻。

## 主要修改檔案

- `src/lib/funnel-commerce*.ts`、`funnel-page-document.ts`、`funnel-step-pages.ts`、`funnel-template-*.ts`。
- `src/lib/landing-page-service.ts`、`commerce-checkout.ts`、`inventory-reservations.ts` 及對應測試。
- `src/app/api/payments/checkout/route.ts` 與測試；`src/app/lp/[slug]/[stepPath]/checkout/` 與公開頁路由。
- `src/components/landing-pages/` 商品設定／元件、共用 renderer、編輯器、公開頁／Popup；workspace 與既有 CommerceCheckoutForm。
- `prisma/schema.prisma`、新增 migration、`scripts/funnel-commerce-disposable-qa.mjs`、commerce E2E／fixture。
- `docs/product/funnel-commerce.md`、本 evidence 目錄與 `.ai-team/config/router.json` 模式切換。
