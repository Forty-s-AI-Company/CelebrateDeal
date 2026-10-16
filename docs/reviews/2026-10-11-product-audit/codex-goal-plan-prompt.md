# 貼給 Codex 的提示詞（Plan-only：讀取報告並製作 Goal Plan）

> 使用方式：整段貼到 Codex（ai-team-pro）。對應報告：`docs/reviews/2026-10-11-product-audit-consolidated.md`。

請使用 ai-team-pro。基底為 origin/master（efb8b7e9），不要在使用者目前有未提交變更的工作樹上操作（不得 checkout／reset／clean／stash／restore／rebase 該工作樹）。

任務是「讀取並製作 Goal 任務計畫」，不是實作：

1. 先閱讀 AGENTS.md、docs/ai-team/GOAL-PROTOCOL.md、docs/ai-team/ROUTING.md、docs/ai-team/handoff-schema.md、.ai-team/config/routing-policy.json。
2. 完整閱讀 docs/reviews/2026-10-11-product-audit-consolidated.md；需要細節時再讀 docs/reviews/2026-10-11-product-audit.md 與 docs/reviews/2026-10-11-product-audit/（working-notes.md、screenshots/）。
3. 依整合版報告第 9 節的要求，產出 Goal Plan 文件 docs/launch/goal-plan-20261011-product-audit.md：批次、WP 的 task signals／ownership／scope／驗收／驗證／依賴、單一 writer 表、需人類決策項（D-1～D-6）與阻擋狀態、風險與停止條件、回滾方式、evidence 路徑。不指定實作模型，交由 router 決定；僅對符合 Critical security／Auth／Permission／Payment／Billing／Production data／Migration 的 WP 標示需要獨立深度審查。
4. 製作計畫階段不得實作任何 WP、不得改動產品程式碼、不得推送或部署；缺少授權或外部輸入的項目標示 WAITING_AUTHORIZATION，不得自行假設。
5. 只使用本機／Preview／staging／固定 Sandbox／disposable PostgreSQL 與合成資料；不得讀取或輸出 .env*、Token、Cookie、私鑰、正式 Secret 或正式客戶／付款資料；不得 Production 部署或對正式資料庫操作。
6. 完成後依 handoff-schema.md 的精簡格式回報，未驗證項目如實標示，不得標成 PASS。
