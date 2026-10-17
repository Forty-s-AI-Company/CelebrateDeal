# WP-20：版本層級遺失與訪客來源對帳

狀態：IN_PROGRESS／整包 WP-20 NOT_READY。本輪把負向完整性檢查接入實際報表 coverage reader；沒有產生 visits／viewing 正向 proof、沒有移除 125 閘門，也不把持續 unavailable 當成五項統計的完成結果。

## 本輪產品行為

`reconcileMetricVisitSources` 在報表使用的同一 primary RepeatableRead 交易，讀取精確 vendor／live／version 的所有已記錄 page、intent、fact。每個來源最多讀 10001 筆，超過 10000 就回 limit_exceeded，不返回前綴。頁面、intent 與 fact 的鍵、欄位與時間都驗證後才分類；未讀取或輸出瀏覽器憑證、雜湊、URL、表單答案或個人資料。

- 任何 sourceKind 的 lossAt，只要早於報表結束時間，就代表此後版本有永久缺漏。標記在 viewer／unknown、原頁 lease 已過期、之後收到 acknowledgement，都不會消除缺漏。恰好等於結束時間仍在 `[S,T)` 之外。
- 報名頁未準備而 lifetime 與期間重疊，保留未回覆或已過期缺漏。已 prepared 的 intent 尚未有有效 fact，不能拿較短 page expiry 把它從之後的報表移除。
- 正常的期間外 acknowledgement 可以結束等待，沒有把該 fact 時間移回期間。時間不合理的 acknowledgement 即使落在期間外也不能關閉 intent；每個事件只計一次 invalid chronology。
- 報名、觀看、unknown、orphan、缺少 preparation 與其他來源 intent 分開統計。完整空集合和全部匹配集合仍為 unknown_history；這些資料只證明已記錄來源，不是所有公開請求的全集。

`asOf` 使用截到毫秒的 transaction_timestamp，作為不晚於 snapshot 的保守界線；endAt 晚於該界線回 window_not_closed。當下 clock_timestamp 只用於已存時間的合理性檢查，精度與原本的 rounded fact timestamp 一致。這沒有解決 snapshot 前開始、snapshot 後才提交的 writer；正向 proof 仍需原子 fence。

來源讀取暫時設 row_security=off，以拒絕被 RLS 靜默過濾成空表的角色；保持原本較嚴格的 statement timeout，結束時恢復兩項設定。SQL 失敗使交易 abort 時保留原錯誤，不讓恢復設定的次生錯誤遮蔽它。沒有修改 grant、policy 或角色權限。

Coverage reader 先讀 audit。已存在的 audit gap 直接保留，sourceReconciliation 明示 not_read／known_audit_gap，不再執行可能 timeout 或遇到壞資料的來源掃描；這不是來源驗證 PASS。沒有 audit gap 才執行必要對帳。source gap 與 audit gap 都不能被不可信 covered 標記覆蓋。報表 snapshot 的失敗分類增加 window_not_closed。

## 實際驗證

當前來源 hash 匹配的 **253 個單元測試、ESLint、完整 TypeScript 檢查通過**。自建 loopback disposable PostgreSQL 完成 **126 migrations、29 項檢查**，container／temp cleanup 通過。本輪沒有新增 schema／migration。

資料庫使用真實服務建立報名 page／prepare／visit、enqueue／claim 與產品 coverage reader，驗證 registration／viewer／unknown／未 prepare 的對帳。另一個合成版本以 10000 個 unknown page 耗盡 quota，實際發行被拒絕後，loss 留在已過期的 unknown 頁；新的報表讀到 evidence_gap。邊界、同一 RR 快照中間提交的新 loss、fresh digest 改變、原 1 秒 timeout／RLS 設定恢復，都有實測。

兩個連線另驗證：RR snapshot 建立後發行未回覆報名頁，等 wall clock 越過 endAt 再對帳，仍回 window_not_closed。10001 個 intent 的直接來源掃描回 limit_exceeded；加入對真實 loss 的 audit gap 後，coverage 保留 gap 並明示來源未讀，不謊稱大型來源掃描成功。受限角色在 RLS 下可看到零筆 page，但產品對帳明確回 42501，沒有把被隱藏的資料當已知零。

這些是 private service／DB 整合，沒有驗證真實 signed Next HTTP、整包背景報表 job、完整非零五項 E2E、實際部署角色、所有 URL／cache、負載／長時間測試。

## 審查與保留的失敗

初次審查、followup 與 final 收據原文全部保留。已修 chronology、設定外溢、已知 gap 被來源錯誤蓋掉、交易時間界線、重複 fact 鍵與 loss 早於 issue 的問題。Final 對兩個完整產品來源檔案無 BLOCKER／MAJOR，保留一項 audit 表 RLS 可見性的 MINOR 補強提案。實際 provider 為 Claude CLI，observed claude-opus-5-5、effort unknown；沒有推論全部模型可用。

orderTenantRevision 與 orderRevision 使用相同 window revision 是既有 canonical `20261016020000_live_metric_order_window_binding` 的規則，create／claim／finish 都如此；不依欄位舊名稱改寫訂單契約。本輪沒有改 order SQL 的語意。

初期 ESLint complexity 失敗已用拆分分類函式修正，沒有放寬門檻。RLS fixture 初期查了所有合成版本，錯看到原版本的兩筆 registration page，後改成精確版本查詢；失敗收據保留。

另有一輪 `baseline-report` 的 Error，當時收據未包含可定位的固定錯誤分類。增加固定分類診斷後，同一產品來源版本完整通過；**該次失敗原因仍未確認，不宣稱已修復或已證明不會再發生**。目前 matching-snapshot 通過與舊失敗同時保留，仍須在後續整合／soak 追查。

## 尚未完成、回滾與下一步

公開 SSR 耗盡 lifetime quota／永久 loss、鎖競爭，以及 metrics 錯誤影響表單的 MAJOR 仍 OPEN。還要補 audit RLS 可見性保護、實際最小權限部署角色、來源 epoch／完整公開入口範圍、歷史 form 與 cohort／orders 一致性、可信 positive proof／writer fence／runtime 接線與完整 E2E。Source digest 只描述快照資料，不能當 writer fence。

回滾只反向本輪對帳接線與輔助程式，維持 visits／viewing 不可計算及既有 gap；不刪 page／intent／fact／loss、不降低 revision、不復活報表、不移除 125 gate。沒有操作既有或正式 DB、推送或部署。

root 單一 writer，外部審查依序唯讀，parallel=1／depth=1／automatic_spawn=false。所有變更仍在獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，基底 efb8b7e9，未操作原 dirty 工作樹。工程 route 為 ai-team-pro／Sol xhigh，主代理 observed unknown。

Evidence 根目錄：`docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`，前綴 `visit-reconciliation-`，含 route、validation、db、各 review／review-source、review-disposition、checkpoint、changed-files 與保留的失敗。完成 WP 仍為 01／05／06／07／08／10／11／15，共 8/20（40%）；D-2～D-6 依賴項維持 WAITING_AUTHORIZATION 並跳過，原同步 20 SSI 的 7 成功／13 失敗維持 FAIL。
