# 08 預設互動角色暖場彈幕

## 完成範圍與操作

- 沿用 `InteractionRole`、`InteractionScript`、`InteractionEvent` 與原編輯器，沒有第二套角色／腳本資料表。角色可建立名稱、選擇既有內建頭像並停用；腳本可編輯文字、內建 Unicode 貼圖及既有秒數／MM:SS／HH:MM:SS 時間。
- 原腳本編輯器新增「暖場互動」範本與共用 `CARD_STICKERS` 按鈕。範本只有歡迎、鼓勵貼圖及向講師提問提示，不生成購買、成交或見證。
- 活動編輯與直播工作室的既有彈幕設定區皆接上 `ScriptedRolesControl`。先發布腳本、啟用角色的排程資格，再選取腳本；可載入手動模式、逐則預覽／發送、啟用播放時間排程，以及停止並停用目前腳本。預覽只在講師端顯示，不發送。
- 彈幕固定顯示「暖場角色／預設互動」，再顯示角色名稱與可信內建頭像。原聊天區的預編角色訊息也加上固定徽章，不能以商家自訂角色標籤取消來源揭露。
- 全場開關與觀眾個人開關沿用 07。同時最多一則、隊列最多 20，暖場訊息超過 3.5 秒便從隊列丟棄；真人回答維持原 10 秒期限。手動全場每五秒最多一則，觀眾顯示暖場也至少相隔五秒，過量直接丟棄。

## 資料與事件合約

不新增 migration。沿用 07 的 nullable `Live.danmakuState` JSONB，向後相容新增 optional `scripted`：

```ts
{ scriptId: string, enabled: boolean, scheduled: boolean,
  manual: null | { eventId: string, requestId: UUID, at: ISODate } }
```

這是活動的暖場執行設定，引用既有腳本，不更動原活動商品／CTA 腳本綁定。最多讀取 100 個文字／提醒事件；超限拒絕載入。只接受已發布、同租戶腳本及同租戶、啟用且具排程資格的角色，內容上限 160 字。其他成交、投票、優惠等事件不投影。頭像僅投影既有內建 URL 白名單，自訂外部 URL 不進暖場彈幕。

`GET /api/live-danmaku/scripted?liveId=...` 提供講師腳本清單、有效事件、執行狀態與排程能力。`POST` strict union 為 `select`、`send`、`stop`；vendorId 只取 auth session，owner/admin 才能操作。同源、client header、限流、body 上限、private/no-store 沿用既有模式。

寫入採活動列鎖；同一個目前手動 requestId 重送不重發，改換事件則拒絕，其他新發送受五秒限速。只保留目前手動事件，不建立無限待播清單。停止／換模式更新全場 epoch；角色停用、腳本取消發布或內容變動會使公開 epoch 指紋改變，清掉舊隊列。

觀眾沿用 `/api/live-danmaku` 與既有 admission。公開 state 只含 enabled/epoch/since，不暴露講師執行設定。暖場 item 增加 `source: "scripted_role"`，ID 使用 `warmup:manual:`／`warmup:scheduled:` 命名；真人 DTO 保持原匿名投影。暖場讀取只做投影，**不建立 LiveInteractionResponse、LiveInteractionRun、LiveChatMessage、觀看 session、訂單或成交證據**，因此不增加真人參與人數與回答率。

## 時間、停止與重連規則

- 同步預錄與持久化固定常青場次沿用 `resolveCardClock` 的伺服器播放位置；瀏覽器不能替全場指定時間。個人暫停不改全場時鐘。
- 既有 replay 以 `LivePlayback` 的同一個 HTMLVideoElement ref 取 currentTime。暫停／seeking／尚未載入／結束不提交個人秒數；seek 與 pause 清除已收內容。
- 排程啟用時檢查影片所屬租戶、片長、每則時間窗與至少五秒間距。未固定 cohort 的常青 JIT/daily/on_demand 仍不可啟用，真直播保留手動。
- 每次只選 `[triggerSec, triggerSec + 3.5)` 當下的一則，沒有補播事件掃描。快轉丟棄跳過的訊息；倒轉／重播不重播本頁已展示 ID。sessionStorage 保存最近已播 ID（最多 1000），重新整理同一分頁也保留；storage 被封鎖時退回本頁記憶體。這不是觀看完成或真人參與證明。
- 首次進場、epoch 變化、個人隱藏、背景、逾時及重連均沿用 07 的清空／新水位流程，最多只有當下仍有效的一則，不補播歷史批次。
- 停止與角色停用在下一次成功狀態同步時清除；輪詢間隔兩秒、請求四秒逾時。保留既有最終一致語意，不宣稱跨裝置零延遲停止。

## 相關檔案

- `src/lib/scripted-roles-contract.ts`：指令驗證、白名單投影、單則時間窗。
- `src/lib/scripted-roles.ts`：既有資料讀取、持久控場、租戶與發布邊界、共用時鐘。
- `src/app/api/live-danmaku/scripted/route.ts`、既有 `live-danmaku/route.ts`：講師控制與觀眾准入。
- `src/components/scripted-roles-control.tsx`、`live-danmaku.tsx`、`live-playback.tsx`：控制／播放／開關接線。
- `interaction-script-form.tsx`、`live-chat-panel.tsx`：暖場範本／貼圖與預編來源揭露。
- `src/lib/scripted-roles*.test.ts`、`scripts/scripted-roles-*.mjs`：單元、disposable DB 及瀏覽器證據。

## 驗證與審查

實際結果見 `scripted-roles-checks.json`、`scripted-roles-db-evidence.json`、`scripted-roles-browser-evidence.json`；先前失敗 attempts 保留，不改寫成通過。

- 無環境檔來源鏡像的 Prisma generate、Next typegen、全專案 TypeScript、相關 ESLint 與 targeted tests；最終結果於下方 checkpoint 補記。
- 真 loopback disposable PostgreSQL 套用 canonical migrations，使用 ownership marker 確認本次新建 DB 才能清除。涵蓋兩名觀眾、手動重送／限速、角色停用、停止／總開關、同步／個人播放、權限及跨租戶／跨腳本、draft 拒絕與真人紀錄零污染。auth／limiter 為合成邊界，API/domain/DB 為真實。
- 真 React、Edge 390×844 與 MediaRecorder 產生的可解碼 WebM，涵蓋本地預覽、發送／來源標示、重複 ID、個人偏好經開關及重新整理、停止、斷線不補播、HTML video 暫停／seek/currentTime 與無水平溢出。API/auth 為合成邊界，未宣稱完整正式登入 E2E。
- Terra 獨立唯讀審查發現 draft 發布邊界缺漏，已修正並補 DB assertion，再次唯讀確認關閉。未提供可呼叫的 Claude 審查工具，不宣稱執行 Claude。
- 安全：來源固定、雙租戶篩選、strict 指令、參數化 SQL、不寫真人紀錄。效能：有限查詢、有限隊列、短期限與順序輪詢。可維護性：復用原資料／時鐘／開關，新增邏輯集中具名模組。既有 Live 列鎖內增加角色查詢，高併發串行化仍需日後壓測，不在本次擴張重構。
- `.github/workflows/ci.yml` 已於每次 push/PR 跑 ESLint、型別與單元測試，沿用；未觸發遠端 CI、push、merge 或 Production 部署。

## 限制、回滾與下一功能

尚未驗證實體手機、Safari、外部直播／HLS、正式登入、多網路延遲或高併發。原生影片全螢幕的網頁疊加限制沿用 07，建議使用現有頁內全螢幕。內建頭像沿用原 DiceBear URL，未新增外部模型或 AI 對話。

回滾先停止暖場腳本，再撤除本次新增模組與精確接線 hunks；保留前序私密聊天／卡片／彈幕功能與所有真人資料。若回退原 strict DanmakuStateSchema，須保持 optional scripted 相容或先透過另外核准的精確轉換移除該設定；不得刪除回答、腳本或角色資料來回滾。本次未套用外部 migration。

後續整合驗收可沿用此 source 與開關合約；不可將 scripted_role 轉成真人來源來做 CRM、回答率或成交證據。

## 模式與 Checkpoint

已執行 ai-team-pro 切換，router status 確認為 ai-team-pro；受保護 `.codex/config.toml` 的 model/model_reasoning_effort 仍是原設定，完整切換未成功，不繞過权限或宣稱改變目前 session 模型。進場已有大量前序未提交變更，只擁有本次新增檔與明列接線 hunks，不整批納入未知變更。

最終驗證：`node scripts/scripted-roles-checks.mjs` 全部 phase exit 0，9 檔 132 項 targeted tests 通過；生成的來源鏡像與最終本次程式檔 hash 核對一致。最終兩個 QA runner 另跑 ESLint 零警告。`node scripts/scripted-roles-disposable-qa.mjs` 的暖場與既有真人彈幕共 8/8 項通過，validate/migrate/cleanup 全通過。`node scripts/scripted-roles-browser-qa.mjs` 六項通過、pageErrors=0，包含新手動訊息正在顯示時停止並驗證清空。`git diff --check` 通過。

已目視檢查手機講師控制畫面；最終截圖為 `scripted-roles-controls-1789129361912.png`、`scripted-roles-mobile-1789129331479.png`。歷次 runner 修正包括同步測試改用 PostgreSQL clock 避免窄時間窗漂移、standalone 瀏覽器 harness 補上 Next Link 所需 process define；失敗保存在 receipt，未降低產品 assertion。

已使用本次明確新增檔案清單嘗試 `git add -- ...`；Git 因無法建立 `.git/index.lock`（Permission denied）拒絕。因此未 stage、未建立 checkpoint commit，**沒有 commit hash**。未繞過權限、未 push／merge／部署；所有實作與證據保留在工作目錄。
