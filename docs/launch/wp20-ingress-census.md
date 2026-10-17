# WP-20：本機入口紀錄與 HTTP 轉送

狀態：IN_PROGRESS。這是已核准 M1/M2 五項統計的來源收集接線，**不是 WP-20 驗收完成**。

## 本輪範圍與 ownership

主代理是唯一 writer，所有修改位於獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，基底 `efb8b7e9`。原本有未提交變更的工作樹未操作。未 commit、push 或部署。

新增 migration `20261016150000_live_metric_ingress_census`、兩個 Prisma model、`live-metric-ingress.ts`、`live-metric-ingress-gateway.ts`，以及針對性 unit／disposable HTTP 驗證。既有 push／PR CI 已包含 ESLint 與單元測試，本輪沒有新增重複 workflow，也沒有執行遠端 CI。

requested/effective team 為 ai-team-pro；模型交由 canonical router 選擇，主對話實際 model/effort 記 unknown。Migration／Permission 需要獨立深度審查。reviewer 只讀，外部 dispatch 依序執行，parallel=1、depth=1、automatic_spawn=false。模型與 fallback 實際結果保留於 evidence，不能推論所有模型可用。

## 實際行為

- 每個版本最多一個入口 run；建立時驗證 owned disposable DB marker、primary、ReadCommitted、目前啟用且未過期的版本，拒絕已有頁面／訪客／播放等來源的版本。這只是防止補登目前可見來源，不能證明歷史或全入口完整。
- 允許轉送前，先以獨立交易提交一筆 frame。只存 scope、伺服器選定的 route kind、伺服器時間與 HTTP 結果，不存 URL、body、身份或憑證。
- 上限 1～10000，以版本鎖→run 鎖→重新計數控制；停止與名額競爭使用同一 run 鎖。停用版本、過期、停止或額滿都拒絕新 admission。
- 停止只關閉 admission，不封存來源。未回覆、未定案、交易 acknowledgement 遺失的 frame 保留 pending；停止後可以記錄晚到的 HTTP 結果。
- gateway 只綁定 `127.0.0.1`，只轉送至 caller 擁有的固定 loopback port；manifest 限定精確 method/path，不接受 query 或未知路徑。hash 必須與 run 相同，啟動時重新檢查 DB marker。Host 必須精確符合實際綁定的 address，Origin 必須不存在或相同；外來 Fetch-Site 在 admission 前拒絕。這仍不是 caller 身分驗證。
- admission 失敗回 503，不轉送；HTTP 中斷記為 interrupted。關閉時追蹤從 admission 到 DB settlement 的整個 handler，強制關閉後仍等待對帳；deadline 超過就失敗，不假裝乾淨結束。回報 settlementFailures、admissionFailures 與資料庫實際 pendingFrames。HTTP response finish 只表示伺服器完成回覆，不能代表瀏覽器收到、JS 收集成功或觀看完成。
- 直接修改身份／路由／時間、重開 run、刪除或 TRUNCATE 都拒絕。僅允許 canonical 版本刪除的 cascade。兩個表啟用 RLS，沒有 public/API role 授權。

## 明確限制與尚未完成

目前沒有公開 Next 路由呼叫 gateway，沒有自動啟用或 Production 設定。實測 upstream 是 runner 當次建立的合成 HTTP server，**不是完整 Next 報名／播放器整合**。單靠 loopback port 或 manifest hash 不能證明任意 upstream 安全或全入口已收集；後續接入 Next 前仍須驗證受控程序、完整入口、簽署的 frame/source 綁定。

125 的 visits/viewing 正向 coverage 禁令維持；這輪不建立 covered flag。還需要 page/intake 對應、來源 epoch、原子 writer fence、typed positive producer，以及完整非零五項統計驗收（40%、60%、66.67%、83.33 秒、50%）。7 天僅限完看後訂單資格，不限制觀看視窗。

既有公開 SSR lifetime quota、永久 loss、鎖競爭、metrics 錯誤影響表單的 MAJOR 仍未解除。這個 bounded gateway 不能直接當公開流量架構；尚未執行負載驗證。版本 share lock 與 run 計數仍可能競爭。DB 時鐘倒退可能讓 stop／settlement 的時間 CHECK 拒絕；須保留失敗及 pending，不能偽造成功時間。

admission 的 COMMIT acknowledgement 遺失時，caller 可能拿不到 frameId；該列保留 pending/unknown。重試 HTTP 是新的 admission attempt，不能說每筆 frame 都真的轉送。settlement acknowledgement 遺失後，同樣結果重試目前不冪等；不能以「找不到 pending」宣稱已知成功。這是本機 foundation 接受的 MINOR，後續 reconciliation 要保留這些不確定性。

## 驗證與 evidence

以 `coverage/ingress-validation.json`、`ingress-db.json` 的當前 source hashes 為準。最初 schema P1012、page fixture 缺必要發佈資源，以及 review input 超長的失敗收據分開保留；不能覆寫成 PASS。

Evidence 根目錄：`docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`。

- `ingress-route.json`：task signals、路由與 review plan。
- `ingress-validation.json`：針對性 unit、lint、完整 typecheck。
- `ingress-db.json`：127 migration、22 項真實 DB／HTTP 檢查，包含兩連線名額／stop 競爭、SQL guard、RLS、owned HTTP admission／中斷／commit rollback／lost acknowledgement／強制關閉與 settlement rollback、外來 Host／Origin／Fetch-Site 不產生 frame；runner 清理結果。
- `ingress-review.json`、`ingress-followup-review.json` 及對應 `review-source.json`：migration/helper 審查，followup 不重新認證未供應的 unit/harness 全文。
- `ingress-gateway-review.json`、`ingress-gateway-followup-review.json` 及 source：gateway 與指定 actual-http 測試區段；initial 的 shutdown MAJOR 修正後重驗，舊 findings 不刪除。不擴張成全來源、完整 app 或 Production 認證。
- `ingress-gateway-guard-review.json` 及 source：完整當前 gateway 與新增 Host／Origin 測試區段。只供應 rejection 測試區段，不重新審過底層/harness 全文。
- `ingress-checkpoint.json`、`ingress-changed-files.json`：精確本輪 scope、驗證／review hash 對照與未完成項。

## 回滾與停止條件

尚未啟用的 gateway 可停止並移除呼叫接線；保留新表、pending、來源與既有 125 gate。不要逆向 migration、刪除未對帳資料、降低 sourceRevision、復活舊 cache，或把 unavailable 改成零。若 admission 無法持久化、run binding 不符、資料隔離驗證失敗或必要 review 仍有 BLOCKER／MAJOR，停止該入口轉送，保留證據；其他不相依 Goal 工作仍可繼續。

全 Goal 仍是 20 WP；已完成 01／05／06／07／08／10／11／15（8/20，40%）。D2～D6 依賴項保留 WAITING_AUTHORIZATION 並跳過；本輪不需要使用者追加核准。
