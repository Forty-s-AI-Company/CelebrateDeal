# Funnel systeme.io 流程對齊：AI Team 提示詞

## 建議主模型

- **主模型：GPT-5.6-Sol（high）**
- 原因：這個任務同時牽涉 Next.js App Router、持久化、revision conflict、Funnel state machine、既有 Editor 邊界與 E2E，應由能維持跨檔架構一致性的模型主導。
- 視覺實作交給 **GPT-5.6-Luna（low）**；只負責已確認資訊架構下的 JSX、Tailwind、RWD 與可及性。
- Gemini 3.8 Flash High 可做低成本規劃與畫面盤點。Gemini 3.1 Pro High 在本次實測只有 wrapper 成功、沒有有效輸出，不放入關鍵路徑。
- Claude Sonnet 4.6／Claude Opus 4.6 Thinking 已通過最小可用探測；只在高風險里程碑或對抗性審查使用。

## 自動路由總提示詞

```text
你正在修正 CelebrateDeal 的 Funnel 產品流程。先用 ai-team 處理跨頁流程、資料模型、revision 與路由；進入 JSX/Tailwind/RWD/視覺還原時切換 ai-team-style；完成實作後切回 ai-team-lite 做 typecheck、targeted tests、Playwright 與回歸修正。

唯一正確的使用者旅程：
Funnels 清單 → 建立 Funnel（名稱、網址、Goal、幣別）→ 立即持久化 → Funnel Operations → 依 Goal 與 Step type 顯示相容模板 → 套用模板（Custom 初次建立跳過模板，維持空流程）→ Configuration → Edit Page → 單一步驟 Editor → 返回原本 Configuration。

Operations 必須包含且只以這七個頁籤作為次要導覽：Configuration、Automation Rules、A/B test、Stats、Leads、Sales、Deadline settings。Funnel settings 位於頁首，不得取代 Configuration。左欄管理 Steps；Add step 必須同時選擇 Step type 與「模板／空白」，不可留下半建立狀態。

不要把 Step 管理、模板 Gallery 與全畫面 Editor 混在同一頁。不要讓建立頁直接進 Editor。保留既有 schema、API routes、tenant scope、CSRF、revision conflict 與使用者變更。每個結論需由實際程式、測試或瀏覽器畫面支持。
```

## ai-team：架構與流程提示詞

```text
以 GPT-5.6-Sol（high）主導。先讀本機 Next.js 文件與現有 Funnel contracts，再追蹤 new route、create action、operations service、step mutations、editor route、public runtime 與 E2E。建立明確狀態轉移：created_pending_template、configured、editing。Sell/Audience 首個 Step 等待 Goal-filtered 模板；Custom 初始只有 inactive system page；Webinar 保留既有三頁 runtime 限制。所有寫入維持 CSRF、tenant scope、revisionRef 與 in-flight guard。用最小改動把 Operations 設成唯一管理中心，Editor 只接收 active Step 的 PageDocument。
```

## ai-team-style：畫面提示詞

```text
以 Gemini 3.8 Flash High 盤點、GPT-5.6-Luna（low）實作。參考 systeme.io 的資訊架構與操作密度，不複製品牌。頁首顯示 Funnel 名稱、View Funnel、Funnel settings；左欄固定顯示 Steps 與 Add step；右側固定七頁籤；模板使用可快速掃描的 2～3 欄卡片牆，提供縮圖、完整預覽與套用。確保 Add step 不會被長內容推到頁底，鍵盤焦點、disabled 狀態、44px 觸控區與手機橫向捲動都可用。不要新增與任務無關的儀表板裝飾。
```

## ai-team-lite：驗證提示詞

```text
以 Gemini 3.8 Flash High 規劃檢查清單，GPT-5.6-Luna（medium）修正一般問題。至少驗證：四種 Goal 建立後 URL 為 /landing-pages/:id/operations；Sell/Audience 必須先看 Goal/Step-filtered 模板；Custom 初次沒有模板且可用 Add step 選模板或空白；七個頁籤名稱與順序完全一致；Edit Page 只編輯 active Step；返回後保留同一 Step 的 Configuration；revision conflict、CSRF、tenant scope、公開頁與既有付款/Webinar限制沒有退化。執行 ESLint、typecheck、targeted Vitest 與四 Goal Playwright；不可用 skip、降低 assertion 或只看截圖宣告通過。
```
