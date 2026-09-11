# 09 — 直播功能整合驗收

日期：2026-09-12（Asia/Taipei）
範圍：01～08 直播功能；起點 `fa98ca8226a5d2ea17ddca0112a2f834dd73880b`。

## 結論與證據界線

完整lint與全專案型別檢查最終均exit0（receipt `checks-1789154189638.json`）。本輪重新閱讀交接、runner 與實作，找到並修復卡片輪詢卡死、媒體離頁資源未立即釋放，以及彈幕讀者互相持有排他鎖的問題。真實 PostgreSQL 整合為 **8 檔、39 項通過、0 skipped**；真 `LivePlayback`／本機 MP4／實際聊天、卡片、彈幕 API/domain／同一 disposable DB 串接為 **6 組通過**。另 10 支瀏覽器 runner 最新結果為 **83 組通過**，包含本機 MediaMTX 實播及 120 秒去背測試。

這不是完整正式登入、Next 路由、外部影音與真機 E2E。不同層級證據分開列示，尚未驗證的部分不標示 PASS。

本輪開始時工作樹乾淨。已實際執行 `.ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-pro`，exit 0；再以 `-Status` 確認 ai-team-pro。此腳本只改專案設定，沒有宣稱切換目前模型／推理程度。設定原已相同；移除腳本新增的尾端空白，沒有實質設定變更。

## 九項流程

| 流程 | 本輪結果 | 證據及精確邊界 |
|---|---|---|
| 1. 講師建立活動、橫直式、PPT／攝影機排版、去背 | 本機驗證通過 | 新 `live-creation-integration.db.test.ts` 4 項：真 Server Action、真 session／角色／DB，驗橫直式、時區、草稿一次消費、重送、非管理與跨租戶；Next request／CSRF 入口為 mock。presenter DB 8 項；presenter browser 13、直式實播 5、橫式實播 13、去背 18 組。媒體為合成攝影機／PPT、本機 MediaMTX；實體裝置未測。 |
| 2. 兩觀眾私訊與講師回覆隔離 | API/domain/DB＋真 React 串接通過 | 兩個獨立 browser context 以新合成身分寫入同一 DB，A/B 私訊、回覆均只回到本人；既有 DB 測試另覆蓋未登入、跨租戶、同租戶跨活動、錯誤表單、舊資料、冪等與 API 權限。不是兩份獨立 mock 證據拼成 E2E。 |
| 3. 文字、單選、快捷回應、貼圖 | 合約、DB、真 React 通過 | interaction-card browser 3 組；DB 驗本人回答、私卡、角色權限及舊 `/api/live-interactions` 不可繞過。新串接驗私人文字與公開文字；其他卡型由原實際 React＋mock API 及真 DB 分層驗證。 |
| 4. 預錄時間、同步播放與個人 replay | 本機合約／DB／瀏覽器通過 | timeline browser 6 組及 timeline DB 涵蓋 currentTime、pause／seek、倒轉、晚加入、重連、重送、server clock 與個人時間邊界。新 GET 生命週期測試涵蓋 4 秒 timeout、背景／online 撤銷舊 snapshot、晚到 body、卸載。無固定 cohort 的常青 JIT／daily／on-demand 排程不宣稱支援；外部播放器未驗。 |
| 5. 僅允許公開內容進彈幕、雙層開關 | 合約／API/DB／串接通過 | 私訊、私人卡、單選、身份欄位不投影；公開文字／快捷／貼圖與明示暖場角色依合約處理。真 DB 串接確認公開回答抵達另一觀眾、個人偏好 reload 保留、講師關閉清空。danmaku browser 5 組。 |
| 6. 暖場角色標示、停止／停用／重連／排程及統計 | 本機通過 | scripted-roles DB 4 項、browser 6 組；新跨功能測試同時寫真人私訊／私卡／公開卡／暖場，確認角色不增加真人聊天、回答、觀看數。停止、角色停用、全場開關、同步排程忽略偽造 client time、個人 replay seek 不補播均有測試。 |
| 7. 手機橫直 viewport、鍵盤與頁內全螢幕、桌面 | 桌面瀏覽器模擬通過 | mobile 10 組包含兩方向×4 viewport、縮小 visual viewport／鍵盤焦點、44px 控件／16px 輸入、頁內 fullscreen、方向不符影片完整邊框。新實際播放器串接另測 390×844、844×390、1440×900 與 Escape。手機硬體鍵盤、iOS Safari、真實旋轉仍待人工。 |
| 8. 播放／聊天／下單及資源、彈幕效能 | 本機風險測試通過；非容量認證 | `test:interactions` 清單包含 checkout／commerce 回歸；播放器、媒體與卡片 targeted tests。新 media 測試驗 heartbeat abort、ICE timer、track callback、video detach、late-offer compensation stop。queue 200 個突增仍最多20、10秒過期、去重、背景／斷線／重連不重播。去背120秒 created/terminated 3/3。未呼叫真實下單或付款服務。 |
| 9. CI 與 Production 邊界 | 版本控制內設定檢查通過；遠端未驗證 | `ci.yml` push／pull_request 無 branch/path filter；執行 ESLint 與 test:coverage。combined runner 設 disposable DB flag 後跑完整 Vitest，新 DB 與 polling 檔案會被收錄。build 子腳本只有 `next build --webpack`；`vercel.json` 禁止 master Git deployment，secure-staging 為手動固定任務。沒有 push、merge、deploy。GitHub 遠端 run／branch protection／Vercel 實際設定未讀取。 |

## 更正前次09結論

前次27檔285項、直播16檔188項另5項DB skipped只代表前次結果；lint被提前取消、typecheck沒有成功退出證據，均不是環境阻擋或PASS。`interaction-card-checks.mjs`、`interaction-timeline-checks.mjs`是前次代理自行猜測的不存在命令，原交接沒有寫錯；本輪使用實際存在的runner。前次「沒有必要修復」撤回；本輪已取得反例並修復。原browser/DB receipts不直接沿用成本輪證據。

## 本次命令與結果

所有新證據在 [integration-20260912](./integration-20260912/)，UTC 時間保留於 JSON；`source-manifest.json` 保存本輪runtime、測試、runner及CI設定的工作樹SHA。測試套件有重疊，不把各列相加當成不重複總數。

| 實際命令／階段 | Exit code、數量 | 證據 |
|---|---|---|
| `node scripts/private-chat-disposable-qa.mjs --loopback-database` | 0；5/5、0 skipped；完整 migrations、cleanup PASS | `private-chat-current.json`（本輪 receipt 的精簡副本） |
| `node scripts/private-chat-disposable-qa.mjs --verify-receipt` | 0；原 validator 接受新 receipt | 最終執行紀錄另存 `final-verification.json` |
| `node scripts/live-integration-disposable-qa.mjs --browser --browser-executable=C:/Users/eden/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe --video-fixture=tmp/live-integration-20260912/synthetic.mp4` | 0；Prisma generate/validate/deploy/status/migrationState/tests/browser 各0；8檔39/39、0 skipped；owned DB cleanup PASS | `db-1789153285435.json` |
| 上列子命令 `live-cross-feature-browser-qa.mjs` | 0；6組、pageErrors 0；Chromium 149.0.7827.55 | `integrated-browser-1789153281172.json`，`integrated-viewer.png`／`integrated-instructor.png` |
| `node tmp/integration-browser-reruns.mjs …`，串行執行10支既有runner | 最新全部0；83組；共21次嘗試，歷次失敗保留 | `browser-reruns.json` 保存每次命令、時間、exit、來源SHA、邊界與各組結果 |
| 新 polling 隔離 Vitest：polling／timeline／contract 三檔 | 修前1（15/19、4失敗）；修後0（19/19） | `card-polling-red.json`／`card-polling-green.json` |
| 新 media 隔離 Vitest：client／presenter media／background | 修前1（19/22、3失敗）；修後0（27/27） | `media-red.json`／`media-green.json`／`media-lint.json` |
| `node scripts/live-integration-checks.mjs` | 0；generate/typegen/typecheck/lint/interactions/live 全0；互動27檔285/285、直播30檔348/348，皆0 skipped | `checks-1789154189638.json`；早期typecheck失敗與OOM receipts保留，不作成功證據 |
| `node scripts/presenter-checks.mjs` | 0；generate/typegen/typecheck/lint/unit 全0；12檔161/161、0 skipped | `presenter-checks-final.json`；先前OOM及測試mock型別失敗另保留 |

`test:interactions` 是從 package.json 的真實清單取出，由隔離 Node/Vitest 執行；不是宣稱本輪執行了普通 `npm run typecheck`。Next typegen 在不含 `.env*` 的 source mirror 執行，再由同鏡像 tsc --noEmit；Prisma client 每次獨立輸出，沒有改寫使用者開發程序鎖住的 DLL。

新增可重跑入口 `scripts/live-feature-browser-checks.mjs`；本輪實際再執行 `node scripts/live-feature-browser-checks.mjs --chromium --browser-path C:/Users/eden/AppData/Local/ms-playwright 6`，exit0、13組、zero pageErrors、ZIP/執行檔SHA與TCP/UDP清理皆通過，見 `browser-entry-final.json`。這13組是presenter重跑，不重複計入83組。日後可用索引 `0 1 2 5 6 7 8` 跑Edge，`--chromium --browser-path <已安裝cache絕對路徑> 3 4 9` 跑其餘項目。

本機影片由 FFmpeg lavfi `testsrc2=size=640x360:rate=15` 產生90秒 H.264 MP4；無外部下載、無攝影機或客戶資料。SHA 見 browser receipt。10支runner明細：private-chat 4、card 3、timeline 6、mobile 10、danmaku 5、roles 6、presenter 13、portrait broadcast 5、landscape broadcast 13、background 18。

## 問題、根因與修復

1. **原 private-chat receipt INVALID**：migrationNames 缺後續 `20260911020000_presenter_layout`、`20260911070000_live_danmaku`。validator 正確拒絕過時證據。以新建且具 marker 的 loopback DB 套全部 migrations 重跑，沒有改 validator 或直接改 receipt 成 PASS。
2. **Prisma DLL EPERM**：原 presenter checks 共用生成位置。新 `live-qa-isolation.mjs` 建獨立 client、source mirror、Next typegen 與 tsc 路徑；不用終止未知程序。`presenter-checks.mjs` 也採相同隔離，Vitest envDir=false。
3. **lint 真實錯誤**：`scripts/browser-live-qa.ts` 5處 explicit any 改為 unknown 與 narrowing。一次批次替換誤改兩處 pageerror 變數，及新競態測試用了不存在的 `close` 指令，均由本輪typecheck抓到並修正（實際指令為 `end`）。新 polling 測試另修正 Vitest callback mock 簽章與 nullable card assertion，串行typecheck已確認通過。原 legacy browser-live-qa 未執行。
4. **卡片輪詢永久卡住**：舊 inFlight 只有 fetch settle 才解鎖，永不回覆的 GET 阻止之後更新。抽出最小 polling helper，4秒後 abort 並立即釋放槽位，revision 隔離晚到回應；背景／online 先撤銷 snapshot，cleanup 清 timer／listener／request。POST 增加 timeout 與卸載 abort。紅綠測試及真 API/DB browser 停住首個 GET、9秒內由新 GET 恢復均通過。
5. **媒體 cleanup**：close 未取消在途 heartbeat／ICE wait timer，remote track callbacks 未detach。加入 lifetime abort、可取消 wait 與callback清除；保留 late-offer 取得session後補 stop 的必要補償，stop 使用独立 timeout／keepalive。
6. **彈幕讀者排他鎖**：純讀原用 FOR UPDATE，兩讀者互相阻塞。新DB測試先持FOR SHARE，舊碼2秒內無法讀取，確實red；改純讀FOR SHARE，寫入保留FOR UPDATE，cursor依DBclock且仍受同交易鎖保護。另測answer/read race不漏新回答。沒有移除鎖、降低隔離或驗證強度。
7. **瀏覽器 harness**：缺空 `process.env` 導致bundle錯誤、舊提示文字、Edge間歇Windows啟動錯誤、合成 MediaRecorder 首幀時序及截圖過早。修測試依賴與selector，部分改用已安裝Chromium；保留原layout／crop／互動斷言及失敗紀錄。mobile卡住時只終止已知自己建立的Node PID，沒有關閉使用者程序。
8. **負載下的失敗**：一次35項DB run 中30人並發答題有1項 Prisma transaction start timeout；新讀鎖測試已過。減少同時進行的大型驗收後原斷言35/35、最終39/39通過，沒有提高transaction timeout。另兩個並行typecheck發生Node native OOM；保留exit並改串行。這些結果不支持Production容量承諾。

較早 DB runner 的模組解析／esbuild resolveDir 錯誤也保留在失敗 receipts；每次 owned DB 都成功清除。`db-*.json` 內完整 migration 名稱/SHA 與實際 migrationState 必須一致；非零檔數、非零測試、零skip是runner成功條件。

## 獨立審查與四面向自查

按 ai-team-pro 第一階使用實際可用的 AGY `claude-sonnet-4-6 --mode plan --sandbox`，只提供權限／domain／修復相關最小快照。第一次路徑錯誤與一次 CLI 參數錯誤未算成功。審查初輪對授權講師名單、既有鎖、revision已有保護提出不成立的主張，經路由與逐步執行序列核對後排除；沒有為迎合AI報告改動安全行為。最終六檔判定可接受，詳見 `review-initial.md`、`review-final.md`、`review-availability.json` 與最終執行紀錄。這是靜態獨立審查，測試由本輪runner執行。

- **安全性**：租戶與觀眾身份由實際guard/domain判定；跨租戶／同租戶跨活動／未登入／非管理／私訊／私卡／legacy bypass／冪等有真DB測試。新活動測試禁止所有外部fetch；無schema／正式服務變更。資料庫新建前不存在，建立後marker核對，刪除前再次核對。
- **效能**：取消失效poll及media heartbeat，讀讀鎖可並行，queue有上限／TTL／去重；worker120秒實測。無擅調coverage、assertions、測試逾時或弱化安全guard。未做目標營運併發量與長時容量認證。
- **可讀性**：polling helper集中單一觀看session的timeout、revision與cleanup；註解說明late-offer補償及DBclock鎖的理由。驗收文件明示實際失敗、重跑與mock邊界。
- **可維護性**：隔離client與source mirror共用helper；新測試沿用Vitest自動收錄，沒有另加易漏的CI檔案清單。sanitized receipt保留來源SHA、命令、退出碼與清理結果，避免沿用歷史PASS。

## 未驗證部分與最短人工步驟

1. **真機／Safari**：在核准的Preview開同一活動，iPhone Safari及Android Chrome各一觀眾；送私訊／回答，打開鍵盤、旋轉、進出頁內全螢幕，再切背景重回。確認A/B隔離、影片不中斷、輸入與送出可見；原生影片全螢幕是否能顯示互動仍依平台限制。
2. **完整Next登入與外部影音**：以測試帳號從講師登入→建立→預覽→PPT/攝影機/去背→兩觀眾登入，驗實際session、CSRF、Next導航、外部WHIP/WHEP/HLS與斷網重連。本輪CSRF unit/合約不等於這條完整路徑；本機串接使用HTTP adapter與合成登入入口。
3. **外部／長時／容量**：依核准目標併發量測連線池等待、回答延遲及drop率；真攝影機與麥克風至少30分鐘、換裝置、離頁後硬體指示燈熄滅。120秒合成去背不是30分鐘硬體認證。
4. **遠端CI／部署平台設定**：本次未授權push、merge、部署。後續授權後查看該精確commit的CI結果與實際Vercel Git production branch／自動部署設定；不能只靠本機設定保證平台控制面。

## 回滾與checkpoint

只提交本輪已确认ownership的 runtime、測試、runner、09及新sanitized evidence；不使用廣域staging。回滾使用本輪checkpoint的精確反向commit，保留後續他人修改，無DB migration回滾需求。所有disposable DB清除結果見receipt；不刪使用者DB，不做廣域Docker／tmp cleanup。

本機checkpoint hash由交付訊息回報；本文件屬該commit，避免把自引用hash寫成尚不存在的值。外部依賴／設備／遠端驗證未完成前，不標記整體release或完整E2E COMPLETE。
