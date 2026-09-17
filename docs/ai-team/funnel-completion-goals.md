# Funnel 未完成範圍 Goal 任務提示詞

本文件用來接續 `systeme-reference` Funnel 專案。依下列順序執行；前一個 Goal 的資料合約與測試通過後，才進入依賴它的下一個 Goal。每個 Goal 開始時先執行指定模式切換命令。

## 共用執行規則

- 保留既有架構與使用者變更，不使用 `reset`、`clean`、`stash`、`restore`、`checkout` 或 `rebase`。
- 不讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 不操作 Production、正式付款、正式寄信或正式資料庫。
- 不把 systeme.io 的帳戶配額、品牌、商標或方案限制複製成 CelebrateDeal 產品規則。
- systeme.io 實測只作為資訊架構與互動參考；未實測細節必須以 CelebrateDeal 現有資料模型與產品能力定義，並清楚記錄差異。
- 不建立假的成功流程。外部服務只能使用 mock、sandbox、loopback 或 disposable 資源。
- 不降低型別、測試、assertion、coverage threshold 或安全驗證。
- 每個 Work Package 完成後跑相稱的 typecheck、ESLint、targeted tests；里程碑再跑 integration、E2E 與 production build。
- 每個 Goal 最後建立限定範圍 checkpoint commit，回報實際測試結果、限制與 commit hash。

---

## Goal 1：完成 Evergreen Webinar Funnel

**模式：`ai-team-pro`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-pro
```

**適配原因：** 牽涉 Funnel、Live、排程、公開播放、資料合約與跨模組狀態，屬於高複雜度端到端架構工作。

### 可直接使用的任務提示詞

```text
請使用 ai-team-pro 模式，完成 CelebrateDeal 第四種 Funnel Goal「自動化 Webinar」。這是實際開發任務，需完成資料模型、建立流程、編輯器、公開頁、測試與 checkpoint commit。

產品基準：
- 四個 Funnel Goal 必須同時存在：建立名單、銷售、自訂、自動化 Webinar。
- systeme.io 僅作為資訊架構與互動參考，不複製其帳戶配額、品牌或方案限制。
- 先完整閱讀 docs/product/systeme-reference 中所有 Webinar、Funnel goal、step、editor 與 parity 文件，再盤點 CelebrateDeal 既有 Live、Video、Registration Form、Landing Page 與公開播放能力。
- systeme.io 未實測成功的 Webinar 細節不得冒充 parity；請以 CelebrateDeal 現有 Live 架構建立清楚、可驗證的產品行為，並在文件記錄差異。

必做：
1. 啟用「自動化 Webinar」Goal，不顯示開發中或方案限制。
2. 建立可驗證的 Webinar Funnel 預設 Steps，至少涵蓋報名頁、感謝頁、播放／重播頁與 Inactive 系統頁。
3. 每個 Step 保存獨立 PageDocument，支援名稱、URL、模板、排序、Undo／Redo、Save／reload。
4. 建立 Webinar 專用可編輯模板，內部必須展開成一般節點。
5. 串接 CelebrateDeal 既有 Live／Video／Registration Form 選擇器，不複製正式資料，也不建立假的場次。
6. 提供排程、時區、重播可用期間與公開播放導向；所有狀態需可序列化與驗證。
7. Preview 與公開 renderer 共用渲染核心，支援 desktop/mobile。
8. 加入 schema、history、save/reload、public route、排程與 browser E2E 測試。

驗收：
- 使用者能選 Webinar Goal 並成功建立 Funnel。
- 預設 Steps、頁面與公開 route 都能儲存、重載、預覽與發布。
- 報名後可安全導向下一步；播放頁只使用已授權的 CelebrateDeal Live／Video 資源。
- 未設定必要資源時顯示可行動錯誤，不製造假的 Webinar 成功狀態。
- typecheck、ESLint、targeted tests、integration/E2E 與 production build 有真實結果。
```

---

## Goal 2：完成 Funnel 核心 CRUD、Step Auto-save 與表單提交

**模式：`ai-team`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team
```

**適配原因：** 涉及 revision、併發覆寫、表單 API、tenant boundary 與資料一致性，需要高階架構與安全審查，但範圍比 Webinar 收斂。

### 可直接使用的任務提示詞

```text
請使用 ai-team 高階模式，完成 CelebrateDeal Funnel 核心資料流程：Funnel 刪除、Step metadata auto-save、公開表單提交與 next-step 導向。

必做：
1. 新增 tenant/project scoped Funnel 刪除 service、server action、二次確認、清單即時更新與測試。
2. Step 名稱、URL、排序、新增與移除採 bounded auto-save；canvas 內容仍維持明確手動 Save。
3. Auto-save 必須使用 revision/CAS，處理 debounce、連線失敗、衝突提示與重試，不得靜默覆寫。
4. 將 Form、Form input、Checkbox、Button 串接既有安全的 Registration Form／submission API。
5. 加入 required、Email 格式、同意欄位、loading、成功、失敗與重複送出防護。
6. submit_form 成功後依設定顯示成功狀態或導向已驗證的 next_step。
7. 不正式寄信；通知行為只使用既有測試邊界或保持停用。
8. 建立 service、action、concurrency、serialize、reload 與 Playwright E2E 測試。

驗收：
- Funnel 可安全刪除，其他 tenant/project 無法操作。
- Step metadata 離焦或 debounce 後可重載保留，衝突不會覆蓋新版本。
- 公開表單能產生真實本機／disposable submission，錯誤時不前進。
- 成功提交可導向正確 Funnel Step。
```

---

## Goal 3：完成商品與付款元件安全整合

**模式：`ai-team-pro`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-pro
```

**適配原因：** 涉及金流、商品 ownership、價格、訂單與 webhook 邊界，屬於最高風險工作。

### 可直接使用的任務提示詞

```text
請使用 ai-team-pro 模式，將 Funnel Sell 元件安全串接 CelebrateDeal 既有商品、價格與付款架構。只能使用本機 fixture、sandbox 或 disposable 資源，禁止正式付款。

必做：
1. 先審查 Product、Price、Checkout、Order、Payment provider 與 tenant/project ownership 合約。
2. 為 Order Form Step 建立商品／方案選擇設定，不允許前端自行提交可信價格。
3. 完成 Offer price、Payment method、Payment button、Coupon、Order bump、Shipping fees、Physical product、Agreement 與 Two-step order form 的可用條件與 renderer。
4. 所有金額、幣別、商品狀態與付款資格由 server-side trusted data 重新解析。
5. 缺少商品或付款設定時 fail closed，顯示明確可行動狀態。
6. 支援 sandbox checkout initiation、成功／失敗／取消回跳與 idempotency；不得偽造付款完成。
7. 編輯器、Preview 與公開頁不得洩漏 Secret、Token、Cookie 或付款資料。
8. 建立 ownership、tampering、idempotency、sandbox contract 與必要 E2E 測試。

驗收：
- Sell Funnel 可選既有有效商品並呈現可信價格。
- 修改前端 payload 不能改變實際商品、金額、幣別或收款 owner。
- sandbox 成功與失敗路徑都有可追溯 evidence。
- Production payment 維持未授權且未執行。
```

---

## Goal 4：完成 Funnel Automation、A/B、Stats、Leads、Sales 與 Deadline

**模式：`ai-team-pro`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-pro
```

**適配原因：** 多個資料域共享事件、歸因與統計語意，需要端到端一致性與跨模組推理。

### 可直接使用的任務提示詞

```text
請使用 ai-team-pro 模式，將目前只有空狀態的 Funnel 次要分頁完成為可用功能：Automation Rules、A/B Test、Stats、Leads、Sales、Deadline Settings 與 Funnel Settings。

必做：
1. 先定義可持久化 schema、migration 計畫與事件來源；不得直接執行破壞性 migration。
2. Automation Rules 支援最小可用 trigger/action，沿用既有 automation 架構與安全邊界。
3. A/B Test 支援 control/variant、權重驗證、穩定分流、停止與 winner 狀態。
4. Stats 使用可信事件計算 page view、submission、step conversion 與 drop-off。
5. Leads 顯示 Funnel 來源、Step、時間與可追溯 submission，不暴露不必要個資。
6. Sales 僅使用可信 Order／Payment projection，不以 client event 宣稱成交。
7. Deadline 支援明確時區、截止行為與過期導向，SSR/client 結果一致。
8. Funnel Settings 提供名稱、domain/slug、currency 與必要全域設定，包含 revision 衝突處理。
9. 建立 deterministic assignment、aggregation、tenant isolation、concurrency 與 E2E 測試。

驗收：
- 每個分頁都能建立、修改、儲存、重載，不再只是 capability 文字。
- A/B 分流穩定且權重總和合法。
- Stats、Leads、Sales 都能追溯到可信來源。
- Deadline 到期前後行為有時區測試與公開頁驗證。
```

---

## Goal 5：完成進階 Elements、Popup Exit Intent、Tracking 與 Affiliate

**模式：`ai-team`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team
```

**適配原因：** 以安全渲染、瀏覽器事件與外部程式碼隔離為主，需要高階安全判斷。

### 可直接使用的任務提示詞

```text
請使用 ai-team 高階模式，完成 Funnel 尚未可執行的進階 Elements 與頁面能力，同時維持後台隔離與 CSP 安全。

必做：
1. Calendar 串接既有 Consultation/Event availability，支援日期、時段、時區與不可用狀態。
2. Survey 支援答案驗證、提交與結果保存；不得混入未授權個資。
3. Carousel 完成可操作切換、鍵盤、ARIA、觸控與 reduced-motion。
4. reCAPTCHA 只有在 CelebrateDeal 已有安全 server verification 與網域設定時才啟用；否則保留明確 unavailable。
5. Popup Exit Intent 完成 desktop trigger、單次觸發、preview、cleanup 與 mobile 不支援狀態。
6. Tracking／自訂程式碼使用隔離策略、allowlist、CSP 與輸入清理，script 不得影響管理介面。
7. Affiliate 只串接 CelebrateDeal 現有可信 attribution；沒有可信資料時不顯示假的歸因。
8. Raw HTML 必須 sandbox／sanitize，Preview 與管理介面隔離。
9. 建立 XSS、URL scheme、focus、keyboard、event cleanup 與 browser tests。

驗收：
- Calendar、Survey、Carousel 在公開 renderer 真正可操作。
- Exit Intent 有可重現的 browser evidence。
- 不安全 HTML、URL 與 script 無法逃逸到後台。
- reCAPTCHA、Tracking、Affiliate 的可用狀態完全由 CelebrateDeal 自身能力決定。
```

---

## Goal 6：補齊 Templates／Blocks 視覺變體與商業級 UI

**模式：`ai-team-style`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-style
```

**適配原因：** 主要是視覺模板、responsive、元件組裝與 UI polish，適合低成本視覺專用模式。

### 可直接使用的任務提示詞

```text
請使用 ai-team-style 模式，補齊 CelebrateDeal Funnel Templates 與 Blocks 的商業級視覺變體。沿用現有 registry、PageDocument、renderer 與品牌設計系統，不新增第二套渲染架構。

必做：
1. 盤點九個 Blocks 分類與現有模板，建立缺口矩陣。
2. 每類補足有實際產品用途的視覺變體；所有 Block 拖入後必須展開為可獨立編輯節點。
3. 補齊 Audience、Sell、Custom、Webinar 的模板 gallery、縮圖／preview、分類與空狀態。
4. 完成 desktop/mobile responsive、長文、空資料、錯誤、loading、focus 與鍵盤狀態。
5. 使用 CelebrateDeal 品牌與自然台灣繁中，不複製 systeme.io 文案、Logo 或視覺品牌。
6. 不改變付款、表單與安全合約；只消費已驗證的 props/capabilities。
7. 建立 registry、展開、ID 唯一、renderer snapshot 與必要 visual/browser tests。

驗收：
- 所有分類都有多個可辨識且可編輯的代表變體。
- 模板預覽與套用後畫面一致。
- 手機畫布無水平溢位，焦點與文字對比符合既有 accessibility gate。
- typecheck、ESLint、targeted tests 與 production build 通過。
```

---

## Goal 7：Funnel 最終整合、E2E、效能與文件

**模式：`ai-team-lite`**

```powershell
.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-lite
```

**適配原因：** 功能完成後以機械化驗證、補測、文件與小修為主，適合省額度模式；若發現跨域根因，再切回對應高階模式。

### 可直接使用的任務提示詞

```text
請使用 ai-team-lite 模式，完成 Funnel 全功能最終整合驗證、回歸修復、效能、accessibility、文件與 release evidence。不得新增未授權功能或降低任何測試門檻。

必做：
1. 依 docs/product/systeme-reference/parity-matrix.md 與 CelebrateDeal 已核准差異逐項重驗，不把參考產品帳戶限制當成 CelebrateDeal 規則。
2. 建立四個 Goal 的 browser E2E：建立、模板、編輯、Step、Save/reload、Preview、發布、公開導流、刪除。
3. 覆蓋 node add/edit/move/copy/delete、Undo/Redo、Blocks 展開、desktop/mobile override、Popup 與 Exit 防呆。
4. 覆蓋 auto-save/manual-save、revision conflict、斷線恢復與表單重複送出。
5. 使用 disposable PostgreSQL／loopback；不得碰正式資料。
6. 執行 typecheck、完整 ESLint、Funnel targeted tests、integration tests、Playwright 與 production build。
7. 執行 accessibility、鍵盤操作、手機 overflow、基本效能與 bundle 檢查。
8. 更新架構、schema、migration、能力狀態、測試證據與已知限制文件。
9. 完整專案若有非 Funnel 既有失敗，需列出精確檔案與錯誤，不得誤算 Funnel PASS，也不得順手修改無關模組。

完成條件：
- 四個 Goal 都能建立並走完各自可驗證流程。
- 所有已實作 Elements、Blocks、Popup、Settings 與次要分頁有測試證據。
- 沒有未揭露的 disabled placeholder、假的成功流程或未標示限制。
- 工作目錄乾淨，建立最終限定範圍 checkpoint commit，回報 commit hash 與實際測試結果。
```

## 建議執行順序

1. Goal 1：Webinar Funnel
2. Goal 2：核心 CRUD、Auto-save、表單
3. Goal 5：進階 Elements 與安全功能
4. Goal 3：商品與付款 sandbox 整合
5. Goal 4：Automation、A/B、Stats、Leads、Sales、Deadline
6. Goal 6：視覺模板與 Blocks
7. Goal 7：最終整合與 release evidence

若要降低風險，可將 Goal 3 金流留到其他 Funnel 功能穩定後再開始；Goal 6 可在資料合約凍結後與 Goal 4 的後半段平行執行，但同一檔案仍只能有一個 writer。
