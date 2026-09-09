---
name: ai-team-style
description: CelebrateDeal 專用前端 UI/UX 商業級風格模式與極限省額度工作流。專為 Dashboard、銷講軟體、Bento Grid、階梯漏斗與高階資料視覺化量身打造。
---

# AI Team Style: 商業級前端視覺與極限省額度模式

CelebrateDeal 的 `ai-team-style` 是專為提升專案 UI/UX 至商業產品水準（Stripe / Linear / Dub.co 標準）而設立的專案風格模式。

它的核心理念是：**「嚴格禁止昂貴模型無中生有胡亂發明設計；以開源商業模板為骨架，讓便宜模型進行填空，達到最高美感與最低 Token 消耗。」**

---

## 隊伍陣容與額度控管矩陣

- **主視覺規劃（Planner）**：`gemini-3.8-flash-high`（零額度焦慮、百萬 Context，負責拆解視覺層級、佈局與推薦開源模板）。
- **樣式實作者（Worker）**：`gpt-5.6-luna`（**解除 high 鎖定，強制限制在 `low` ～ `medium` 推理**，專心組裝 JSX/Tailwind，省 70%+ 思考 Token）。
- **困難結構修復（Worker Deep）**：`gpt-5.6-terra`（`medium` 推理）。
- **審核防線（Reviewer）**：
  - **日常 UI / CSS 調整**：直接走 **Tier 3 Skip Review**，依賴本地 `npm run typecheck` 與 targeted tests，省 85%+ 額度。
  - **重要燈塔里程碑驗收**：可選單次調用 `claude-sonnet-4-6` 進行 1-shot 視覺對抗審核。

---

## 前端商業級設計鐵律（Design Standards）

當前模式下，所有 UI 產出必須遵循以下規範：

### 1. 視覺層級與數字排版（Visual Hierarchy & Typography）
- **核心關鍵數據**：`text-3xl font-bold tracking-tight text-slate-950 font-mono` 或標準 `tabular-nums`，數字在動態跳動時絕不位移。
- **次級標籤**：`text-xs font-medium uppercase tracking-wider text-slate-500`。
- **趨勢漲跌晶片（Delta Pill）**：微飽和膠囊標籤（如 `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold`，上升採 `bg-emerald-50 text-emerald-700 border border-emerald-200/60`，下降採 `bg-rose-50 text-rose-700 border border-rose-200/60`），並搭配微型箭頭圖示。

### 2. 材質、表面與陰影（Surface, Elevation & Border）
- **微漸層卡片底色**：
  `bg-gradient-to-b from-white to-slate-50/50 border border-slate-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:border-slate-300 hover:shadow-sm transition-all duration-200`
- **圓角與留白**：主卡片一律 `rounded-xl` 或 `rounded-2xl`，內距保持 `p-5` 或 `p-6`，呼吸感充足。

### 3. Bento Grid 節奏佈局
- 儀表板嚴禁大小一致的平鋪卡片。
- 核心焦點（如播放 session、即時成交總額）佔 `col-span-2` 或 `row-span-2`，搭配右上角淡色 Lucide 水印圖示。

### 4. 銷講軟體（Webinar / Sales Pitch）專屬動態
- **即時脈衝（Live Pulse）**：右上角標註即時連線信號燈（`span class="relative flex h-2 w-2">...animate-ping bg-emerald-400`）。
- **階梯式轉換漏斗（Step Funnel）**：將純進度條升級為流向階梯卡片，清楚標示各環節流失率（Drop-off %）與轉化爆發點。
- **骨架屏 1:1 同步**：載入時的 Skeleton 必須與實體卡片幾何形狀一致，具備流光微動態（shimmer pulse）。

---

## 開源模板填空法（Template Filling Strategy）

遇到複雜圖表、表格或卡片時，按此三步驟執行：
1. **挑選模板**：優先參考 [Tremor Raw](https://tremor.so)、[shadcn/ui blocks](https://ui.shadcn.com/blocks) 或 [21st.dev](https://21st.dev) 的現成 Tailwind JSX。
2. **提取結構**：提取其容器架構、圓角、微漸層與 Grid 分佈。
3. **替換資料**：由低推理 Worker（Luna low 或 Gemini Flash）直接填入專案的 Prisma/API 變數，零昂貴推理浪費。

---

## 模式切換與使用指令

- **切換至風格模式**：
  - 終端機執行：`.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-style`
  - 或向代理說：「**請使用 ai team style 模式**」或「**use ai-team-style**」。
- **查閱所有隊伍清單**：
  - 終端機執行：`.ai-team/scripts/Switch-AiTeamMode.ps1 -List`
