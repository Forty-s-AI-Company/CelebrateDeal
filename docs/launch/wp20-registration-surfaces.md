> 後續更新：來源分類與報名分母隔離已由126實作並驗證；以下為125接線checkpoint歷史範圍。當前狀態見wp20-registration-source-classification.md。

# WP-20 報名頁訪客來源接線

狀態：IN_PROGRESS。這段補上可由 server 唯一確定 form／live 的報名頁來源；不代表報名率或完整 WP-20 已驗收。125 的 visits／viewing 正向 coverage 禁止閘門維持啟用。

## 產品改動

- `/form/[slug]` 僅在有效欄位、尚未顯示已驗證成功結果、恰有一個已解析場次時接線。明確場次 query 必須先通過既有 loader 的可選清單；多場次未選定不任取第一筆、不扇出計數。
- Funnel 根頁與 step 頁使用 runtime 實際 renderedStepId。Webinar 僅接受具有完整 form／live 資源與 thank-you step 的報名 step，且狀態為 waiting／live／replay。既有 client 使用第一個 thank-you step，沒有改寫導向規則。
- 一般 PageDocument 在任一設定的 viewport 有可見 lead form 才視為報名頁。排除 checkout-contact、直接 payment child、不可見祖先、不可渲染子節點、僅配置 popup 或 CTA 的情況。這是報名頁分類，沒有聲稱個人實際看到表單。
- 共用 server wrapper 先嚴格解析 ID 並確認收集設定存在，再執行 Next `connection()`、取得 DB 與持久發行。collector 只收到 vendor／live／server event ID。Fragment 保持原表單在固定 sibling slot；未取得追蹤來源仍保留表單，非預期 DB 失敗不偽裝成功。
- 發行時在同一交易重新確認精確 form／live／vendor、active 與專案發布條件，對 Live／RegistrationForm 取得 SHARE lock。交易前的 owner 查詢只當提示。沒有修改專案發布條件、verified 付款閘門、表單提交或 schema。

原有 page／intent／fact 協定、10000/version 上限與永久 loss marker 保留。伺服器 render 本身不算訪客；必須等原有 browser protocol 完成。Project row 本身未被新 SQL 鎖定，因此不認證所有專案發布競態。

## 目前實測

`coverage/registration-surface-validation.json` 記錄目前來源版本的 185 個單元測試、ESLint 與完整 TypeScript 檢查皆通過。

`coverage/registration-surface-db.json` 使用自建 loopback disposable PostgreSQL、合成資料及 125 migrations，17 項檢查通過，container／temp cleanup 通過。涵蓋真實 context／proof／prepare／collect 接線、跨 tenant／錯誤表單／停用／draft 專案拒絕、owner 查詢後 form 重綁拒絕、Live／Form 並行修改被鎖阻擋、外層 rollback 不留下 nonce、大小寫 UUID 重試、遺失回應、RLS／ACL、配額最後一格競態與實際跨期限拒絕。

data followup 提出的正向範本路徑缺證據，已補上真實 createFunnelFlow／createFunnelStepPages：產生非 system 的報名 step，helper 選出同一真實 DB form／live，再由實際 service 發行恰一筆未計數 page，後續走真實 browser protocol service。這沒有認證完整 public loader、signed HTTP、RSC collector 渲染或所有替代表單配置。

早期 partial webinar fixture、缺 schemaVersion fixture、PageDocument root 型別與跨 vendor 專案 FK fixture 都曾失敗；後續修正沒有降低產品約束或 assertion。先前失敗收據保留，不把初次失敗寫成 PASS。測試結構只證明固定 React sibling slot，沒有執行實際 RSC refresh／輸入狀態恢復驗證。

## 審查界線

初次 data／form 審查各自完成，提出 malformed ID、request boundary、state allowlist 與 tree shape 問題，已修正。最新收據與來源比對以 `registration-surface-checkpoint.json` 為準；未終結的複審不算通過。

初次 Funnel 複審未啟動：工具以字樣比對將未改動的 `csrfToken:` 欄位當作敏感值輸入。保留 `registration-surface-funnel-review.json` 的 BLOCKED_SENSITIVE_INPUT。後續提供明示省略兩行 consultation CSRF 組裝的 review view；原產品來源、CSRF 行為與 scanner 均不變。省略位置記錄於 sanitized review source manifest，這兩行不在該審查的認證範圍。

## 尚未完成

來源目前仍共用 LiveMetricVisitPage／LiveMetricVisit，沒有持久區分報名頁與 viewer 頁。後續必須補上可信來源分類，並讓報名率 reader 僅使用報名頁來源；不能因接上更多頁面就將既有 viewer visit 納入報名頁分母。舊資料不得回填為已知報名來源。

接著完成 page／intent／fact／loss 的完整對帳、來源 epoch、writer／reader revisions 與原子 fence、visits／viewing 正向 proof，再配套取代 125 暫時閘門。未選定多場次、popup、動態切換、cache／back-forward／所有公開 URL、真實 signed Next HTTP、非 owner 部署角色、持續負載與長時間測試都尚未驗證。不能拿目前空表或 collector 成功推論完整來源。

完整五項統計端到端與非 Production runtime 整合尚待；原同步 20 請求 SSI 的 7 成功／13 失敗結果仍保留 FAIL。7 天僅用於完看後訂單資格，不截短觀看觀察期間。D-2～D-6 依賴項繼續 WAITING_AUTHORIZATION 並跳過。

## ownership、回滾與 evidence

root 為唯一 writer；外部 reviewer 唯讀、依序執行，parallel=1、depth=1、automatic_spawn=false。工程路由為 ai-team-pro／Sol xhigh；主代理實際 model／effort 未觀測，記 unknown。外部模型只以具體 terminal 收據記錄，不能推論所有模型均可用。

所有變更位於 `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，基底 efb8b7e9；未操作原 dirty 工作樹、未 push／deploy。沒有新增 schema／migration；沒有操作既有或正式 DB、正式付款／客戶資料、Secret Store 或 `.env*`。

回滾只反向本 scope 的 collector 接線、服務、分類與測試；不刪 page／intent／fact／loss 證據、不降低 revision、不復活舊報表，不移除 125 閘門。精確改動清單見 `coverage/registration-surface-changed-files.json`。

Evidence 根目錄：`docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`。相關收據為 `registration-surface-{route,validation,db,data-review,form-review,funnel-review}`、各 followup／sanitized review、review-source、review-disposition 與 checkpoint。這些是增量證據，完整 Goal 仍為 8/20（40%），WP-20 NOT_READY。
