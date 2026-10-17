# WP-20 實際 Next.js／瀏覽器驗證

狀態：IN_PROGRESS；WP-20 NOT_READY。此文件只記錄本機實際 runtime 子項，完整 Goal 維持 8/20（40%）。

## 實際通過的範圍

使用獨立 worktree 的原始產品程式建立 owned temporary mirror，使用實際 Next 16.3.8 dev、Chromium、gateway 與 disposable PostgreSQL。128 migrations 通過，所有資料為合成資料。未以 stub 取代產品 DB、認證、keyring、rate limiter 或 visits handler。

先在 collection disabled 下啟動 Next，實際載入報名頁與觀看頁，確認未建立統計來源。停止這個 owned process tree 後，以 DB clock 啟用 collection、建立新 run，再啟動帶有當次合成設定的 Next。

實際報名頁第一次載入、重新整理、觀看頁載入共產生 3 筆 page source、3 筆 intent、3 筆 visit，保留 1 個 visitor identity。三筆來源均對應當次 run/frame；報名來源 2 筆、viewer 來源 1 筆。實際 prepare/visit API 共 6 次 200。來源 HTTP 均為 200。

報名與觀看來源請求經真實 gateway；測試 runner 僅對允許的 Next static assets、精確 visits API 與 CSP report 使用 owned auxiliary proxy。Next 的 HMR/debug websocket 由測試 runner 轉送至同一 owned Next，傳送真實訊息，不檢視或保存 frame 內容。這些是本機測試接線，不能當成部署 gateway 已支援完整 auxiliary 路由。

Gateway 預設 upstream idle timeout 維持 15 秒。只有本機 runner 明確傳入經驗證的 120 秒開發編譯預算；DB statement/transaction budgets 未變。新增 timeout/diagnostics 與偽造代理標頭剝除測試，本輪相關單元測試合計 121 項、lint、完整 typecheck 均 PASS。

## 仍未通過／未驗證的範圍

修正後本次瀏覽器仍有 5 次未分類 auxiliary request 被阻擋、4 次 console error，分類為 RESOURCE_LOAD；未宣稱所有頁面資源或 UI 通過。尚未驗證 deployed minimum runtime role、Cloudflare/Vercel 真實邊界、全部入口/RSC/query/alias、實際媒體/觀看及五項完整統計。125 unsupported-covered gate 保留。

fixture source hashes 只涵蓋固定清單，不等於完整鏡像或執行前後所有依賴的 immutable snapshot。現有 Prisma no-dotenv preflight 只檢查固定 index 的第一個 relativeEnvPaths；實際解析與所有設定強化尚未完成。新增靜態 service graph 收據，當前 10 個本機輸入不包含 db.ts singleton；它不能回溯證明前次執行的所有程式，也不等於 parent process environment 已隔離。

Gateway 的 ECONNRESET 可能包含自己 destroy 的 timeout/client-abort，不能全部歸因 Next。既有 502 根因未被追溯證明；一次新的 PASS 不代表舊偶發失敗已修好。原有 public lifetime quota／永久 loss／鎖競爭／metrics 失敗影響表單 MAJOR、SSI 7 成功 13 失敗仍保留。

## 歷史失敗與修正

首次 probe 複審發現頁面 source 請求也被 runner 注入代理 proof/IP 的 MAJOR。已讓 source 使用原始瀏覽器請求，gateway 額外剝除 client-supplied Cloudflare/Vercel IP 與 live-chat ingress proof；只允許 exact auxiliary proxy 注入合成代理設定。原 review 與舊 PASS 收據保留，修正後另跑實際 runtime 與複審，不沿用舊 source hash。

初次 mirror 缺 Sentry server/edge config，已補入必要設定。啟用 collection 的 fixture 曾缺 collectionStartedAt，資料庫 CHECK 正確拒絕；改用 DB clock 同時設定後成功。SSR 回應 200 但未送 visit API 的失敗已保留；Next 的 debug/HMR websocket 接上實際 owned Next 後，hydration 與 6 次 API 實測成功。開發 timeout 放寬不作效能驗收，也不回推舊 502 的唯一根因。

## Ownership、複審與回滾

唯一 writer 為 root；requested/effective team 為 ai-team-pro。Router 建議 Sol/xhigh，主對話 observed model/effort unknown。獨立唯讀 review 依 probe/fixture/gateway 分開依序執行；實際 observed、fallback、原始 findings 與省略 credential declaration 的範圍見 next-runtime-*-review*.json。review 不等於整包 READY；本輪不要求整包驗收。

只在 C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal 操作，基底 efb8b7e9。沒有修改使用者原 dirty 工作樹、commit、push、部署或正式資料庫操作。未讀取 .env*、Secret Store 或輸出 raw logs、真實憑證與客戶資料。

回滾只限本輪 owned runner/gateway 接線：停止 owned app/gateway，後續不注入 ingress profile；保留 DB source/frame/gap、現有 migrations 與 125 gate。不要刪資料、逆向 migration、降低 revision 或復活舊 cache。臨時 DB/container/mirror 已由 runner 清除。

Evidence：docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/next-runtime-{db,validation,route,checkpoint,changed-files,service-graph}.json 與各 scope review、歷史 failure 收據。

下一步仍為全入口與最小 runtime role、來源 epoch／原子封存、typed 正向 visits/viewing producer，再驗收 40%、60%、66.67%、83.33 秒、50% 的完整非零案例。7 天只用於完看後訂單資格。D2～D6 依賴項保持 WAITING_AUTHORIZATION 並跳過。
