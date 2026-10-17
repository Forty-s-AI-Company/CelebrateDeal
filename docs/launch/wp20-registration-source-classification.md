# WP-20 報名頁來源分類與分母隔離

狀態：增量修正已驗證，WP-20 仍為 IN_PROGRESS／NOT_READY。沒有啟用 visits／viewing 的正向完整性證明。

## 行為

126 migration 新增 `LiveMetricVisitPage.sourceKind` 與 `sourceFormId`。舊資料、舊 writer 及未指定來源的內部呼叫保持 unknown，不依目前的表單反推歷史來源。公開 viewer 頁明確傳入 viewer；報名頁服務明確傳入 formId，發行 registration 來源。

registration 插入必須通過同交易的 Live／RegistrationForm／vendor／active／project-published 綁定檢查。新 trigger 排在原 page guard 前，維持 advisory → Live／Form → version 的鎖定順序。sourceKind 的 CHECK 明確拒絕 registration + NULL form；原 whole-row immutable guard 同時保護新欄位。歷史 form ID 不加會刪掉來源證據的 FK。RLS／table／column／function ACL 保持私有。

Migration 先推進 version structural revision，使既有 cache／lease 透過原 version guard 失效，再取得 page DDL 鎖。整份 SQL 為單一交易，lock timeout 5 秒、statement timeout 30 秒。這個順序修正了初次審查提出的反向鎖定風險；有資料的 CLI 升級與持續流量升級仍未驗證。

報名率訪客 reader 只接受與 visit 同 vendor／live／version／event 的 registration page，且 intent 必須是同 event／visitor。viewer、unknown、沒有 page、沒有匹配 intent 的 legacy internal facts 均不進分母。page 與 intent 的 composite primary key 使 join 不會放大一筆 fact；intent 沒有「已發行但尚未 prepared」的另一種列狀態，列在 prepare service 建立，preparedAt 由 DB clock 設定。這不能取代完整來源對帳。

## 實測與審查

目前來源 hash 匹配的 224 個單元測試、ESLint 與完整 TypeScript 檢查通過。自建 loopback disposable PostgreSQL 完成 126 migrations 與 20 項檢查，container／temp cleanup 通過。延續報名頁接線的真實 template/context/proof/prepare/collect、鎖、期限、quota、RLS 測試，另驗證：

- 真實 registration／明示 viewer／未指定 API／舊 SQL writer 的來源標籤。
- 錯誤 form、NULL registration form、事後重分類被 DB 拒絕。
- page／intent 重複鍵均回 23505，無 join 放大。
- 真實 enqueue／claim 租約後，在 RepeatableRead 呼叫產品 reader。報名頁成功 fact 被保留；同一 browser 的 viewer／unknown fact 與未 prepare 的 registration fact 被排除。page size 1 及其下一頁邊界正確。

原始兩輪 DB fixture 曾使用不存在的 contentFingerprint 欄位，確認 SQLSTATE 42703 後改成既有 fingerprint；失敗收據保留。viewer 呼叫新增明示來源後，原測試的精確 argument assertion 曾失敗；已把 assertion 加強為必須傳入 viewer，沒有改成寬鬆比對。

Migration／issuer 初次及 followup 獨立深度審查完成，reader 的精確 1–185 行審查完成；這些範圍沒有 BLOCKER／MAJOR。實際 provider 為 Claude CLI，觀測 model claude-opus-5-5、effort unknown。不能把這些收據視為整包 WP 通過。初次與 followup findings 全數保留，處置見 review-disposition。

Followup 關於「目前 viewer caller 未明示來源」的 NIT 來自 prompt 舊敘述；實際 viewer page 已傳 `{kind:'viewer'}`，當前單元測試精確驗證該參數，實際 DB probe 也驗證 viewer 標籤。沒有改寫 reviewer 原文。

## 未完成與停止條件

公開 SSR 耗盡 10000/version lifetime quota、永久 loss 與鎖競爭的 MAJOR 仍 OPEN。metrics 失敗可能影響表單 render；不能只吞例外並宣稱沒有資料遺失。

**任何 source-specific completeness／zero proof 都必須讀取整個 version 每一種 source 的 lossAt。** 配額為全 source 共用，loss marker 可在 viewer／unknown 列上；報名 fact reader 的 source 篩選不能用在 loss 對帳。現有 125 gate 與 coverage reader 仍拒絕 visits／viewing 正向旗標，因此目前不會把這種歷史或空表認證為完整。整個 version 的 loss reader／reconciliation 尚待落地，不能在此之前開啟 positive proof。

Live.formId 改變後，歷史 sourceFormId 不變。後續 producer 必須將分母、verified cohort 與 orders 的表單歷史規則對齊；沒有授權把當前 form 覆寫到舊來源。Project unpublish 競態可能在 trigger 回 23514，整個發行交易回滾並傳出 PERSISTENCE_UNAVAILABLE；Project row 的並行變動尚未完整驗證。

完整 page／intent／fact／loss 對帳、來源 epoch、revision fence、可信正向 producer、非 Production runtime 與完整五項非零 E2E 都尚未完成。真實 signed Next HTTP、實際 non-owner 部署、所有 URL／cache／back-forward／動態選場、RSC refresh、populated CLI upgrade、流量／長時間測試仍未驗證。原 20 請求 SSI 的 7 成功／13 失敗仍為 FAIL。

## ownership、回滾與 evidence

只在獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal` 修改，基底 efb8b7e9，原 dirty 工作樹未操作。root 唯一 writer，external review 唯讀依序執行，parallel 1／depth 1／automatic_spawn false。ai-team-pro 工程 route Sol xhigh，主代理 observed unknown。Migration scope 已取得獨立深度審查。

回滾保留新增欄位與已記錄來源；可停用新接線，保持相關統計 unavailable。不得單獨移除 reader 的來源限制、把 unknown 改成 registration、降低 revision、恢復舊結果／租約、刪除 unmatched／loss 或移除 125 閘門。未對任何既有或正式 DB 執行 migration，未 push／deploy。

Evidence 位於 `docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/registration-source-*.json`。精確檔案與 hash 見 changed-files，當前驗證與審查處置見 checkpoint／review-disposition。既有 `.github/workflows/ci.yml` 已在 push／PR 執行 lint、unit coverage 與其他必要 checks；本輪未觸發遠端 CI。Goal 仍為 8/20（40%），D-2～D-6 依賴項維持 WAITING_AUTHORIZATION 並跳過。
