# AI Team vNext Architecture

AI Team vNext 使用一份共享 policy、一個純函式 router、一個薄 MCP adapter，以及一個共用的 bounded wrapper。Lite、Standard、Pro 是能力上限，不是三套獨立 orchestration。

```text
invocation / host task
  → selector + structured signals + runtime quota
  → routing.py: validate → classify → MODEL_ROUTING → MODEL_FALLBACK
  → route decision: model / effort / team / review / limits
     ├─ MCP route_task: recommendation-only，交還既有 host
     ├─ native Codex model: 由 host 明確 handoff
     └─ agy review/QA: shared wrapper → discovery → bounded read-only process
```

## 元件責任

- `routing-policy.json` 是模型 registry、risk table、routing、fallback、limits 與 review contract 的唯一政策來源。
- `routing.py` 只做 deterministic validation/classification/selection，不讀 secret、不連網、不 spawn。
- `server.py` 維持既有 MCP 七個工具與 Goal lifecycle；`route_task` 只產生可追溯建議。
- `Invoke-AiTeamTask.ps1` 負責一次 route、一次精確 discovery、bounded provider process、review schema validation 與 honest handoff receipt。
- 舊 `Invoke-Agy*` 與 read-only failover 檔名保留為相容薄 wrapper，不再各自保存模型階梯。
- Reviewer 只回報 findings；Developer 依 handoff 修正，修正後只驗證受影響範圍，除非風險要求 full regression。

## Team 行為

Lite 以 Luna 為主，Standard 可使用 Sol 與 Sonnet，Pro 才開放 Astra/Opus；每次仍依 task signals 選最低足夠模型。Pro 執行簡單任務時不會固定啟動 Astra 或 Opus。設定與 handoff 必須分別標記 requested、resolved、observed；Router 單獨只能產生前兩者。

Risk 會覆蓋 complexity：Payment、Auth、RBAC、Security、Production data、Migration、Revenue sharing 等 Critical 類別需要 Critical review，即使只改一行。Gemini 是廣域 QA/candidate reviewer，不是重大架構或金流的最終裁判；Claude 用於深度判斷，Opus 限定 Critical 工作；沒有 agy 時以 Codex fallback 完成必要 native handoff。

## 邊界與防護

`AI_TEAM_CHILD=1`、`parent_depth>0`、`dispatch_count` 超過 policy 或 automatic spawn=false 時，不允許遞迴派工。最大深度 1、平行 2、總 dispatch 4；每個模型最多嘗試一次。External process 有 timeout、stdout/stderr 上限、cleanup 與 sanitized failure receipt。

所有敏感資料、正式資料庫、正式付款與 Production deployment 仍由既有安全規則禁止。受保護 `.agents`、`.codex` 或 `.git` 路徑若因環境權限無法同步，必須在 validation receipt 標為 blocked，不能用其他工具繞過。

政策詳見 [`routing-policy.json`](../../.ai-team/config/routing-policy.json)，驗收詳見 [`ai-team-vnext-plan.md`](../ai-team-vnext-plan.md)。
