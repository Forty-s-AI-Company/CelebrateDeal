# Funnel 最終整合／Release Evidence（2026-09-17）

> 狀態：`PASS（本機／disposable 範圍）`。四 Goal final journey、operations、進階元素、migration replay、production build、typecheck、完整 ESLint 與 Funnel targeted tests 已完成；不代表 Production deployment 或正式付款驗收。

## 1. Scope 與 release gate

- 產品範圍：四種 Funnel Goal、Landing Page／Funnel editor、Elements、Blocks、Popup、Page settings、Funnel secondary tabs、公開 renderer／表單／checkout／Webinar handoff。
- 參考基準：[`parity-matrix.md`](../../product/systeme-reference/parity-matrix.md)；systeme.io 的帳戶配額、品牌及未實測 Webinar 行為不移植為 CelebrateDeal 規則。
- 應用與四 Goal 整合驗證使用 source-only mirror、loopback disposable PostgreSQL、synthetic fixtures。Advanced elements 是不連資料庫的 browser-only harness，以明確 process allowlist 啟動；兩者均不得讀取或載入 `.env*`，不得接觸正式資料、正式付款、正式寄信或 production deployment。
- Release gate：typecheck、ESLint、Funnel targeted／integration tests、browser E2E、production build、accessibility／keyboard／mobile overflow／基本效能，以及 migration schema 驗證均需填入實際命令與結果後，才可判定整合完成。

## 2. Architecture contract

| Layer | Canonical contract | Evidence / result |
|---|---|---|
| Editor／Preview／公開頁 | 共用 `FunnelPageDocumentRenderer`；公開頁只讀已發布 immutable `LandingPageVersion` | `PASS`（四 Goal browser replay） |
| Draft／published | `LandingPage.draftContent` 保存草稿；發布建立 append-only version；revision CAS 防止覆寫 | `PASS`（operations CAS + save/reload） |
| Funnel flow | PageDocument schema v1 可含 Funnel flow；Audience／Sell／Custom／Webinar 使用獨立 step page | `PASS` |
| Operations | `LandingPage.operations` 保存營運設定；與 editor 共用 revision CAS | `PASS`（85 integration tests + browser） |
| Public runtime | 先解析 tenant/project scoped、已發布 snapshot，再記錄 visit／submission；deadline、A/B、Webinar／checkout gate 由 server 決定 | `PASS`（synthetic local） |
| Commerce | Funnel checkout 重用既有 admission／Checkout API／結果頁；server 重新核價，瀏覽器事件不構成付款證據 | `PASS`（既有 local contract；未執行正式付款） |
| Security boundary | schema parser fail closed；不信任 client step／revenue／submission；Raw HTML、tracking、reCAPTCHA、正式付款依 capability 狀態隔離 | `PASS`（Raw HTML sandbox／capability negative path） |

## 3. Schema 與 migration evidence

### 3.1 既有模型合約

- `LandingPage`：`vendorId`、`projectId`、`slug`、`draftContent`、`status`、`publishedVersionId`、`revision`、nullable `operations`；公開讀取不使用 draft。
- `LandingPageVersion`：append-only `content`、`formId`、`liveId` 與 page/version unique constraints。
- `FunnelVisit`：server-delivered `stepId`／`logicalStepId`、opaque `visitorId`、optional `experimentId`／`arm`；不接受 client revenue。
- `FunnelSubmission`：server-validated `FormSubmission` 的 `submissionId`、page／step／optional visit binding；重複提交不改寫來源。
- `AutomationRule.funnelPageId`：nullable funnel scope；既有 vendor-wide rule 行為不得被改寫。
- Commerce source：`PaymentTransaction.metadata.funnel.pageId/stepId` 與 `CommerceOrder.primaryPaymentTransaction`；Sales 排除 `isTestOrder`。
- Inventory source：nullable `InventoryReservation.items` 保存 server-owned 多品項 snapshot；歷史 `null` 依舊主商品相容處理。

### 3.2 Funnel migrations

| Migration | 內容 | 驗證結果 |
|---|---|---|
| `20260913100000_landing_pages` | `LandingPage`／`LandingPageVersion`、索引、tenant/project／form／live foreign keys | `PASS`（87 migrations replay） |
| `20260917093000_inventory_reservation_items_snapshot` | additive nullable reservation items snapshot | `PASS`（87 migrations replay） |
| `20260917100000_funnel_runtime_attribution` | `LandingPage.operations`、`FunnelVisit`、`FunnelSubmission`、`AutomationRule.funnelPageId`、索引／FK | `PASS`（87 migrations replay） |
| 既有相關 migration | Registration form blocks／Live／commerce 依產品文件及 schema 合約整合 | `PASS`（87 migrations replay） |

Migration gate 必須確認：只做 additive SQL、無 backfill 偽造事件、無 DROP／刪除資料；先 migration 再 application，且不得對 production 執行。

## 4. Four Goal integration matrix

| Goal | 端到端範圍 | 來源文件／既有局部 evidence | Final integration |
|---|---|---|---|
| Audience／建立名單 | 建立、template、opt-in／thank-you／inactive steps、表單提交、verification-required thank-you、公開導流 | `parity-matrix.md`、`funnel-editor-implementation.md`、`webinar-funnel-20260917` 類型測試 | `PASS` |
| Sell／銷售 | order form／thank-you／inactive、商品綁定、伺服器核價、order bump／inventory snapshot、safe checkout | `funnel-commerce.md`、`funnel-commerce-20260917/` | `PASS`（本機 contract；不等於正式付款） |
| Custom／自訂 | 空流程、Add step、step types、模板／PageDocument 編輯、公開頁 | `parity-matrix.md`、`funnel-editor-implementation.md` | `PASS` |
| Automated Webinar／自動化 Webinar | registration／thank-you／broadcast／inactive、Live binding、時間邊界、play handoff、deadline | `webinar-funnel.md`、`webinar-funnel-20260917/` | `PASS`（缺播放資源時 fail closed；不宣稱 systeme parity） |

## 5. Capability matrix

狀態定義：`IMPLEMENTED` 代表已有實作與本輪證據；`LIMITED` 代表明確受安全／產品條件限制；`UNVERIFIED` 代表本輪未宣稱可用。

| Capability | 預期狀態 | Final evidence |
|---|---|---|
| Elements：Text／Layout／Form／Button／Checkbox／Image／Video／Audio／Carousel／Countdown／FAQ／Social／Calendar／X share／Survey／Menu／Horizontal line | `IMPLEMENTED`／部分 `LIMITED` | `PASS`（registry／renderer targeted tests；browser node add/edit/move/copy/delete；Carousel keyboard／reduced motion） |
| Elements：Payment／reCAPTCHA／Raw HTML／Tracking／custom code／Affiliate | `LIMITED`／`UNVERIFIED` | `PASS_LIMITED`（Raw HTML sandbox；其餘依 capability fail closed，不宣稱可用） |
| Blocks：九分類、registry 展開為可編輯節點、responsive | `IMPLEMENTED` | `PASS`（registry targeted tests、Blocks 展開、節點操作與 responsive browser replay） |
| Popup：建立／內容／style／auto-delay／button trigger／preview | `IMPLEMENTED` | `PASS`（建立、預覽、關閉、刪除、save/reload） |
| Popup：exit intent／close-button On／跨瀏覽器與 mobile 行為 | `LIMITED` | `PASS_LIMITED`（desktop 單次觸發與 cleanup；mobile 不支援並已揭露） |
| Page Settings：typography／language／background／SEO／responsive／dirty state | `IMPLEMENTED` | `PASS`（targeted tests + desktop/mobile browser override） |
| Funnel Settings：name／canonical slug／currency／revision CAS | `IMPLEMENTED` | `PASS`（operations integration + browser） |
| Automation Rules：scoped form_registered → add_customer_tag、idempotency、CSRF | `IMPLEMENTED` | `PASS`（operations 85-test integration suite） |
| A/B Test：合法權重、穩定 assignment、stop／winner、歷史 identity guard | `IMPLEMENTED` | `PASS`（operations integration + browser） |
| Stats／Leads／Sales：bounded query、tenant isolation、可信來源 projection | `IMPLEMENTED`／Sales 依 paid projection | `PASS`（operations integration + browser；synthetic data） |
| Deadline：IANA timezone、absolute instant、closed／redirect、禁止 submit／checkout | `IMPLEMENTED` | `PASS`（operations integration + browser） |
| 次要分頁與 step menu | `IMPLEMENTED` | `PASS`（operations browser 七分頁；step menu save/reload） |

## 6. Verification command ledger

| Gate | Exact command | Result / receipt | Notes |
|---|---|---|---|
| Typecheck | `npm run typecheck` | `PASS` | Next route typegen + `tsc --noEmit` |
| ESLint | `npm run lint` | `PASS`（0 errors、3 existing warnings） | warnings：`src/components/landing-pages/landing-page-puck-config.tsx:79,85,88` 的 `no-img-element`；未降低 gate |
| Funnel unit／integration | targeted `vitest` file inventory；`node scripts/funnel-operations-disposable-qa.mjs --refresh-build` | `PASS` | 41 files／263 tests；operations 85 tests |
| Migration validation | final／operations disposable runners | `PASS` | 每輪 87 migrations，loopback tmpfs PostgreSQL，cleanup PASS |
| Browser E2E | `node scripts/landing-page-disposable-qa.mjs --final --reuse-build` | `PASS` | 四 Goal 4/4；receipt：`funnel-final-integration-20260917/receipt.json` |
| Operations browser | `node scripts/funnel-operations-disposable-qa.mjs --refresh-build` | `PASS` | revision conflict、reports、A/B、automation、deadline、public submission、tenant boundary |
| Production build | final／operations source-only mirror runners | `PASS` | `next build --webpack`；不代表 deployment |
| Accessibility／keyboard／mobile／performance smoke | `node scripts/funnel-elements-browser-qa.mjs` | `PASS` | 4/4；browser-only harness 使用無 `.env*` source mirror 與最小化環境 allowlist；axe serious/critical=0、keyboard/reduced motion、mobile overflow≤1px、navigation<10s。這是基本 navigation smoke，不宣稱 LCP／正式流量效能 |
| Bundle | isolated final build `.next/static/chunks` inventory | `PASS_WITH_OBSERVATION` | total 4.22 MiB；largest chunk 499.9 KiB，未修改既有 budget |
| Diff／artifact integrity | `git diff --check` | `PASS` | receipts sanitized；最終 commit 前再執行 |

既有局部 receipt 可作為輸入來源，但不得直接替代本表 final integration 結果：`funnel-commerce-20260917/`、`funnel-operations-20260917/`、`webinar-funnel-20260917/`。

`receipt-*.json` 保留本輪迭代 replay 的成功與失敗歷史；各目錄的 `receipt.json` 才是修正完成後的最終結果。`funnel-operations-20260917/browser-diagnostics.json` 與 `operations-failure.png` 是已修復 React hydration #418 的診斷產物，保留它們是為了不抹除失敗證據；最終 operations receipt 為 `PASS`。

## 7. Non-Funnel failures boundary

若整體命令失敗，必須分開列出：

| Failure | Exact file／test／command | Funnel-owned? | Release treatment |
|---|---|---|---|
| 無 blocking failure | — | — | 完整 ESLint 僅有上述 3 個既有 Funnel legacy image warnings，exit code 0 |

非 Funnel 的既有失敗不可被算作 Funnel `PASS`，也不可為了 release evidence 修改無關模組、降低 assertion、skip／exclude 測試或改寫歷史 receipt。

## 8. Known limitations / deployment requirements

- systeme reference 的 Webinar 建立曾受參考帳戶方案阻擋；CelebrateDeal Webinar 是自有規格，不宣稱未實測 parity。
- 正式付款、真實 provider sandbox、正式寄信、production migration／deployment 均不在本 evidence scope。
- Payment 元件只有在合法商品／checkout 前置條件下可用；預覽不付款。Shipping fees 沒有獨立計價模型；Coupon 沿用既有已領取優惠券，沒有手動碼輸入。
- Exit intent 已驗證 desktop 單次觸發與 listener cleanup；mobile 維持明確不支援。reCAPTCHA、Tracking／custom code、Affiliate 未完成各自安全 gate，維持 disabled／unavailable／unverified，不顯示假成功。
- Stats／Leads／Sales 有時間窗、分頁與筆數上限；Leads 不暴露姓名、Email、電話、回答內容。

## 9. Rollback plan

1. 以 exact application checkpoint revert 回復程式；不要使用 destructive reset／clean／restore。
2. 若已在 isolated synthetic DB 驗證 migration，保留 additive columns／tables／來源資料，不做 DROP 或偽造 down migration。
3. 回滾前停止新增多品項 checkout 與新 Funnel runtime writes，讓相容版本完成 pending reservation／transaction；不可讓舊程式誤讀既有多品項 pending reservation。
4. 若退回不支援 Webinar／operations 的版本，先取消發布相關 Funnel；舊 renderer 對未知 JSON 應 fail closed。
5. 回滾紀錄需包含 commit／migration identity、受影響 scope、驗證命令、sanitized receipt 與恢復方式。

## 10. Final sign-off

- Final integration owner：Codex `ai-team-lite`
- Source／workspace parent revision：`d1d2eaba`
- Migration receipt：`PASS`（87 migrations；final/operations disposable receipts）
- Browser receipt：`PASS`（四 Goal 4/4；operations；advanced elements 4/4）
- Non-Funnel failures reviewed：`PASS`（無 blocking failure）
- Release decision：`PASS_LOCAL_DISPOSABLE_SCOPE_ONLY`；Production deployment／正式付款仍未授權
