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
