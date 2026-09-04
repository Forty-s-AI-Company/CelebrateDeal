# CelebrateDeal Risk-Based MVP 發布摘要（DRAFT）

**狀態：NOT_READY / NO_GO**

本摘要依[首發計畫](risk-based-mvp-plan.md)與[最新驗收進度](risk-based-mvp-current.md)整理，目前尚未達成發布條件。

## 首發範圍

首發目標包含商家邀請、登入／MFA、商品與直播建立；買家報名、觀看、checkout、付款結果、交付、查單、退款與客服；以及固定 SaaS 方案、租戶隔離、帳務與結算。首發停用新增用量帳單收費與聯盟／團隊佣金，保留既有負債及退款沖銷；非核心整合不列入本次範圍。Production 部署、正式付款與正式退款仍需獨立核准。

## 目前證據

- 既有 Browser 與 local DB 測試涵蓋桌機／行動登入、商家商品與直播流程、demo checkout、付款結果頁、交付／查單／客服入口、SaaS subscription quota projection，以及跨租戶隔離。這些測試使用 synthetic fixture、demo callback 或 local projection；不能代替 PayUni、Resend、Cloudflare 或正式資料的證據。
- source `b6aa35dd8d9ecc37ea2baef338a75c32a57e653e` 的完整 CI `33894327280` 已通過，包含一般／客服 Browser、PostgreSQL、coverage、build、preflight 與 audit；fail-on-flaky 門檻保持不變。新增固定交易查核的 source `8ca40c2249106456b7c572ad02a5ac89ead67ed7` 也已通過完整 CI `33896586787`，runner PR `#200` 已受保護合併。後續回呼恢復 source `1c21c2bc876e0823b3a909ec5b0cbc97ff01c9a1` 的 CI `33900232471` 與 runner PR `#201` 檢查仍在執行，尚未執行回呼恢復。
- 最新歷史退款 receipt [33892202197](../ai-team/evidence/wp4-existing-refund-recovery-33892202197-receipt.json) 已達 `RECONCILED / RECONCILED`，query 1 次、付款／退款提交皆 0 次；workflow 與本機 canonical validator 通過。這關閉固定歷史交易的退款恢復，不代表新的商品與 SaaS 全流程均已驗收。
- [本機 PostgreSQL 證據](../ai-team/evidence/wp4-refund-transaction-budget-local-20260904.json) 已重現相同帳務查詢延遲在 5 秒預算下完整回滾、15 秒產品預算下完成且重跑不重複入帳；4 項 DB 與 72 項單元測試通過，修正後的歷史 Sandbox 查核也已收斂。
- 補齊固定 synthetic owner MFA 後，SaaS receipt [33894511275](../ai-team/evidence/wp4-subscription-33894511275-receipt.json) 已達 `PASS / NONE`：原生 checkout、可信付款、方案／額度啟用、退款、對帳與退款後權限全部通過；付款與退款各 1 次、對帳 1 次、權限查核 2 次。Workflow 與本機 canonical validator 均通過，適用 source `8497ec1`。這取代先前 checkout 阻擋，尚不代表商品流程或 Production 驗收完成。

## 未完成與發布限制

商品 actual Sandbox receipt [33894828505](../ai-team/evidence/wp4-buyer-33894828505-receipt.json) 為 `BLOCKED / RETURN_CALLBACK_UNMAPPED`：已提交一次付款、尚未確認成功，退款與對帳提交均為 0。只讀查核 receipt [33898475457](../ai-team/evidence/wp4-buyer-check-33898475457-receipt.json) 已確認本地 PENDING、provider UNKNOWN、回呼 FAILED / PROCESSING_FAILED，缺少 provider reference，因此沒有送出 provider query。新增固定回呼恢復沿用既有 retry service；13 項單元測試及 2 項真實 PostgreSQL 測試通過，涵蓋成功、重複執行與金額不符保留原狀。這仍是本地證據，實際 Sandbox 恢復、買家退款／對帳尚未完成，不得重送不明付款或退款。SaaS 全流程已通過，新回呼恢復版本的完整 CI 仍待完成。公開隱私保存／刪除期限、買家／SaaS 退款資格與時限、客服實際聯絡管道及營運責任仍待真人 owner 確認；現有政策頁均標示草稿。

因此 `MVP_RELEASE_CANDIDATE_READY=false`、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。在 current-head CI、實際 Sandbox 證據與人工政策／責任確認完成前，發布決策維持 `NO_GO`。

## 回滾與 Production 界線

回滾應針對已確認有問題的變更，以精確 revert 與受保護 PR 執行，保留使用者變更及全部財務紀錄。不以資料刪除或重送不明退款處理驗收失敗。任何 Production deploy、正式付款／退款與正式資料操作都必須另取得人工核准，並由獨立 Production workflow 執行。

