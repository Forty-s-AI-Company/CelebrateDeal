# CelebrateDeal Agent Rules

## 回覆與技術風格

- 所有回覆使用自然的繁體中文。
- 修改 Next.js 程式前，先閱讀對應的本機 Next.js 文件。
- 直接推進使用者目標；只有安全、授權或不可驗證的阻擋才停下詢問。

## Canonical AI Team vNext

AI Team 的唯一 routing source of truth 是 `.ai-team/config/routing-policy.json`，搭配 `.ai-team/mcp_server/routing.py`、`docs/ai-team/ROUTING.md` 與 `docs/ai-team/handoff-schema.md`。`.agents/skills/*` 與 `.codex/agents/*` 只提供 thin adapter、角色權限與最小必要 context，不得複製模型階梯、fallback table 或完整 prompt。

- `ai-team-lite`：能力上限為 GPT-6 Luna 與已驗證的 Gemini Flash Medium；低風險任務優先單 Agent。
- `ai-team`：額外允許 GPT-6 Sol、Gemini Flash High 與已驗證的 Sonnet；依 task signals 選模型與必要 review。
- `ai-team-pro`：開放全部模型，含 Astra/Opus；Pro 不代表每次使用高階模型。
- `ai-team-style`：Lite 能力上限加上 UI/UX 視覺偏好，不建立第四套 routing。
- Routing 依 complexity、risk、context、task type、duration、surface、production/security/data impact、availability 與 quota 選最低足夠模型；Critical risk 提高驗證與獨立審查底線，不機械指定實作模型。
- Routing 與 fallback 分離。agy failure 必須區分 `AUTH_REQUIRED`、`HOST_PERMISSION_BLOCKED`、`AGY_NOT_INSTALLED`、`MODEL_UNAVAILABLE`、`AGY_RUNTIME_ERROR`，並回到適合的 Codex fallback。
- Native agent descriptor 是 preset；真正 dispatch 必須明示 resolved model 與 effort，且實際觀測不到時記為 unknown。主對話模型不會因子代理路由而改變。
- 明確規格的小中型工程優先 Luna high；難整合與推理由 Sol medium/high 處理。Astra 只在有 `astra_reason` 的例外使用；Medium／Very High 不直接綁模型。
- 使用者的硬性 team cap 不得自動越界。Router 的結果是建議；只有具體執行回報才可填 observed model/effort。沒有 observed 就記 unknown。
- Gemini 只提供廣域 candidate findings/QA；Sonnet 做深度 review；Opus 僅用於 Critical security、Auth、Permission、Payment、Billing、Production data、Migration 或重大爭議。

不要啟動正在被修改的 AI Team 來修改自己。Router/MCP 不 spawn、不呼叫 Codex CLI、不呼叫自己的 MCP；`AI_TEAM_CHILD=1`、`parent_depth>0`、dispatch budget 用盡或 automatic spawn=false 時停止。Pro 的簡單 copy/UI 不得強制 Astra/Opus。

## PRELAUNCH_DEV_AUTONOMOUS

- Goal 可連續處理多個 Work Package，不受固定 30～90 分鐘或固定角色順序限制。
- 主代理負責整合、ownership、evidence 與最終判斷；不要求每個任務都啟動 Planner、Developer、Reviewer、QA 全部角色。
- 不相交 scope 可並行；同一檔案、資料資源或外部資源同一時間只有一個 writer。
- 依風險選 targeted tests、integration、coverage、E2E、staging 或 sandbox；不能把未執行測試標成 PASS。
- Production deployment、正式資料庫、正式付款、退款、寄信與破壞性 migration 仍需額外授權。

## 安全底線

- 不讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 不使用 `reset`、`clean`、`stash`、`restore`、`checkout`、`rebase` 丟棄未知變更。
- 不降低 assertion、coverage threshold 或資料驗證強度；不得用 skip、exclude、刪資料或假 fixture 掩蓋失敗。
- 本機、Preview、staging、固定 Sandbox、disposable PostgreSQL 與 agy 開發驗證不需要逐次 owner authorization；但必須使用非 Production 端點、最小 scope、合成資料，並保存 sanitized evidence。Host/Sandbox permission failure 不得繞過或誤標為 PASS。

## 非 Production 開發執行

- 固定、可審查的本機／Preview／staging／Sandbox runner 可直接執行，不以每次 owner token、一次性 probe 或舊 Work Package attempt budget 作為前置條件。
- Secret 只能由核准的工作階段 process environment、CI Environment 或平台 secret provider 注入；不得列舉 Secret Store、child-process environment、raw logs，也不得讀取或輸出 `.env*` 內容。
- 歷史 evidence／WP 中的 no-rerun、single-attempt 或 authorization 結論只描述當時執行，不形成新工作的全域禁令。新的非 Production 工作仍須驗證目標環境與資料隔離。
- Production deployment、正式資料庫、正式付款／退款、正式寄信與不可逆外部操作仍需另行明確授權。

## 驗證、handoff 與 Git

- Handoff 至少記錄 requested/effective team、selected model、reasoning、fallback events、review plan、ownership、dispatch/depth limits 與下一步。
- Task READY 必須經 MCP `assess_task` 或同一 `assess_acceptance` gate；Goal `goal_finalize` 也受此 gate 管理。路由、handoff、provider 完成與 phase checkpoint 不等於任務驗收。
- Reviewer 只輸出 `BLOCKER`、`MAJOR`、`MINOR`、`NIT` findings，不直接修改 code；Developer 修正後依 risk 驗證受影響範圍。
- 同一根因沒有改善時停止重試，改用明確 fallback 或記錄 blocked。
- 只在有明確授權時建立精確 scope checkpoint；可推送 `codex/*` 並經 protected PR，禁止 force push、default branch 直推與 Production 自動部署。

## 文件優先順序

- Plan：`docs/ai-team-vnext-plan.md`
- Workflow：`docs/ai-team/workflow-policy.md`
- Goal：`docs/ai-team/GOAL-PROTOCOL.md`
- Routing：`docs/ai-team/ROUTING.md`
- Handoff：`docs/ai-team/handoff-schema.md`
- Validation：`docs/ai-team/vnext-validation.md`
