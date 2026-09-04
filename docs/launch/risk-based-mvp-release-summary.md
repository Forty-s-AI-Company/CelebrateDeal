# CelebrateDeal Risk-Based MVP 發布摘要（DRAFT）

**狀態：NOT_READY / NO_GO**

本摘要依[首發計畫](risk-based-mvp-plan.md)與[最新驗收進度](risk-based-mvp-current.md)整理，目前尚未達成發布條件。

## 首發範圍

首發目標包含商家邀請、登入／MFA、商品與直播建立；買家報名、觀看、checkout、付款結果、交付、查單、退款與客服；以及固定 SaaS 方案、租戶隔離、帳務與結算。首發停用新增用量帳單收費與聯盟／團隊佣金，保留既有負債及退款沖銷；非核心整合不列入本次範圍。Production 部署、正式付款與正式退款仍需獨立核准。

## 目前證據

- 既有 Browser 與 local DB 測試涵蓋桌機／行動登入、商家商品與直播流程、demo checkout、付款結果頁、交付／查單／客服入口、SaaS subscription quota projection，以及跨租戶隔離。這些測試使用 synthetic fixture、demo callback 或 local projection；不能代替 PayUni、Resend、Cloudflare 或正式資料的證據。
- source `72e41910b1073603cf2848cc2fb0f7059374e11b` 的完整 CI `33902536007` 已通過，包含一般／客服 Browser、PostgreSQL、coverage、build、preflight 與 dependency audit；fail-on-flaky 門檻保持不變。這取代前一版 `1c21c2b` 的 MFA flaky 結果，並保留較早 `33894327280`、`33896586787` 的歷史適用範圍。Runner PR `#201` 已受保護合併；買家 continuation PR `#202` 的 Preview 已通過，quality checks 仍在執行。
- 最新歷史退款 receipt [33892202197](../ai-team/evidence/wp4-existing-refund-recovery-33892202197-receipt.json) 已達 `RECONCILED / RECONCILED`，query 1 次、付款／退款提交皆 0 次；workflow 與本機 canonical validator 通過。這關閉固定歷史交易的退款恢復，不代表新的商品與 SaaS 全流程均已驗收。
- [本機 PostgreSQL 證據](../ai-team/evidence/wp4-refund-transaction-budget-local-20260904.json) 已重現相同帳務查詢延遲在 5 秒預算下完整回滾、15 秒產品預算下完成且重跑不重複入帳；4 項 DB 與 72 項單元測試通過，修正後的歷史 Sandbox 查核也已收斂。
- 補齊固定 synthetic owner MFA 後，SaaS receipt [33894511275](../ai-team/evidence/wp4-subscription-33894511275-receipt.json) 已達 `PASS / NONE`：原生 checkout、可信付款、方案／額度啟用、退款、對帳與退款後權限全部通過；付款與退款各 1 次、對帳 1 次、權限查核 2 次。Workflow 與本機 canonical validator 均通過，適用 source `8497ec1`。這取代先前 checkout 阻擋，尚不代表商品流程或 Production 驗收完成。

## 未完成與發布限制

商品付款首次執行與只讀查核曾因回呼失敗而阻擋。固定回呼重試 [33901847171](../ai-team/evidence/wp4-buyer-retry-33901847171-receipt.json) 確認 Prisma 交易錯誤後，已以真實 PostgreSQL 驗證 5 秒回滾、15 秒完成且不重複通知；修正後實際恢復 [33902802436](../ai-team/evidence/wp4-buyer-retry-33902802436-receipt.json) 已達 `PASS / PROCESSED`，付款／退款／provider query 均未新增。這筆回呼不再重試。買家同一訂單的實際狀態、一次退款與對帳仍待固定 continuation runner 完成受保護檢查後執行。SaaS 全流程與 current-head 完整 CI 已通過。公開隱私保存／刪除期限、買家／SaaS 退款資格與時限、客服實際聯絡管道及營運責任仍待真人 owner 確認；現有政策頁均標示草稿。

因此 `MVP_RELEASE_CANDIDATE_READY=false`、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。在 current-head CI、實際 Sandbox 證據與人工政策／責任確認完成前，發布決策維持 `NO_GO`。

## 回滾與 Production 界線

回滾應針對已確認有問題的變更，以精確 revert 與受保護 PR 執行，保留使用者變更及全部財務紀錄。不以資料刪除或重送不明退款處理驗收失敗。任何 Production deploy、正式付款／退款與正式資料操作都必須另取得人工核准，並由獨立 Production workflow 執行。

