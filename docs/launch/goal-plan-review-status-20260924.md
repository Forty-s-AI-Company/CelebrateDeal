# Plan 審查執行紀錄

## Astra 規劃

- Requested/selected：`gpt-6-astra` / high，使用者指定。
- 執行：唯讀規劃子代理 `/root/astra_plan` 已回傳草稿；主代理整合最新 Git/HTTP evidence 後寫入 Plan。
- Observed model/effort：unknown，spawn工具未提供獨立runtime metadata。
- Reviewed draft SHA-256：`6B8F5F2407C7C505D7597D127631BEBED01E94A28859FBBD0C29A68CDADC3779`。

## AGY Opus，未完成實質複審

本輪 `agy models` 成功發現 `claude-opus-4-6-thinking`，並明示傳入該slug。

1. `Invoke-AgyPlanReview.ps1` 呼叫exit0，但wrapper收到的內容未通過review JSON schema，結果`INVALID_REVIEW`，整體回`FALLBACK_HANDOFF_REQUIRED`。原始stdout未由wrapper保留，不能推定其findings。
2. 為修復輸出格式進行一次bounded direct capture，process `SUCCESS`/exit0、無truncation，但唯一回覆為「這些檔案不在 scratch 目錄下。讓我搜尋正確路徑。」沒有讀到計畫或產出findings。此結果是`REVIEW_NOT_COMPLETED`，不是PASS，也不是登入失敗。

已達本輪兩次外部attempt上限，不再盲目重試。分類：`AGY_RUNTIME_ERROR` / review input scope unavailable；所选模型已明示，observed=unknown。後續新的Opus審查應把完整、sanitized計畫文字直接放入prompt，避免依賴AGY scratch外的相對檔案路徑，且須另記真實輸出與review hash。

本地規劃工作目錄保留失敗收據 `goal-plan-opus-review-20260924.json`、`goal-plan-opus-recovery-20260924.json`、`goal-plan-opus-response-20260924.txt`；不把原始 provider output 加入本次整合分支。這些收據不能當成review通過。

## 獨立 Codex fallback

依既有policy的Opus fallback允許Sol，選獨立`gpt-6-sol` / xhigh；Astra是原計畫作者，因此不拿Astra self-review冒充獨立複審。effort reason：跨Git、部署、Auth/payment邊界及驗收時程。

唯讀子代理：`/root/plan_fallback_review`，審查Plan/preflight，另讀staging config/CI佐證；未修改產品或啟動AI Team。已完成唯讀複審，無BLOCKER，3項MAJOR及1項MINOR，主代理全部接受並修訂。observed model/effort=unknown。此fallback不能被稱為使用者指定的Opus review。

| Severity | Finding | 納入修訂與驗證方式 |
|---|---|---|
| MAJOR | Plan仍聲稱等待Opus，啟動文字依賴不存在的有效receipt | 首段與模型記錄改為fallback審查狀態，啟動文字不再要求不存在的Opus修訂；保留失敗收據 |
| MAJOR | staging只測checkout入口，可能漏付款後無訂單 | CORE_STAGING_READY加入一筆固定Sandbox checkout→callback→持久化訂單及重複callback冪等性；無法驗證則核心狀態NOT_PROVEN，Goal不complete |
| MAJOR | 環境隔離只確認DB，Auth/Storage/payment可能誤指其他資源 | WP-A明定核對實際使用provider的非prod project/bucket/merchant/callback identity；未證明前不執行該mutation或部署，不輸出Secret |
| MINOR | 平台READY就先切alias，browser smoke太晚 | 先在immutable URL完成可執行的核心smoke，再切alias重驗；固定callback於切後驗證並保留rollback |

本輪僅計畫與review，產品code review、測試、Git整合、部署均尚未執行。Plan路徑存在性已檢查，無缺失的既有路徑引用；本輪不使用產品READY gate偽裝產品驗收。

## 2026-09-25：AGY Opus 主要章節補充複審

使用者指定的 `claude-opus-4-6-thinking` 已由 AGY CLI 明示選用；沒有 provider 實際模型 metadata，observed model/effort 仍記 `unknown`。第一次將 Plan 與 CURRENT 全文內嵌的嘗試於 3 分鐘上限只回開場文字，無 findings，不能算複審。之後以**兩個不重疊章節**分段內嵌，均取得實質 findings（conversation `2f0b9357-9a1a-4fa6-9af1-1885b6b220f3`、`e51d2439-d9d1-4678-affb-0dbfb9077fd1`）；這是 Plan 主要目標、WP 與驗收段落的 bounded 文字審查，不是 runtime 或產品 code review。

| 原 finding | 主代理核對與處置 |
| --- | --- |
| MAJOR：schema 不相容時引用不存在的相容回復方案 | 接受；WP-E/F 改為沒有具體方案與可用備份證據就停止切換／migration，不假稱已有方案。CURRENT 也明示一次性演練不留下回復檔 |
| MAJOR：WP-C 高風險修復未明訂最終 diff 獨立 review gate | 接受；WP-E/F merge gate 明列 Auth／permission／tenant／payment 的最終 diff review 與受影響回歸 |
| MAJOR：alias 切換缺獨立最低 gate | 接受；新增 `STAGING_CUTOVER_GATE` 的 immutable 來源、核心頁面與回復點條件；切後 callback 仍單獨驗證。這是後續規則，不能回頭把既有 alias 切換記成已符合新 gate |
| MINOR：長測試 receipt 介接信任條件不足 | 接受；驗收段落明訂當次 source/tree、受保護 run、固定 schema 與 validated sanitized artifact |
| MINOR：60 分鐘 CI／部署預留未驗證可行性 | 接受風險；四小時為調度預算，時間不足時停止擴 scope 並真實交接，不省略必需 gate 或宣稱完成 |
| MINOR：外部 provider discovery 與 P0 依賴順序不明 | 接受；WP-A/B 先從程式引用盤點實際 provider，WP-C 明訂 Auth／schema blocker 的短路與獨立項目繼續驗證 |
| NIT：Opus fallback 對 `INVALID_REVIEW` 只處理路徑 | 本次用內嵌文字分段後取得有效輸出；原 `INVALID_REVIEW` 根因仍未證實，不將先前失敗改寫為成功，既有 Sol fallback 記錄保留 |

第二段因只提供 WP 中段，Opus 將「WP-E/F 沒內容」列為 BLOCKER；核對完整 Plan 後，WP-E/F 原本就有六項內容，故此 finding **不成立**。它對「沒有任何替代 guardrail」及「部署沒有回復 gate」的描述也忽略其他章節與 AGENTS 規則，降為以上可採納的明確性修訂，不視為已證實的安全失守。所有複審僅改善 Plan 定義；`CORE_STAGING_READY` 的現況仍依 [CURRENT](CURRENT.md) 的實測收據判斷。
