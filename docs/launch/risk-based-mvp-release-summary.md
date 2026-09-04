# CelebrateDeal Risk-Based MVP 發布摘要（DRAFT）

**狀態：NOT_READY / NO_GO**

本摘要依[首發計畫](risk-based-mvp-plan.md)與[最新驗收進度](risk-based-mvp-current.md)整理，目前尚未達成發布條件。

## 首發範圍

首發目標包含商家邀請、登入／MFA、商品與直播建立；買家報名、觀看、checkout、付款結果、交付、查單、退款與客服；以及固定 SaaS 方案、租戶隔離、帳務與結算。首發停用新增用量帳單收費與聯盟／團隊佣金，保留既有負債及退款沖銷；非核心整合不列入本次範圍。Production 部署、正式付款與正式退款仍需獨立核准。

## 目前證據

- 既有 Browser 與 local DB 測試涵蓋桌機／行動登入、商家商品與直播流程、demo checkout、付款結果頁、交付／查單／客服入口、SaaS subscription quota projection，以及跨租戶隔離。這些測試使用 synthetic fixture、demo callback 或 local projection；不能代替 PayUni、Resend、Cloudflare 或正式資料的證據。
- CI `33885169141` 曾通過 unit／coverage；其 PostgreSQL concurrency collection 曾誤載入 Playwright-only support suite，已在 `vitest.synthetic-db-coverage.config.ts` 補上分流規則。這是 runner routing 修正，不是 DB invariant 或完整 Browser PASS。
- 最新產品 source `fb004d442494f0273bb622df7d869d30152cb19e` 的 CI `33886472991` 仍在執行；PR `#198`（`0d862d9`）checks `33885801591`／`33885777222` 仍在執行，尚不能標示為通過。
- 最新實際退款 recovery receipt [33885139996](../ai-team/evidence/wp4-existing-refund-recovery-33885139996-receipt.json) 為 `UNRESOLVED / RECONCILIATION_UNKNOWN_FAILED`；query 1 次、payment submissions 0、refund submissions 0。它證明受控查詢已停止並保留未知結果，不證明退款成功、失敗或帳務已收斂。

## 未完成與發布限制

商品與 SaaS 尚未具備可接受的 actual Sandbox payment → callback → refund → reconciliation 證據；SaaS activation／quota 的實際 provider 結果仍未確認。退款狀態不明時不得重送付款或退款。公開隱私保存／刪除期限、買家／SaaS 退款資格與時限、客服實際聯絡管道及營運責任仍待真人 owner 確認；現有政策頁均標示草稿。

因此 `MVP_RELEASE_CANDIDATE_READY=false`、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。在 current-head CI、實際 Sandbox 證據與人工政策／責任確認完成前，發布決策維持 `NO_GO`。

## 回滾與 Production 界線

回滾應針對已確認有問題的變更，以精確 revert 與受保護 PR 執行，保留使用者變更及全部財務紀錄。不以資料刪除或重送不明退款處理驗收失敗。任何 Production deploy、正式付款／退款與正式資料操作都必須另取得人工核准，並由獨立 Production workflow 執行。

