# 工作佇列

這份清單是自動執行（`/loop 依 docs/work-queue.md 逐項處理`）的唯一來源。它取代 `docs/fable-queue.md` 的「仍未做」段落；該檔保留為 F-1 到 F-5 的歷史紀錄。

盤點基準：master `7f026911`（#606），2026-11-17。現況以程式與已合併 PR 為準，不以文件敘述為準。

## 執行規則

- 由上往下處理「A 可直接做」；每項一個 `ai/*` 分支、一個 PR，依 `AGENTS.md` 與 `CLAUDE.md` 的分工、測試、審查、merge queue 流程合併。
- **高**風險（金流、auth、租戶、migration、刪資料）＝派 `engineer-hard`，合併前一次獨立審查。**一般**＝派 `engineer`。
- 每項完成後在本檔把狀態改成「已完成（PR 連結）」，並寫下未驗證的部分。
- 遇到需要 owner 的決定、金鑰或 Production 操作就跳過該項，記到「C 等 owner」，繼續下一項；不要停下整個佇列。
- **owner 於 2026-11-17 同意**：依本檔順序執行；staging 的部署（含切 staging alias）、staging migration（`staging-migrate.yml`，先 `status` 再 `deploy`）與 PayUni Sandbox 測試付款可以不經詢問執行，使用合成資料。需要 staging 驗證的項目，合併後在 staging 驗證完才算完成。
- Production 部署、正式資料庫、正式付款與退款、正式寄信：一律需要 owner 另外授權，不在本佇列的自動範圍內。

## A. 可直接做（依序）

| 順序 | ID | 項目 | 風險 | 規模 | 完成標準 | 狀態 |
|---|---|---|---|---|---|---|
| 1 | Q-01 | 兩個不穩定 e2e（救援碼、學員推播） | 一般 | S | merge queue 連續 10 次不因這兩個測試失敗；不加 retry／skip | 已完成 [#607](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/607)、[#629](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/629)。推播測試根因：測試在 SW 的 `showNotification` 交給平台前就呼叫 `getNotifications()`，Chromium 會刪除尚未顯示的通知；改為先等 SW 回報已顯示。CI reporter 原本丟棄所有 stdout，診斷改由 annotation 在失敗時輸出。Linux 容器 30 次重複全過。同檔另有三個學員登入連結測試不穩（見 Q-16） |
| 2 | P-573 | Dependabot 正式相依（React 19.3.1 等 6 個，#573） | 一般 | S | 重新產生 lockfile（`magicast` 缺鎖檔）；完整 CI 與 e2e 通過 | 已完成 [#614](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/614)（與 #572 合併處理，兩個 Dependabot PR 已關閉）。axe 4.14 新規則連帶修正帳號選單、上傳區、範本庫按鈕的可存取名稱；browser-dev 的 axe 掃描排除無腳本權限的 `iframe[sandbox=""]`（Chromium 159 下 axe 無法在其中執行），改以 title 斷言。staging browser smoke run 44007306822 PASS |
| 3 | P-572 | Dependabot 開發相依（Playwright 1.65 等，#572） | 一般 | S | 同上；確認 `.github/actions/playwright-chromium` 快取 | 已完成，併入 [#614](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/614) |
| 4 | P-569 | GitHub Actions 版本升級（#569） | 高（動到 production workflow） | S | 更新 TAP 契約測試第 624 項認可的 blob；逐一確認 action 主版本變更；審查 | 已完成 [#609](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/609)（取代 #569，獨立審查通過）。後續 [#611](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/611)：帶 secret 的 job 明確關閉 setup-node 快取、全面 SHA 釘選。未驗證：v7 upload／v8 download 尚未在 staging-backup-recovery 實跑 |
| 5 | P-561 | staging 首次成功路徑 runner（#561） | 高（註冊、Turnstile 略過條件） | S | 同步 master、CI 通過、對目前 head 補一次審查；workflow 實跑待 staging 授權 | 已完成 [#561](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/561)（合併 `4c367772`，head 經獨立審查）。2026-11-17 staging 套用 9 個 migration（run 43983333501），alias 切到 `dpl_J6oqRLraJuthMj2f1BvzaXYgDdSB`（回滾點 `dpl_2wM7J2796QCBaUdAgoxpfgU3TH8K`），首次成功路徑 run 43983659367 PASS（15 步）。後續見 R-10 |
| 6 | Q-10 | `payment_paid` 自動化補跑 job | 高 | M | 回應後工作被中止時，下一輪 job 補跑且不重複（設計文件 §8）；PG 測試 | 已完成 [#613](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/613)（兩輪獨立審查；`action_failed` 以比對再寫入重試一次）。staging：alias 切到 `ca1c82d6` 後手動 webhook-retry run 44000422870 http=200。未驗證：平台實際中止 `after()` 的情境、大量訂單的查詢計畫 |
| 7 | Q-06 | Email 序列「買了就停」（`stopOnPurchase`） | 高 | M | 已付款訂單的買家不再收到後續步驟；退款不恢復；租戶隔離測試 | 已完成 [#618](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/618)（獨立審查通過）。owner 2026-11-17 決定：同商家任何商品都算購買、退款不恢復。未驗證：瀏覽器實際操作後台；已知限制見 `docs/domain-workflows.md`（0 元訂單也算購買、寄送前檢查與寄出之間的毫秒級視窗） |
| 8 | Q-04 | 課後信 job 遇 serialization failure 中止整輪 | 一般 | S–M | 單筆失敗不影響同輪其他寄送；有重試上限 | 已完成 [#621](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/621)。未驗證：衝突以測試注入，未在真實並發下重現 |
| 9 | Q-14 | `CourseLesson.chapterId` 收緊 NOT NULL | 高（migration） | S | 修復腳本兩個查詢皆 0 後才加；登記 `PRISMA_INVARIANTS.md`。staging 驗證待授權 | 已完成 [#624](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/624)（獨立審查；SQL 回填與 TS repair 逐列一致，含 Unicode trim）。staging migrate run 44034196836 套用 3 條；alias 切到 `02c996fe` 健康檢查正常。Production 部署須先 migrate 再上程式、低流量時段 |
| 10 | Q-15 | 課程章節排序、刪除、搬移單元 | 一般 | M | 學員進度與證書不受影響；e2e | 已完成 [#616](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/616)（獨立審查通過）。第一次章節管理操作會讓學員端改採後台順序（已記於 `PRISMA_INVARIANTS.md`）。未驗證：手機版面 |
| 11 | U-03 | 編輯器 inspector 對付款元件的說明與 restricted 狀態同步 | 一般 | S | 已綁商品時不再顯示「尚未連接」；`coupon` 維持說明文字 | 已完成 [#610](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/610)。未驗證：沒有在瀏覽器實際操作編輯器 |
| 12 | Q-02 | 其他 e2e hydration 競態（accessibility、announcement-center、commerce-orders、course-player） | 一般 | S–M | 先重現或取得 CI 樣本再改 | 已完成，無需修改：2026-11-05～11-17 的 30 筆 CI 失敗中，這些 spec 沒有 hydration 競態紀錄（相關的兩個已由 #590、#593 修好）。另：`learner-notifications.spec.ts` 在 #607 後仍失敗一次（#608 佇列），併入第 1 項觀察 |
| 13 | Q-03 | 範本庫 `TemplateCard` 對比不足 | 一般 | S | 先在 master 重現；axe 無新增違規 | 已完成 [#615](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/615)：master 上 27 處，原因是縮圖預覽的背景被 axe 當成卡片底色；縮圖外框加 `contain-paint isolate`，未改顏色；新增範本庫 axe e2e |
| 14 | Q-12 | 延遲步驟細節（快照損壞重試、連帶撤回、補跑輪流；地址索引另列高） | 一般 | S–M | 各自有測試 | 已完成 [#628](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/628)（獨立審查）：快照損壞第二次才停止、`failed` run 已排隊的信照寄、無 Email 補跑商家輪流、`FormSubmission` 驗證地址索引（staging run 44056948778 已套用）。已知限制：輪流查詢在積壓大時線性成長 |
| 15 | Q-13 | 規則被鎖超過 2 秒時漏建延遲步驟 | 一般 | M | 先重現；補建不重複 | 已完成 [#631](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/631)：規則忙碌時改留待補建紀錄，由排程補建，不重複建立。已知限制：商家儲存規則持有鎖時，請求路徑最多可等 15 秒 |
| 16 | Q-11 | 三個隱藏 trigger 接上呼叫端（`form_no_show`、`viewer_watch_progress`、`webinar_attended_duration_gte`） | 一般 | M×3 | 每個 trigger 一個 PR；接上後才在後台顯示 | `form_no_show` 已完成 [#623](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/623)（兩輪獨立審查）：新增觀看紀錄表、放在封測授權 `automation_form_no_show` 後（預設不開）、staging run 44045862771 套用 3 條 migration。已知限制：換裝置或手機內建瀏覽器驗證會被誤判未出席（後台已說明，根本解法見 Q-17）。`viewer_watch_progress` 已完成 [#647](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/647)（兩輪獨立審查）：新表 `LiveWatchProgress` 由 admission 心跳在伺服器端以 DB 時鐘計時（每 25 秒、只在報名者自己的場次播放中）；真人直播結束後以實際播放長度判斷；封測授權 `automation_watch_progress`（預設關）。staging migrate run 44207053294 套用 3 條，alias 切到 `3c6f295b`，browser smoke run 44207403127、首次成功路徑 run 44207410336 PASS。未驗證：瀏覽器實際觀看後觸發、`test:db:concurrency`；沒有發券時無可用 Email 範本（見後續項目）。`webinar_attended_duration_gte` 已完成 [#651](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/651)（兩輪獨立審查）：沿用同一份 `LiveWatchProgress` 與同一段掃描，分鐘門檻（後台 5/15/30/60），真人直播播出中即可觸發，跨場次累加；獨立封測授權 `automation_watch_duration`（預設關）；migration 停用舊秒數條件的規則並加授權允許值；同一人經不同表單報名同一場直播只觸發一次（兩個 watch trigger）。staging migrate run 44231513678 套用 2 條；alias 先切到 `bfd240ba` 時 browser smoke 在手機「更多」逾時，回滾後查明是 smoke 在 hydration 前點擊（#654 修正，非產品回歸），再切到 `460eb8a0` 後 browser smoke run 44243347045、首次成功路徑 run 44243352539 PASS。A 段收尾：`d5b9cbb7`（含 #655、#656）的 browser smoke 因換頁取消上一頁 chunk 被判 `abortedScript`，查明為 smoke 判定問題（兩版皆會發生），[#658](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/658)（兩輪獨立審查）改為離開頁面前等同站 script／stylesheet 載完（load 後 500ms 無關鍵請求、上限 10 秒，超時算 `pending*` critical），只原諒導覽前已在途且導覽確實完成的請求；最終 alias 切到 `38b634b6`，browser smoke run 44275012896、首次成功路徑 run 44275021100 PASS。未驗證：瀏覽器實際觀看後觸發、`test:db:concurrency` |
| 17 | Q-09 | `payment_paid` 的延遲步驟 | 高（金流、migration） | L | `DelayedStepRun` 加訂單欄位；到點重讀訂單；退款後不寄 | 已完成 [#640](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/640)（三輪獨立審查）：`DelayedStepRun.commerceOrderId`；到點重讀訂單，全額退款／取消／測試單停止，部分退款照跑；收件 Email 只限本商家已驗證報名或已使用的學員登入連結；付款後才改的步驟不回頭套用；金鑰 ID 不在 keyring 時重試而不略過。staging migrate run 44175685097 套用 2 條，alias 切到 `d7f4e800`（回滾點 `dpl_6U6asKTYybuYxLvitSK7gbY4wU7G`），browser smoke run 44176042509、首次成功路徑 run 44176052166 PASS。未驗證：staging 上實際付款後到點寄出延遲步驟（需開授權並等待到期）；keyring 超過約 50 分鐘未修復時整條 run 停止（設計文件已記） |
| 18 | U-04 | 通用元件採用（28 個手寫輸入框、Toast、Tabs 分批遷移） | 一般 | M，分批 | 每批視覺與 a11y 不退步 | 封測前範圍已完成：[#625](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/625)、[#641](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/641)、[#648](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/648)、[#656](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/656)。`Field` 現支援受控、id、pattern、onFocus、inputMode、隱藏 label；遷移課程單元、互動角色與腳本、品牌設定、常青場時間、範本與客服篩選、團隊模板、表單建立器、CRM 搜尋。`live-fixed-sessions-editor` 刻意不遷移（需放寬 `Field` 的 name 契約，效益小）。金額相關（`stream-allocation-editor`、`product-form-client`）、大型檔案（`media-upload-field`、`live-stepper-form`、`live-interaction-studio`、`consultation-booking-calendar`）、漏斗編輯器組移到封測後（後續項目）。未驗證：四批都沒有畫面比對 |
| 19 | Q-05 | 發布檢查改成純讀 preflight | 一般 | M | 檢查不取得發布鎖、不寫入 | 已完成 [#619](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/619)。檢查與正式發布共用 `assertDraftPublishable`；同一份測試對舊實作只有「不取鎖」兩項不同。純讀看不到的寫入期競爭（自動表單 slug、版本號唯一鍵）仍只在正式發布時回報 |
| 20 | R-02 | `.gitattributes`（LF） | 一般 | S | 不造成全 repo 換行 diff | 已完成 [#626](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/626)：104 個誤存 CRLF 的文字檔轉 LF（內容無變更），已套用的 CRLF migration 以 `-text` 保留；順帶修正 CodeQL 標出的反斜線跳脫 |
| 21 | R-07 | 外部排程 Cloudflare Worker 檔進 repo | 一般 | S | `wrangler.toml` 與 worker 可直接部署；部署由 owner 做 | 已完成 [#617](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/617)：`ops/cloudflare/scheduled-jobs-worker/`。部署（`wrangler login`、`secret put JOB_SECRET`、`deploy`）仍待 owner（B-1） |
| 22 | D-01 | 文件與程式不一致（ROADMAP 課程列、GO-NO-GO §0／§7／F-019、OWNER-ACTIONS 補 Dependency graph 與 S4） | 一般 | S | 逐項對照程式後修正 | 已完成 [#627](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/627) |
| 23 | R-05 | 兩租戶 action 矩陣其餘部分（F-134） | 高（租戶） | M–L | 先盤點未涵蓋的 action，再補回歸測試 | 已完成 [#638](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/638)：盤點表 `docs/codex-goal/TENANT_ACTION_MATRIX.md`，補上高風險 action 的兩租戶 DB 測試，未發現跨租戶漏洞。其餘 35 個 action 只有靜態檢查、沒有 DB 測試（見下方後續項目） |
| 24 | R-04 | L3 重構（`actions.ts` 拆分、結帳抽服務、付款 reconciler、adapter 契約） | 高 | L | 每步行為不變、測試不弱化；一次一個模組 | 封測前範圍已完成：① adapter 契約 [#652](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/652)（共用契約測試、provider 不得依賴 webhook 引擎、demo／ecpay-like 只能經 registry 匯入）② 刪除 40 個轉呼叫 wrapper [#653](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/653)（名稱集合快照）③ 品牌設定、聯盟新增、webhook 重送搬出 [#655](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/655)（先補 `retryWebhookEventAction` 行為測試與 42 個 SSRF 案例）。`actions.ts` 2,473 → 1,909 行，上限 2,000。三步皆經獨立審查。出處 F-005／F-008／F-009／F-010（`docs/review-2026Q4/10-findings-register.md`、`11-architecture.md`）。④ 直播 action 搬出（可選）與 ⑤ 結算／出款／退款搬出、⑥ 結帳抽服務、⑦ 對帳註冊表延到封測後（主對話決定：動到金流主流程，現有 route 測試全是 mock，需先補真 DB 黃金案例；⑤ 在第一次正式月結之後），列在後續項目 |
| 25 | R-10 | 首次成功路徑 runner 每次執行留下的合成商家、直播與報名的清理或停用（只認 `cdfs-` 前綴） | 高（刪資料） | M | 只動 runner 建立的資料；先停用再刪；留收據 | 停用部分已完成 [#632](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/632)：runner 結束時停用自己建立的 `cdfs-` 商家並留收據（staging run 44082301730 停用 2 個）。刪除模式依 #543 需要備份與 owner 同意，列在 C 段 |
| 26 | Q-16 | 學員 magic link 登入後偶發被送回登入頁（`learner-notifications.spec.ts` 三個測試在 Linux 重複時 flaky） | 高（auth） | M | 在未修改的 master 重現；查清是產品競態或測試；token 一次性與綁定不變 | 已完成 [#633](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/633)：根因是學員 session 對時鐘偏差零容忍，改為容許 60 秒；token 一次性與綁定不變 |
| 27 | Q-17 | 個人觀看連結：提醒信與開播通知帶簽章連結，開啟時設定報名 cookie，降低 `form_no_show` 誤判 | 高（auth、租戶） | M | 連結一次性或有期限、綁定報名與商家；不洩漏他人報名 | 已完成 [#634](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/634)（獨立審查）：連結有期限、綁定報名與商家，開啟時只設定「僅出席」cookie，不授予完整報名權限。未做：固定場次以 cookie 當場次提示（後續項目） |
| 28 | Q-18 | 自動化 Email 範本依觸發條件限制可選項（避免缺連結的信） | 一般 | S–M | 既有規則不中斷；後台只列出可用範本；伺服器端驗證 | 已完成 [#636](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/636)：依觸發條件限制範本，伺服器端驗證；新規則不能再選 `class_reminder` 等缺連結的範本，既有規則照常寄送。未做：`form_registered`、無折價券的 `payment_paid` 缺一個通用無連結範本（後續項目） |
| 29 | Q-19 | 其餘時鐘偏差零容忍的檢查統一 | 高（auth） | S–M | 共用常數；不放寬一次性與期限 | 已完成 [#635](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/635)：`SERVER_CLOCK_SKEW_SECONDS = 60` 集中在 `src/lib/server-clock-skew.ts`，csrf、recent MFA、常青場等共用。未改：fan-out 的 `consentedAt <= occurredAt` 排序檢查 |

## A2. 第二批（2026-11-19 由主對話排序，owner 指示「順序由你決定」）

排序原則：先做擴大開通前必須修的、安全加固與阻擋 CI 的，再做商家直接有感的，最後是小幅改善。每項規則同 A 段（分支、測試、審查、merge queue、需要時 staging 驗證）。

| 順序 | ID | 項目 | 風險 | 狀態 |
|---|---|---|---|---|
| 1 | A2-01 | 觀看觸發「同一人已執行」排除改為不掃整張 `FormSubmission`（#651 MINOR-A） | 高（租戶、效能） | 已完成 [#663](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/663)（兩輪審查）：派送前小查詢＋`duplicate_person` 紀錄，新索引以單句 `CONCURRENTLY` 建立（repo 第一個）。52 萬筆合成資料下大商家掃描 113 秒 → 0.4 秒。staging migrate run 44382582196 套用；browser smoke 44382917457、首次成功 44382926058 PASS |
| 2 | A2-02 | demo adapter 加固；聯絡網址 SSRF 判斷三份統一並補 IPv4 變形測試 | 高（金流、安全） | 已完成 [#661](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/661)（審查）：`provider` 不可被 body 覆寫、registry 只認自有 key；三份 SSRF 判斷統一成 `contact-url-rules.ts`＋`contact-url-safety-node.ts`，共用案例表三實作一致。未做：100.64/10、NAT64、6to4 等網段（後續項目） |
| 3 | A2-03 | `funnel-operations.spec.ts:83` 偶發失敗；盤點其他靠 `?saved=1` 判斷完成的 spec | 一般 | 已完成 [#662](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/662)：根因是編輯器 3 秒自動儲存與測試點擊競態；另修 `automation-delayed-steps` 同類問題，其餘 spec 盤點無需修改 |
| 4 | A2-04 | 通用無連結 Email 範本 | 一般 | 已完成 [#665](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/665)（三輪審查）：`generic_message`「自訂訊息（不含連結）」，7 種 trigger 皆可用；姓名只在已驗證時帶入、像網址改用預設稱呼；預約姓名改精確比對（修掉 ILIKE `_` 萬用字元）；所有自動化信帶商家頁尾；內文禁止連結但不誤擋 `Node.js`。staging 已上（`b8038c00`） |
| 5 | A2-05 | PayUni 回呼遺失時主動查詢補單排程 | 高（金流） | 已完成 [#664](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/664)（三輪審查）：`/api/jobs/payment-reconcile`，與回呼共用入帳路徑與 `WebhookEvent` claim；金額只取伺服器紀錄；退款／請款取消／金額不符轉人工；需 `PAYMENT_RECONCILE_ENABLED=true`（staging Preview 已設，Production 未設、需 owner 同意）。staging migrate run 44408557820 套用 2 條；手動觸發 job http=200。未驗證：Sandbox 實測遺失回呼補單、請款前 `RemainAmt`／`CloseStatus` 的實際值、「以部分退款退完剩餘金額」的 PayUni 行為（後續項目） |
| 6 | A2-06 | 其餘 35 個租戶 action 補兩租戶 DB 測試 | 高（租戶） | 已完成 [#666](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/666)：36 個入口全部覆蓋，未發現跨租戶漏洞；`TENANT_ACTION_MATRIX.md` 更新。觀察：`savePartnerPageAction` 部分寫入、`duplicateInteractionScriptAction` 錯誤無提示、`LiveStudioDraft.liveId` FK 未綁 vendor（後續項目） |
| 7 | A2-07 | fan-out 的 `consentedAt <= occurredAt` 改用共用時鐘偏差 | 一般 | 已完成 [#667](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/667)，並修正 QA runner 中「事件後 1 秒同意」的舊案例 |
| 8 | A2-08 | 商家儲存規則持鎖時，請求路徑最多阻塞 15 秒 | 一般 | 已完成 [#671](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/671)（三輪審查）：四個請求路徑入口最多等約 2 秒，逾時寫入 `AutomationDeferredDispatch` 由 job 補派；依 eventId 去重（不看版本）、時間退避 48 小時、P2028／P2024 也延後。staging migrate run 44463060855 套用；alias 切到 `71f6c954`，browser smoke 44463257138、首次成功 44463263419 PASS |
| 9 | A2-09 | http 環境下 LINE 動作失敗不拖垮整個延遲步驟 | 一般 | 已完成 [#673](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/673)（審查）：四種確定性設定錯誤只略過該 LINE 動作並記原因碼，其他動作照做、步驟 completed；正式環境的非 HTTPS 按鈕送 warning。alias 切到 `65be5c14`，browser smoke 44474092809、首次成功 44474098204 PASS。不在範圍：直播提醒／開播通知的 LINE |
| 10 | A2-10 | 固定場次以個人觀看連結當場次提示 | 高（auth） | 已完成 [#669](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/669)（兩輪審查）：場次提示 cookie（`lsh1`，只帶報名 id，HMAC 涵蓋 vendor／live／到期），三處共用 `resolveViewerFixedSession`；提示場次取消或未開始而他場在播時退回公開時程。未做：開連結後商家關回放或移場次的邊界（後續項目） |
| 11 | A2-11 | 手機底部「更多」不靠 JS 的後備 | 一般 | 已完成 [#668](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/668)：原生 popover，hydration 後轉交 React 抽屜。未實測：實機 iOS Safari、舊 Android |
| 12 | A2-12 | DB 測試不依賴外部 `CSRF_SECRET` | 一般 | 已完成 [#667](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/667)：21 個 DB 測試檔改用 `vi.stubEnv` |
| 13 | A2-13 | 既有信件（驗證信、序列信、範本、收據）姓名可被用來釣魚 | 高（安全） | 已完成 [#670](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/670)（三輪審查）：共用 `safe-recipient-name.ts`，驗證信不帶姓名、像網址（含不可見字元繞過）改預設稱呼。部署前已排入的提醒保留原內容（重新產生腳本改為後續項目） |

## A3. 第三批（2026-11-19，從後續項目挑出、不需 owner 的部分）

| 順序 | ID | 項目 | 風險 | 狀態 |
|---|---|---|---|---|
| 1 | A3-01 | SSRF 規則補 100.64/10、192.0.0/24、198.18/15、224/4 以上、`fec0::/10`，以及 IPv4-compatible／NAT64／6to4 內嵌位址（#661 審查） | 高（安全） | 已完成 [#676](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/676)：共用案例表 69 → 105 |
| 2 | A3-02 | `savePartnerPageAction` 全有全無；`duplicateInteractionScriptAction` 錯誤提示；`LiveStudioDraft` 複合外鍵（#666） | 高（租戶、migration） | 已完成 [#677](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/677)（審查）：migration `20261119150000`／`150100`（先查 PG15+、跨商家草稿計數 > 0 即中止）。staging（PG 17.6）migrate run 44494314941 套用；alias 切到 `cdc54354`，browser smoke 44494584348 PASS，首次成功 44494622752 第 1 次 FORM 逾時、重跑 PASS（同一偶發，見 A3-05）。**Production migrate 前須確認 PostgreSQL ≥ 15**（runbook `prisma-migration-guards-runbook.md` §8）。未做：DROP 拆檔（審查 MINOR-3）、交易內再確認商品狀態（MINOR-5，既有） |
| 3 | A3-03 | 部署前已排入提醒的原地重算腳本（compare-and-set，#670 複審） | 高（寄信） | 已完成 [#683](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/683)（兩輪審查）：`scripts/rerender-queued-reminder-content.ts`，預設 dry-run；只改寫內容與 #670 前版本完全相等、且可證明從未送達 Resend 的列，其餘計 `ambiguousAttempt`／`unrecognized`／`stale`；CAS 推進 `updatedAt` 讓寄送端搶單失敗後寄新內容；Production 需 owner 授權值。runbook `production-database-runbook.md` §9.4。**未執行**：staging 與 Production 都還沒跑（staging 需注入 staging 的 DB 與金鑰，Production 需 owner 授權）。殘留：`ambiguousAttempt` 的 exhausted 列手動重送仍寄舊內容 |
| 4 | A3-04 | 場次提示：開連結後商家關回放或移場次的邊界（#669 複審 MINOR-A） | 高（auth） | 已完成 [#680](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/680)（審查）：提示場次已結束且無回放（關回放、過回放窗或截止、改到已結束場次）時退回公開時程；cookie 格式與驗證不變。未處理 3 個 NIT。未驗證：瀏覽器實測 |
| 5 | A3-05 | 首次成功路徑 runner 記錄卡住的動作；`accountant-foreign-message-template-edit-direct-url.spec.ts` 偶發；互動腳本列表 `?error=conflict` 提示 | 一般 | 已完成 [#679](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/679)：失敗時輸出動作 trace（artifact 與 `staging_first_success_failed_action=`）；e2e 外部請求斷言改為任何跨來源都算違規並列出請求；列表顯示衝突提示。FORM 偶發逾時根因未證實（推測儲存後 `waitForURL`），待 trace 再發時確認 |

順帶修的 CI 偶發：[#681](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/681)（預約 fixture 同毫秒撞唯一鍵）、[#682](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/682)（釣魚標記被隨機 token 誤中）、[#684](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/684)（小商家公平性測試改用確定性起點）。

A3 全部合併後 staging：alias 切到 `ca83e82c`（無新 migration，status run 44529242731），browser smoke 44529502603、首次成功 44529510578 PASS（15 步全過）。

不排入 A3：PayUni Sandbox 實測（另排）、邀請信主旨的商家名稱（開放自由註冊時才需要）、R-04 ④～⑦、U-04 封測後部分、picomatch 例外到期。

封測後才做（不排入 A2）：R-04 ④～⑦、U-04 金額相關與大型表單、picomatch 例外到期處理。

後續項目（原始清單，已排入 A2／A3 的以該編號為準）：

- `form_registered` 與無折價券 `payment_paid` 的通用無連結 Email 範本（#636 延伸）。
- http 環境下 LINE 動作失敗會讓整個延遲步驟失敗（既有行為）。
- 固定場次以「僅出席」cookie 當場次提示（#634 選項 b）。
- 其餘 35 個租戶 action 補兩租戶 DB 測試（#638 延伸）。
- fan-out 的 `consentedAt <= occurredAt` 改用共用時鐘偏差（#635 延伸）。
- 商家儲存規則持有鎖時，請求路徑最多阻塞 15 秒（#631 延伸）。
- ~~`tests/e2e/affiliate-portal.spec.ts:76` 在 browser gate 偶發逾時~~：已修 [#644](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/644)（測試在撤銷寫入前就重新載入；改為等 DB 授權更新）。其他 spec 若靠 `?saved=1` 橫幅判斷完成，可能有同類風險，未盤點。
- PayUni 若以 `partially_refunded` 退完剩餘金額，付款端會拒收、訂單停在部分退款（#640 審查 NIT-B）；需確認 PayUni 實際行為。
- `automation-delayed-step-start-lock.db.test.ts` 依賴外部 `CSRF_SECRET`，本機沒設會失敗（CI 有設）。
- PayUni 回呼整筆遺失時沒有主動查詢補單的排程（`queryPayment` 只用在 Sandbox 與 ops 路徑），目前只能人工對帳。屬新功能，不放進 R-04（2026-11-18 盤點）。
- R-04 封測後步驟：④ 直播 action 搬出（可選）、⑤ 結算／出款／退款搬出（第一次正式月結之後）、⑥ 結帳抽服務、⑦ 對帳註冊表、拆分 `actions.test.ts` 並移除假 Prisma。
- U-04 封測後：金額相關表單（`stream-allocation-editor`、`product-form-client`）、大型檔案（`media-upload-field`、`live-stepper-form`、`live-interaction-studio`、`consultation-booking-calendar`）、漏斗編輯器組。
- ~~觀看觸發的「同一人已執行」排除在全平台報名數變大後會掃整張 `FormSubmission`（#651 複審 MINOR-A）~~：A2-01（`ai/watch-same-person-perf`）選 (a)：派送前一刻以新索引 `FormSubmission_live_email_normalized_idx` 查同一人，已執行的規則記成 `skipped / duplicate_person`，掃描移除 `NOT EXISTS`；一併修 `s2` 綁商家、延遲步驟回 `condition_unsupported` 兩項 NIT。52 萬筆合成資料大商家掃描 34 秒／113 秒 → 0.3 秒／0.4 秒（`PRISMA_INVARIANTS.md` 2026-11-19 節）。未驗證：正式資料規模的 EXPLAIN。
- 觀看觸發：沒有發券時沒有可用 Email 範本（Q-18 限制），「看到 50% 寄一封信」目前做不到；併入通用無連結範本。
- 手機底部「更多」在 hydration 前點擊沒有反應（慢速手機的體驗問題，#654 調查發現）；評估不靠 JS 的後備。
- `tests/e2e/funnel-operations.spec.ts:83` 偶發失敗（#655 CI run 44242232428，retry 後通過）。
- demo adapter：body 可覆寫 `provider`（`{ provider: "demo", ...rawPayload }`）、registry 以 `providers[id]` 查表會命中原型 key；正式環境有三層防線擋住，改用 `Object.hasOwn` 並把 `provider` 移到 spread 之後（#652 審查 MINOR-4、NIT）。
- 聯絡網址 SSRF 判斷有三份（`lib/contact-url-safety.ts`、`email-delivery-pii.ts`、`brand-settings-form.tsx`）且規則已不一致；補 IPv4 變形寫法（`2130706433`、`0x7f.0.0.1`、`127.1`）測試並共用案例表（#655 審查）。
- PayUni Sandbox 實測：遺失回呼時補單入帳、請款前 `RemainAmt`／`CloseStatus` 實際值、以部分退款退完剩餘金額的行為（A2-05）。
- SSRF 規則補 100.64/10、198.18/15、多播、NAT64、6to4、IPv4-compatible 位址（#661 審查）。
- 部署前已排入提醒的重新產生：改用原地重算內容的 compare-and-set 腳本（不改狀態）（#670 複審）。
- 商家名稱出現在邀請信與學員登入信主旨；若開放商家自由註冊需另行處理（#670 審查）。
- 場次提示：開連結後商家關回放或移場次時，提示可能擋住正在播的公開場次（#669 複審 MINOR-A）。
- `savePartnerPageAction` 先寫文字後驗商品造成部分寫入；`duplicateInteractionScriptAction` 錯誤無提示；`LiveStudioDraft.liveId` FK 未綁 vendor（#666）。
- ~~`automation-line-push-policy.db.test.ts` 計時斷言偶發失敗~~：[#674](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/674) 改用 PG 端證據。
- 首次成功路徑 runner 失敗時記錄是哪個動作逾時（2026-11-19 staging FORM 步驟兩次偶發逾時，重跑通過）。
- `accountant-foreign-message-template-edit-direct-url.spec.ts:12` 偶發失敗（#664 CI）。
- npm audit 對 picomatch（GHSA-fc5q-39xc-vjpf）的例外於 2027-01-01 到期；上游出修補版後移除（#642）。
- 部署前已排入提醒的重新產生：改用原地重算內容的 compare-and-set 腳本（不改狀態），#670 複審建議。背景：A2-13 部署前已排入、尚未寄出的 `live_reminder` 與直播通知保留原本的內容（可能含未清理的姓名）；#670 第一版提案腳本是先標成 `superseded` 再靠 reconcile 重建，但 reconcile 每批只處理 100 筆且沿用之前的進度，依 `incomplete` 重跑時已救回的提醒會再被標掉而永遠不寄，已移除。

## A4. 第四批（2026-11-23 owner 決定後新增）

| # | ID | 項目 | 風險 | 狀態 |
|---|---|---|---|---|
| 1 | A4-01 | 通用折扣碼與編輯器 `coupon` 元件（U-10、U-11）；佣金以折扣後實付金額計算 | 高（金流、佣金） | 已完成，三輪獨立審查（[#702](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/702)；規則見 domain-workflows「折扣碼」） |
| 2 | A4-02 | 常青場課後信只寄給看過的報名者：共用開場時間模式與常青結束後補寄目前寄給所有已驗證報名者，要改成與逐觀眾模式一致（Q-17 決定） | 一般 | 已完成 [#696](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/696)（以 `LiveRegistrationAttendance` 判斷；未驗證 `test:db:concurrency`） |
| 3 | A4-03 | 應用層限流不採用可偽造的來源 IP 標頭，並為 `/api/security/csp-report` 加限流（D-20；O-7＝否，網域不經 Cloudflare）；完成後才評估 CSP 轉強制（R-01） | 高（安全） | 已完成 [#701](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/701)（兩輪審查＋複審）：只採信 Vercel 提供的 IP；直播雙層上限；`cloudflare_waf` 在 Production FAIL、Preview WARN；R-01 CSP 轉強制延後評估。Production 部署前需改 `upstash_redis`。後續：付款 webhook 簽章失敗時的 AuditLog 寫入節流（金流，另排） |
| 4 | A4-04 | Stream 簽章網址 staging 驗證（`docs/operations/stream-signed-urls-plan.md` §8 第 3 步）；之後鎖定新上傳與既有影片前要再問 owner | 一般 | 部分完成：staging 收不到 Stream webhook（帳號只能設一個通知網址），[#699](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/699)（兩輪審查）加上主動查詢備援；`345369a4` 的 Stream smoke run 45362686913 PASS（含 `signedPlayback`）。未做：§8 第 3 步的瀏覽器播放、續期、token 失效恢復、`allowedOrigins` 實測；Worker 需 owner `wrangler deploy`。後續：改指向直播後舊上傳無人追蹤（MINOR-A）、NIT-1～4 |
| 5 | A4-05 | PayUni Sandbox 實測補單；通過後再請 owner 授權 Production `PAYMENT_RECONCILE_ENABLED=true`（D-9） | 高（金流） | 完成（2026-11-25）：runner [#698](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/698)、診斷 [#700](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/700)、查詢解析 [#705](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/705)、填寫時序 [#706](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/706)。staging 784f99f2：pay run 45434598868 = `PAID_CALLBACK_WITHHELD`（欄位全數穩定、無提示視窗）；verify run 45438345833 與重跑 45438718731 皆 `RECONCILED_ONCE`，paid 事件 1 筆、來源 RECONCILER、retry 0。未驗證：實際由哪一次排程補單（手動 run 45438182916 時 candidates=0，推測 Cloudflare Worker 排程先補）；`scripts/payuni-issued-recovery-browser.mjs` 仍用舊填寫流程。下一步：owner 決定 Production D-9 |
| 6 | A4-06 | LINE E2E runner `PRISMA_INIT_FAILED` | 一般 | 已完成 [#693](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/693) |

## B. 需要 owner 先做產品決定

> 2026-11-23：owner 決定本段全部照「建議」欄。需要實作的已排入 A4；其餘維持封測後。

| ID | 項目 | 要決定的事 | 建議 |
|---|---|---|---|
| U-10、U-11 | 通用折扣碼與編輯器 `coupon` 元件 | 要不要做；折扣後佣金以哪個金額計算 | 做；佣金以折扣後實付金額計算 |
| Q-08 | Email 序列與延遲步驟的寄送上限 | 一個商家一天最多寄幾封、排程多久跑一次（影響追銷信可能晚多久到） | 開通第一個商家前再決定 |
| Q-17 | 常青場課後信 | 沒看直播的報名者要不要寄；跨裝置是否要補記 | 只寄給看過的人 |
| Q-07 | 不綁直播的序列與 LINE 步驟 | 要不要做 | 封測回饋後再排 |
| U-12 | 多方案／買家訂閱 | 要不要做（依賴 PayUni 約定 Token，只能在正式站驗證） | 封測後 |
| U-13 | 自訂網域 | 要不要做 | 封測後 |
| U-01 | onboarding 殘留 | 舊任務（測試訂單、Logo、邀請成員）是否加回；`/merchant-onboarding` 是否保留 | 不加回；保留 |
| R-03 | 文件封存搬移 | 何時做（DECISIONS 寫封測後） | 封測後 |
| — | CodeQL 是否設必要檢查；買家可見的 AI 內容是否標示 | — | CodeQL 先不設；AI 內容標示 |

## C. 等 owner 的金鑰、帳號或 Production 授權

詳細步驟在 `docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md`。這裡只列被擋住的工程項目。

| 被擋的工程項目 | 擋它的事 |
|---|---|
| AI M1–M4（情境引導、一句話建場、文案、課程大綱） | Cloudflare AI Gateway 與 Workers AI token |
| 含退款的對帳 runner 實跑（R-06）、財務 QA | O-14 `PAYUNI_QA_FINANCE_TOTP_SECRET` |
| 還原演練、F-058／F-074、Supabase 遷東京（O-15） | O-4 Supabase 升級與備份 |
| ~~Dependency review 檢查~~ | ✅ 2026-11-23 已開啟 Dependency graph |
| LINE E2E | secrets 已齊（2026-11-23）；剩 runner 問題 A4-06 |
| #561 workflow 實跑、合併後切 staging alias | staging 授權（見執行規則）、`VERCEL_TOKEN` 權限 |
| ~~外部排程生效（R-07）~~ | ✅ 2026-11-23 Worker 已部署並驗證 |
| CSP 轉強制（R-01） | 網域不經 Cloudflare（O-7＝否），改等 A4-03 應用層限流；累積違規報告 |
| 政策頁內容、F-103「部分互動」字樣 | O-9～O-11 法定資料與律師意見 |
| 資料保存排程啟用（R-09） | 確認 `scheduled-jobs.yml` 的觸發方式後由 owner 同意開啟 |
| staging 合成資料清理（R-08） | 備份與 owner 同意 |
| 首次成功路徑 runner 的刪除模式（R-10） | 備份與 owner 同意（#543：封測期間合成資料不刪） |
| Production 部署與 migration | O-19、O-20、O-26、正式金流授權 |

## 尚未判斷

- F-059 財務表 `onDelete` 是否全面不連帶刪除；F-015 `/lp` 快取；F-137、F-148 workflow 權限是否最小。處理 D-01 時一併查證，查完移到 A 或標為已完成。
