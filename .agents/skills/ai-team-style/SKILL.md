---
name: ai-team-style
description: CelebrateDeal 的 UI/UX 視覺偏好入口；能力與模型路由沿用 Lite policy。
---

# AI Team Style

這是 Lite 的視覺偏好 adapter，不建立第四套模型政策。開始前讀取 `.ai-team/config/routing-policy.json`、`docs/ai-team/ROUTING.md` 與本檔的設計規範；以 `requested_team=ai-team-lite` 呼叫共享 router。簡單 UI 由 Luna 優先，真正困難的結構由 router 建議 Sol；不要固定 Gemini planner、Claude review 或 skip review。

## Design standards

- 核心數據使用清楚的視覺層級，例如 `text-3xl font-bold tracking-tight text-slate-950 font-mono` 或 `tabular-nums`。
- 次級標籤使用 `text-xs font-medium uppercase tracking-wider text-slate-500`。
- Delta pill 使用低飽和背景、清楚的上升/下降色彩與小型箭頭。
- 卡片優先使用 `rounded-xl`/`rounded-2xl`、充足內距、微漸層與細邊框；避免無層次的平鋪卡片。
- Dashboard 使用 Bento Grid 節奏，核心焦點可占 `col-span-2` 或 `row-span-2`。
- Webinar/sales UI 保留 live pulse、階梯 funnel 與幾何一致的 skeleton。

## Template filling

遇到複雜圖表、表格或卡片，優先參考 [Tremor Raw](https://tremor.so)、[shadcn/ui blocks](https://ui.shadcn.com/blocks) 或 [21st.dev](https://21st.dev)，再以專案資料替換模板。不要為視覺任務自行啟動高階模型或複製完整 routing 規則。

## Safety

遵守根目錄 `AGENTS.md`、單一 writer、敏感資料限制、review contract、recursion guard 與共享 fallback。切換入口仍使用 `.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-style`，selector 只改 mode，不熱切換目前工作。
交付前沿用 Lite 的 MCP `assess_task` 驗收；畫面回覆或模型自述不能代替測試與證據。
