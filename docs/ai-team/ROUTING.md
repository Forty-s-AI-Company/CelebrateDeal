# AI Team Routing

路由是建議，不是固定流程。主代理可依工作價值、風險、可用工具與當前證據選擇角色與模型。

## 動態推理程度

主代理先把任務分成 `trivial`、`routine`、`complex`、`critical`，再選擇足以完成工作的最低合理推理程度。預設落在中間值，避免每次都使用最高成本，也避免為省 token 固定使用最低能力。

| 模型 | 最低 | 最高 | 一般預設 | 難度對應 |
| --- | --- | --- | --- | --- |
| Sol | `low` | `xhigh` | `high` | trivial=`low`、routine=`medium`、complex=`high`、critical=`xhigh` |
| Terra | `low` | `xhigh` | `medium` | trivial=`low`、routine=`medium`、complex=`high`、critical=`xhigh` |
| Luna | `high` | `max` | `high` | trivial/routine=`high`、complex=`xhigh`、critical=`max` |

- `xhigh` 或 `max` 只用於高風險跨域、重大安全／金流／migration、重複失敗後的困難診斷或 release acceptance。
- `low` 只用於真正簡單的唯讀查找、錯字、格式或單行機械修改。
- Browser、Chrome、E2E 與 UI QA 也依實際難度選擇，不固定綁定單一模型或固定推理程度。
- AGY Fast 使用 `gemini-3.8-flash-high`；AGY Deep 維持 `gemini-3.1-pro-high`。
- Native Explorer 維持 `gpt-5.4-mini`，Native Analyst 維持 `gpt-5.4`；普通查找不固定消耗 Luna，但 `complex`／`critical` 任務可由 Router 升級至 `gpt-5.6-luna` read-only。
- Router 的 Reviewer 路由固定指定 `gpt-5.6-terra` read-only，不沿用 Worker 的 workspace-write 權限；Codex App 內建 role binding 仍由 runtime 提供，本 Router 不假稱能改寫平台原生綁定。
- Codex App 的 native role model／sandbox 由 runtime 提供；本 Router 只給出建議與升級條件，不會假稱已改寫 App 內建 role binding。

| 任務類型 | 預設角色 | 可替代路徑 |
| --- | --- | --- |
| planning、architecture、acceptance | Sol | complex／critical plan 可由 Claude Sonnet 4.6 thinking advisory review；額度不足依降級階梯處理 |
| implement、bug fix、一般 cross-file fix | Worker／`gpt-5.6-luna` high | 一般寫入使用 Luna high（解鎖 max 節省思考額度）；維持單一 writer、明確 scope 與 deterministic tests |
| complex implementation、hard debugging | Worker Deep／`gpt-5.6-terra` high | 複雜跨檔與困難診斷使用 Terra；必要時由 Reviewer／Sol 唯讀複核 |
| agy_qa、browser、e2e、ui validation | AGY Fast (`gemini-3.8-flash-high`) | AGY Deep、native Luna、deterministic tests |
| security、release acceptance | Reviewer／`gpt-5.6-terra` read-only | Analyst／Explorer 可在 complex／critical 時升級 Luna read-only；Sol 負責 acceptance |
| staging、sandbox、migration verification | Terra | Sol／Reviewer 提供唯讀複核 |

## 寫入與並行

- 同一檔案、同一資料表或同一外部資源同一時間只允許一個 writer。
- 不相交檔案與唯讀分析可以並行。
- 一般 Worker 使用 Luna high；Worker Deep 固定使用 Terra high。Explorer／Analyst 的 Luna 僅是 complex／critical 時的唯讀升級，不具寫入權限。
- 主代理負責端到端整合、確認 evidence 與處理衝突，具備直接自主執行權限。

## 審查降級階梯與免審機制 (Review Fallback Ladder)

- **日常任務免複審（Skip Routine Review）**：佔 70% 的日常任務（UI、文案、一般 Bug 修復、加單一欄位），通過 `typecheck` 與 targeted unit tests 即可直接提交交付，**跳過任何 AI 複審**以最大化節省 Token 額度。
- **高風險任務四級審查降級鏈**（僅在 `complex`／`critical` 或涉及資安、金流、Migration 時觸發）：
  1. **Tier 1 首選**：`Claude Sonnet 4.6 thinking`（以奧坎剃刀原則審核：嚴禁過度設計、抓真實致命漏洞，防止 Sol 鑽牛角尖）。
  2. **Tier 2 備選（Claude 額度不足時）**：`Gemini 3.8 Flash High`（零額度焦慮、百萬 Context、快速反向防呆把關）。
  3. **Tier 3 備選（若需 GPT 接手）**：`GPT-5.6-Terra (medium)`（客觀嚴謹，嚴禁使用 Sol 自審避免發散）。
  4. **Tier 4 終極防線（額度全竭時）**：直接跳過 AI 複審，以本地型別檢查與 3,134 個單元測試為最終物理防線。
- Review 僅提供建議（advisory），不直接修改檔案，亦不取代 deterministic tests。
- 狀態如實記錄；額度不足、登入阻擋或工具失敗標示為 `NOT_REQUESTED_QUOTA`、`LOGIN_REQUIRED` 或 `TOOL_BLOCKED`，不可標成 PASS。

## AGY fallback

重要工作可自動採用：

1. AGY Fast
2. AGY Deep
3. native-agent Luna

每層都必須回報實際狀態；`TOOL_BLOCKED`、`LOGIN_REQUIRED` 或沒有輸出不得被改寫為 PASS。fallback 不得無限重試同一失敗命令。

## 安全邊界

- 任何角色都不能讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 任何角色都不能操作正式 DB、正式付款、正式退款或正式服務；Production deployment 需要明確授權。
- 任何角色都不能偽造 evidence、降低 assertion／threshold、使用 skip／exclude 掩蓋失敗，或覆蓋使用者既有變更。
- Git 可自動 push `codex/*` 分支並透過受保護 PR merge；必須等待 CI、禁止 force push／直接 default branch push／衝突合併。
- Production deployment 不因 push／merge 自動觸發，仍需獨立 workflow 與人工 approval。
- `route_task` 可由主代理或已核准的本地 orchestrator 執行，但不得繞過上述安全邊界。
