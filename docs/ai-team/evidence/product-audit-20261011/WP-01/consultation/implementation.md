# WP-01：諮詢專案功能啟用

- ownership：主代理唯一 writer；產品 scope 僅 `src/app/actions/sales-workspace-actions.ts` 與新增同名 test。基底 efb8b7e9，僅隔離工作樹。
- 新建 consultation 專案時，在同一 Prisma transaction 以 vendor id 與 NOT has 條件追加 consultation_booking。一般 live 專案不啟用；引導已有專案時不覆寫手動停用設定。未變更模式推薦、發布、subscription 或既有 manager／request guards。
- 完成引導後刷新 layout；明確建立專案原本已有相同刷新，保留並新增 assertion。
- canonical migration `20260908090000_vendor_feature_toggles/migration.sql` 定義 TEXT[] NOT NULL；空陣列是明確停用，不是預設值。沒有 schema／migration 修改。
- 最終 revision：sha256:2235a5037a8729c5920bfa7933471aa601350547f130e239ea8677f1b1466350。
- 同版本 validation_runner：24 targeted tests、ESLint、tsc、browser-consultation 均 PASS。瀏覽器在 loopback disposable celebratedeal_ci 建立兩個合成諮詢專案，模組保留且不重複、側欄入口可見、實際 /consultations 200；finally 清理本 runner 專案並回復 selectedProjectId／原模組設定。Next server 已停止。
- 初次 browser 失敗與第二次 project-form TimeoutError 均保留為 browser-attempt-1/2.json；SelectField 的 label 包含 option 文字，改用來源確認的 select name 定位後成功。未降低產品 assertion。
- 外部首次 review 兩項 MINOR；補成功 revalidation assertion 並提供 NOT NULL 與 normalize 語意後，review-followup.json 明確裁決兩項 resolved、無新 findings。原 finding 不改寫。
- requested/effective team ai-team-pro。修正後 implementation route 為 sol／medium；初始使用 risk_level 欄位未被採納，已以 canonical risk 與 data_integrity_impact 欄位產生 medium 路由。實際 implementation model／effort unknown。
- wrapper review context 被 classifier 保守升為 Critical，依實際路由由 Claude CLI claude-opus-5-5 審查，observed effort unknown；AGY 既有 runtime failure context 保留。這不代表產品 scope 擴大到權限修改。
- native 子代理 dispatch 0，parent_depth 0；外部 review 2 次；max_dispatches 4、max_parallel 1、automatic_spawn false。
- assess_acceptance 回傳 READY、blockers=[]，僅此精確子項。完整 WP-01 仍未完成，發布語意 D-1 保持 WAITING_AUTHORIZATION。
- 限制：引導問卷完整 browser E2E、並行建立壓測、真實 DB rollback fault injection、全量 suite／coverage／axe 均 NOT_RUN。單元測試含引導建專案及拒絕寫入路徑；不將 mocks 宣稱為真實 DB rollback 證據。
- 安全：只有固定 loopback disposable DB／合成資料；未讀取 .env、憑證值或正式資料。未 commit／push／deploy。既有 CI 已有 push lint／coverage，未修改。
- 回滾：只反向移除此 action 的 12 行新增及本輪 test；不得回復整個工作樹。驗證資料僅按本 runner 的 vendor＋唯一 slug 清理，不動既有專案。
