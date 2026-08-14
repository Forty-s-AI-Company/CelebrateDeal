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
- Gemini、Reviewer 與其他模型維持現有設定。

| 任務類型 | 預設角色 | 可替代路徑 |
| --- | --- | --- |
| planning、architecture、acceptance | Sol | Terra 直接規劃；必要時由 Reviewer 複核 |
| implement、bug fix、cross-file fix | Terra | Worker／Worker Deep 依 ownership 分工 |
| agy_qa、browser、e2e、ui validation | AGY Fast | AGY Deep、native Luna、deterministic tests |
| security、hard debugging | Terra／Reviewer | Analyst、Worker Deep、Sol |
| staging、sandbox、migration verification | Terra | Sol／Reviewer 提供唯讀複核 |

## 寫入與並行

- 同一檔案、同一資料表或同一外部資源同一時間只允許一個 writer。
- 不相交檔案與唯讀分析可以並行。
- 主代理負責整合結果、確認 evidence 與處理衝突，不要求所有修改都由單一模型完成。

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
- `route_task` 可由主代理或已核准的本地 orchestrator 執行，但不得繞過上述安全邊界。
