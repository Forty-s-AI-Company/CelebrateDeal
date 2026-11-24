# CelebrateDeal 領域工作流程

這份文件是 `.claude/skills/celebratedeal-*` 六個專案技能的領域參考，補充產品驗收需求。技能只提供薄入口，不啟動團隊或排程。

依任務讀取對應段落，核對目前程式與資料契約。歷史規格或成功收據不能證明本次版本已交付。

## 產品與角色

每個流程明確記錄 actor、tenant、入口、權威資料、狀態轉換、失敗／續行／退款／逾期／取消、audit 及外部相依。跨模組時對照現行 [API 契約](codex-goal/API_CONTRACT_REGISTRY.md)、[Prisma 不變量](codex-goal/PRISMA_INVARIANTS.md) 與 [工作矩陣](remaining-capabilities-work-matrix-20261005.md)，再決定是否增加抽象。

| 角色 | 可用範圍 | 必須驗證的界線 |
| --- | --- | --- |
| Platform admin | 平台帳務與明確授權的全域維運 | MFA、audit；不得冒用商家活動 |
| Organization owner | 自己的商家、成員、商品、直播與帳務 | 另一租戶不可讀寫 |
| Instructor／upline | 明確授權的課程、直播、商品與推薦政策 | 不可修改平台結算規則 |
| Promoter／downline | 自己的推薦連結與允許的 storefront override | 轉換後不得改佣金快照 |
| Staff | 明確授予的功能 | 不推定 owner／finance 權限 |
| Visitor／buyer | 公開互動及已購買的權益 | 不可存取後台、私人分析或他人的訂單 |

區分 live、scheduled prerecorded、VOD、preview 與 published；區分 visitor、lead、click、checkout、paid、refund、commission、payout。官方／AI／system 互動角色與腳本化虛擬使用者只存在於觀眾端聊天室（2026-10-18 owner 決策，允許不標示的虛擬觀眾帳號）；它們的發言、觀看與互動不得計入商家後台的報名、訂單、付款、成效統計或任何 conversion。外部 storefront 流程依序使用有效 promoter URL、vendor default URL、click event；只有 API、webhook、核准匯入或 reconciliation 的訂單證據可計入 conversion。

### 指定場次（fixed sessions）

一場預錄直播（VOD、非常青、影片長度已知）可設多個開播時間（`Live.sessionMode = fixed_sessions`，`LiveSession` 列）。權威資料與規則：

- **報名與名額**：報名者在報名頁選一個場次（`liveSessionId`）。送出當下以條件式 UPDATE 佔位（`open`、未過開始時間＋截止分鐘、未額滿）；同一 IP 對同一場次另有限流。未在 48 小時驗證期限內完成 Email 驗證的報名，名額由 email job 或過期連結的驗證請求釋放一次（`liveSessionSeatReleasedAt`）；之後以同一 Email 重新報名會重新佔位並寄出新的驗證信。
- **換場次**：以同一 Email 重新報名、選另一個場次時，只在原場次尚未開始（或已取消）時才換；已驗證的報名還必須是原瀏覽器（持有該筆報名的簽章 cookie），或原場次已取消。只知道 Email 不能移動已確認的報名。換不了場時，原瀏覽器收到 409 並被告知目前的場次（「你已報名 {日期時間} 場次」）；其他人得到與全新報名完全相同的回應（目標場次可報名時是一般的成功與「請查看確認信」，額滿或關閉時是同樣的錯誤），真正的報名者則收到一封通知「你已報名 X 場；如需換場請在原裝置操作」，信中附一個「更換場次」連結（見下方）。因為任何知道 Email 的人都能觸發這封信，它不是免退訂的服務通知：信中附退訂連結，名單退訂（`recipient_request`）、退信／投訴與黑名單都會擋（建立時與寄送前各查一次）；同一筆報名對同一個要求的場次每 24 小時區間最多一封，整筆報名在任一滾動 24 小時內最多三封（以每筆報名的 advisory lock 計數，併發也不會超過）。不設終身上限：信中的換場連結 24 小時就過期，終身上限會讓知道 Email 的人把配額用完，真正的報名者在新裝置就再也拿不到可用的連結。**已接受的剩餘風險**：直接呼叫 API 的人仍能從 Set-Cookie 分辨全新報名與被隱藏的重複報名——全新報名會設定感謝頁結果 cookie 與既有的 LINE 綁定 capability cookie，重複報名兩者都不設；HttpOnly 只擋得住頁面腳本，擋不住 raw API 呼叫者。這個差異以既有的每 IP 限流（每分鐘 10 次、每場次 10 分鐘 5 次）減緩，不宣稱能完全防止以 Email 探測報名狀態。並行變更造成換場失敗時回 503 請對方重試，不顯示假的成功。感謝頁的場次只來自伺服器簽章、HttpOnly 的結果 cookie（`/lp` 頁面在伺服器端驗章並比對 liveId），沒有它時只顯示中性的「請查看確認信」；JSON 回應只對原瀏覽器附上場次。無 JavaScript 的表單重試以加密 draft 的 reason 區分「已報名其他場次」與「場次額滿或關閉」。場次取消後完成驗證的報名者，驗證頁的重選連結由伺服器依簽章 cookie 解析，不接受網址參數。換場後提醒改依新場次排程，舊場次未寄出的 Email／LINE 提醒取消。
- **取消場次**：Studio 移除有報名的場次時改為取消，不刪報名。未寄出的提醒（Email live_reminder、before_live、during_live、LINE live_reminder）在同一交易取消；每位已驗證報名者收到一封「你報名的場次已取消，請重新選擇場次」，連結依序為公開可用（含專案已發布）的一頁式網站、報名表、直播觀看頁。在取消後才完成 Email 驗證的報名者，收到的是這封取消通知而不是確認信，驗證頁也提示重新選擇。這封信屬交易型服務通知：平台固定文案、無行銷內容、無退訂連結；商家名單退訂（`recipient_request`）不擋，黑名單與退信／投訴類停寄仍擋。重新加入相同時間即恢復該場次。
- **時間**：確認信、提醒、課後通知（場次開始＋影片長度＋規則分鐘數；只寄給實際播完的場次：直播被改回草稿後不再寄，商家結束直播時只寄 `endedAt` 前已播完的場次）、觀看頁倒數與播放位置、admission 與回放期限都依報名者的場次。漏斗的共用開始／結束時間不擋指定場次直播的播放入口（與常青相同，交給觀看頁）。指定場次直播不能手動「開始直播」，也不發 LINE「直播開始」通知；共用的腳本互動（投票、抽獎）不在指定場次直播執行。
- **換裝置換場（更換場次連結）**：已報名通知信附 `/live-session-switch?token=…`。token 以 derived key `live-session-switch` 簽章，綁 vendor、報名與寫信當下持有的場次，24 小時、只能用一次。開啟連結只顯示確認頁（只驗章、不讀寫 DB），信件掃描器的 GET 不會用掉它；按下確認才 POST `/api/live-session-switch`（必須帶完全同源的 `Origin`，`null` 一律拒絕，避免外站把別人的報名 cookie 種進來；確認頁因此用 `Referrer-Policy: same-origin`，頁面不載入外站資源，token 不外流）：報名須已驗證、仍持有連結上的場次、場次未開始（已取消例外），通過後寫入 `LiveSessionSwitchRedemption`（主鍵＝nonce 的 SHA-256，第二次或併發兌換失敗），給這台裝置該筆報名的簽章 cookie（等同重新驗證 Email），再導回伺服器解析的公開報名頁；報名者用同一 Email 選新場次即依上面的換場規則移動。報名目前持有的場次與連結上的不同時，連結即失效（換場成功後舊連結都不能用；若之後又換回原場次，尚未使用且未過期的舊連結會再生效，仍受 24 小時與單次使用限制）。偽造、過期、已用與已換場的連結共用同一個「連結無效或已過期」回應。**已接受的取捨**：兌換給的是 30 天、完整的報名 cookie（與驗證 Email 相同的能力，含聊天身分、LINE 綁定與結帳關聯），而非只能換場的短效 cookie；同一瀏覽器原有的其他報名 cookie 會被覆蓋。被轉寄的信或會按表單的信件沙箱可能用掉連結，此時報名者 24 小時後再選同一場次可收到新連結。
- **換裝置觀看**：觀看頁以報名驗證後設定的簽章 cookie（30 天）辨識報名者。在沒有這個 cookie 的裝置（例如在電腦報名、用手機開信）上，觀看者跟隨公開時程：正在播的場次，否則下一場，最後一場之後則是最近一場的回放。這是 Phase 1 的已知限制。例外：從提醒信或 LINE 通知的個人觀看連結進場的裝置，會跟隨那筆報名自己的場次（A2-10；自己的場次已取消，或還沒開始而其他場次正在播時，仍跟隨公開時程；見下方「個人觀看連結」的「指定場次的場次提示」），但仍不給報名 cookie。
- **公開回放**：每場回放期限是「場次結束＋`sessionReplayWindowHours`」與直播 `replayAvailableUntil` 中較早者。沒有 cookie 的觀看者在最後一場之後看到的是最後一場的回放，所以任何人在回放開啟期間都能看到回放，不限於報名者；與單一開播時間的直播相同，回放不是報名者限定內容。

### 個人觀看連結（Q-17）

報名者在手機（Gmail、LINE 內建瀏覽器）點驗證信、之後改用電腦看時，電腦沒有報名 cookie，觀看不會記成出席，會被「報名後未出席」誤判。提醒信與開播通知因此附上每位報名者自己的觀看連結；打開它只會讓那台裝置的觀看記成該報名出席，不給任何其他身分。程式在 `src/lib/live-watch-link-token.ts`、`src/lib/live-attendance-cookie.ts`、`src/lib/live-watch-link.ts`、`src/app/api/live-watch-link/route.ts`、`src/lib/live-registration-attendance.ts`。

- **寄送點**：Email `live_reminder`（`ensureLiveReminderDelivery`：驗證後排程、指定場次換場與提醒 reconciliation 都經過它）、Email `before_live`／`during_live`（`live-notification-delivery.ts`）、LINE `live_reminder`／`live_started`（`line-notification-materializer.ts`）與 Studio 開播時的 LINE `live_started`（`line-live-started.ts`）。Email 在商家內文之後、退訂連結之前固定加一行「你的個人觀看連結（從這裡進場會記錄你已出席；轉寄給別人時，對方的觀看也會記在你名下）：…」；`{{live_url}}` 仍是公開觀看頁（商家範本可能請收件人分享它）。LINE 的「立即進場」按鈕改成個人連結。確認信、課後信、自動化 Email（含 `form_no_show` 的回放信）、序列信與指定場次取消通知不變。
- **連結 token**：`lwl1.<claims>.<HMAC>`，derived key 用途 `live-watch-link`（tier 2，沒有 legacy key）。claims 只有 vendorId、liveId、報名 id 與期限，沒有 Email 或其他個資。
- **期限**：報名者場次開始後 30 天（寄送時場次已開始則從寄送時起算），另有 400 天總上限。依伺服器紀錄的場次開始時間（指定場次是報名者自己的場次、其他是排定或實際開播時間）計算，不是依寫信的時間，所以同一封提醒每次重算都是同一個連結。過期後打開只會到一般觀看頁。不採「直播結束＋回放期限」：回放期限可由商家修改、指定場次各有回放窗，信寫出去之後無法跟著變；30 天涵蓋直播與一般回放，過期的代價也只是回到一般觀看頁。
- **開啟**：`GET /api/live-watch-link?token=…`，只讀不寫。驗章後，最後一次查詢再綁 claims 的報名、直播與商家：報名屬於這場直播、`VERIFIED`、表單屬於該商家，直播屬於該商家且商家未凍結（F-036）。通過時**只設定這場直播的出席 cookie**，303 到 `/live/{slug}`，網址列不留 token（回應 `Referrer-Policy: no-referrer`、`private, no-store`）。報名 cookie 不讀也不改。任何失敗都不設 cookie、不說明原因：簽章正確（含過期）的連結導到它指的直播觀看頁，其他導到首頁。每 IP 每分鐘 60 次（`RATE_LIMIT_PROVIDER=cloudflare_waf` 時與其他 route 相同，改由 WAF 依來源 IP 限流）。
- **出席 cookie**：`lat1.<claims>.<HMAC>`，derived key 用途 `live-attendance`（tier 2，沒有 legacy key），claims 是 vendorId、liveId、報名 id 與期限（與連結相同）。每場直播一個 cookie（名稱 `celebratedeal_la_` 加 liveId 的雜湊，不同直播的連結互不覆蓋），HttpOnly、`SameSite=Lax`、https 時 `Secure`、`Path=/api/live-admission`（只隨這一個 route 送出），Max-Age 到連結期限為止。**只有** `/api/live-admission` 的觀看紀錄寫入會讀它（見下方「報名後未出席直播」的「觀看紀錄」）：驗章、claims 的 liveId／vendorId 必須等於這次入場，寫入時再綁一次這場直播、`VERIFIED`、表單屬於該商家。聊天、私訊、互動、LINE 綁定、結帳、常青場次紀錄等都只讀報名 cookie（指定場次的場次判斷另讀下面的場次提示 cookie，不讀出席 cookie），名稱、金鑰與格式都不同，出席 cookie 的值放到報名 cookie 名下也驗不過；測試 `src/lib/live-attendance-cookie.test.ts` 另掃描原始碼，確認只有連結與觀看紀錄寫入引用它。
- **兩個 cookie 都有時**：報名 cookie 指向這場直播的合格報名時，只記那一筆（以完整報名 cookie 為準，5 分鐘內的重複入場也不會改記出席 cookie 那筆）；報名 cookie 屬於別場直播或不合格時，才記出席 cookie 那筆。兩者在同一個 SQL 敘述內依優先順序選一筆。
- **掃描器與預覽**：這個 GET 不寫任何資料列；觀看紀錄只在 `/api/live-admission` 放行播放時寫入。只抓連結、不執行 JavaScript 的信件掃描器或連結預覽，最多拿到一個出席 cookie，不會產生觀看紀錄。**殘餘風險**：會執行 JavaScript、而且在直播或回放期間打開觀看頁的信件沙箱，會像真的觀眾一樣取得入場而被記成出席（`during_live` 與開播通知最可能）；誤判方向是少寄一封未出席信。
- **可重複使用與轉寄（已接受的取捨）**：同一個人的多台裝置都要能用，所以連結不是單次使用。連結被轉寄、公開分享，或被人放在站外誘導別人打開（GET 連結做得到，Email 驗證與更換場次的同源 POST 做不到）時，後果只有一個：打開者的觀看會記成該報名者出席，`form_no_show` 因此不會寄給該報名者。打開者不會取得聊天身分、私訊、LINE 綁定或結帳關聯，在聊天室與結帳時就是一般訪客（2026-11-17 決定）。信中的提示據此寫成「轉寄給別人時，對方的觀看也會記在你名下」，而不是「只限本人使用」。
- **換裝置後的代價**：從個人連結進場的裝置不是報名者身分：聊天室不能以報名者發言、看不到自己的私訊、結帳不帶報名關聯。指定場次直播跟隨報名自己的場次（A2-10，見下一點）。需要完整報名身分的人仍要在那台裝置完成 Email 驗證或使用更換場次連結。
- **指定場次的場次提示（A2-10，#634 方案 b）**：指定場次直播的個人連結，在設出席 cookie 的同時再設一個**場次提示 cookie**。非指定場次的直播只設出席 cookie，行為不變。
  - **格式**（#669 審查 MINOR-3）：`lsh1.<報名 id>.<到期秒數>.<HMAC>`，與出席 cookie 同一把 derived key `live-attendance`。vendorId 與 liveId 不放進 token（縮小尺寸），但 HMAC 涵蓋版本、vendorId、liveId、報名 id 與到期時間，所以只有在讀取端指定的那場直播與商家才驗得過，最後一次查詢也再綁一次商家。出席 cookie 的格式與簽章內容不同，兩者互不通用。名稱 `celebratedeal_lsh_` 加 liveId 的雜湊；HttpOnly、`SameSite=Lax`、https 時 `Secure`、`Path=/`。
  - **期限**（MINOR-3）：取「開連結當下報名所屬場次的觀看窗結束」與連結期限較早者，token 裡的到期時間與 Max-Age 相同。觀看窗結束是：回放關閉時為場次結束（場次開始＋影片長度）；回放開啟時為場次回放截止（`sessionReplayWindowHours` 與直播 `replayAvailableUntil` 較早者，不早於場次結束）；回放沒有任何截止時為連結期限。開連結時觀看窗已經結束就不設提示。之後換到更晚場次的報名者，提示在舊場次觀看窗結束時失效，改用新場次提醒信裡的連結即可。
  - **唯一用途**：`resolveViewerFixedSession`（`src/lib/live-fixed-sessions-store.ts`）決定這台裝置跟隨哪個場次。觀看頁、`/api/live-playback-source`、`/api/live-admission` 三處用同一組 cookie 呼叫它，所以頁面倒數、影片起點與入場放行一定是同一個場次。`Path=/` 是因為觀看頁（`/live/{slug}`）與兩個 API 都要看得到它，三者才會一致；聊天、私訊、互動、LINE 綁定、結帳、觀看紀錄寫入與常青場次都不讀它（`src/lib/live-attendance-cookie.test.ts` 掃描原始碼確認只有 resolver 讀它，resolver 的包裝只被這三處呼叫）。
  - **優先順序**：本直播、`VERIFIED`、表單屬於該商家、場次屬於該商家與直播的報名 cookie 優先；報名 cookie 沒有、屬於別場直播或不合格時，才用場次提示；兩者都沒有合格報名時跟隨公開時程。`resolveViewerFixedSession` 回傳的 `source` 分別是 `"registration"`、`"session_hint"`、`"public"`，只有報名 cookie 會得到 `"registration"`（MINOR-2），提示不被當成報名者身分。
  - **綁定**：驗章時以這次的 vendorId／liveId 重算 HMAC；最後一次查詢再綁報名屬於這場直播、`VERIFIED`、表單屬於該商家、場次屬於該商家與直播（與報名 cookie 完全相同的條件）。cookie 只帶報名 id，**場次每次都從資料庫讀**：報名換到別的場次就跟著新場次（新場次的時間窗照下一點處理），開連結當時的舊場次不會再被當成提示場次（舊場次若正在播，裝置是以公開時程身分看它，觀看進度不累計）；報名不再是 `VERIFIED` 或被刪除時退回公開時程。
  - **時間窗**（MINOR-1：連結是 GET，提示可能被站外頁面植入或被轉寄，所以提示只能讓裝置「多看到自己的場次」，不能把它鎖在別人看得到的場次之外）：
    - 提示指向的場次**已取消**：當作沒有提示，跟隨公開時程。
    - 提示指向的場次**還沒開始**，而公開時程上有場次**正在播**：跟隨正在播的那場。這時入場回報的 `fixedSessionId` 不是報名的場次，觀看進度不累計。
    - 提示指向的場次還沒開始、而且沒有場次正在播：跟隨自己的場次（等待中，不會提早放行；公開時程此時也沒有可放行的場次）。
    - 提示指向的場次已開始而且**還能看**（播放中或回放中）：跟隨自己的場次，是否放行由與報名 cookie 相同的 `resolveFixedSessionRuntime` 決定。
    - 提示指向的場次**已結束而且沒有回放**（A3-04，#669 複審 MINOR-A：開連結後商家關了回放、`sessionReplayWindowHours` 或直播 `replayAvailableUntil` 已過，或報名被改到一個已結束的場次）：當作沒有提示，跟隨公開時程（正在播的場次，否則下一場，否則最近一場）。回放規則用三個呼叫點這次請求讀到的同一筆直播資料判斷（`replayEnabled` 與 `fixedSessionReplayAvailableUntil`，截止時刻當下即算結束，與 `resolveFixedSessionRuntime` 相同），所以每次請求都依當下設定重新判斷；播放中或還沒開始的提示場次不受回放設定影響。
    - **報名 cookie 維持原規則**：自己的場次已取消時停在已取消的場次（不播放，不改跟公開時程），還沒開始時即使其他場次正在播也不放行。
    - 三個呼叫點用同一個 resolver，所以觀看頁、播放來源與入場一定一致。
  - **觀看紀錄與進度**：出席 cookie 與觀看紀錄寫入不變。**提示會決定入場放行的場次，因此間接影響出席與觀看進度的累計時機**（#669 NIT-2）：入場放行的是報名自己的場次時，`/api/live-admission` 回傳的 `fixedSessionId` 等於報名的 `liveSessionId`，`LiveWatchProgress` 照 #647 MINOR-1 的條件累計；自己場次的回放入場也會記為出席（解除原本的審查 m-1 限制）；依上面的退路改跟公開場次時，出席照 Q-17 記錄，觀看進度不累計。
  - **舊連結**：A2-10 上線前打開連結的裝置只有出席 cookie、沒有場次提示，仍跟隨公開時程（原本的審查 m-1 限制），重新點一次提醒信或通知裡的連結即可。後台 `FORM_NO_SHOW_DETECTION_NOTE` 的「指定場次直播在其他場次結束前，從個人連結觀看自己場次的回放不會記為出席」暫時保留，舊 cookie 自然過期（場次開始後 30 天）後可以移除。
  - **尺寸與上限**（MINOR-3，以 25 字元的 cuid 實測）：場次提示 cookie 一場 128 bytes（含名稱），`Path=/` 隨同網域每個請求送出；出席 cookie 一場 241 bytes，只隨 `/api/live-admission` 送出。入場請求同時帶兩者，每場指定場次直播約 373 bytes（含 `; ` 分隔），原本的設計約 490 bytes。Node 預設整個請求標頭上限 16 KiB（`/api/live-admission` 的出席 cookie 讀取器也只讀 16 KiB 以內的 Cookie 標頭），假設其他標頭與 cookie 佔約 3 KiB，入場請求約可容納 35 場「兩個 cookie 都還有效」的直播，或約 54 場只剩出席 cookie 的直播（混合時以 241 × 出席 cookie 數＋132 × 提示數 ≤ 約 13 KiB 估算）；超過時整個請求被 431 拒絕，不只是少一個 cookie。提示只活到該場觀看窗結束，出席 cookie 活到連結期限（場次開始後 30 天），所以實際同時存在的提示通常遠少於出席 cookie。其他頁面請求只帶提示，一場約 130 bytes。
  - **殘餘風險**：上面的 431 上限是瀏覽器在 30 天內打開大量不同直播個人連結的極端情況。轉寄或被站外植入的連結讓對方跟隨報名者的場次，但依上面的時間窗退路，不會被擋在正在播的公開場次之外；不給任何身分，與 Q-17 已接受的轉寄取捨相同。
- **未採用的做法**：給完整報名 cookie（第一版）：轉寄或站外誘導就能讓別人讀寫報名者與講師的私訊、以報名者名義發言，風險過高。「第一次使用時綁定裝置」：需要新資料表與 migration，第一個 GET 常是信件掃描器，會把連結綁給掃描器，也正好擋掉同一人的第二台裝置。「確認頁＋同源 POST」：多一次點擊，被誘導的人一樣會按，對轉寄與分享沒有實質幫助。

### 常青場課後信（F-2）

常青場（`isActiveEvergreenLive`）的觀眾場次只存在簽章 httpOnly cookie。課後信（`post_live_followup`）依常青模式分兩種：

- **商家設定共用開場時間（`evergreenSessionStartAt`）**：這場等同單一固定時間的場次。排程對**看過的已驗證報名者**以**目前的**共用開場時間計算（開場＋影片長度＋規則分鐘數），走一般單一時間的路徑，不讀也不寫 `EvergreenSessionAssignment`。「看過」＝這位報名者有 `LiveRegistrationAttendance`，且 `lastAdmittedAt` 不早於目前的共用開場時間（入場播放或回放；與 `form_no_show` 的出席判斷同一份紀錄，個人觀看連結也算）；沒看過的人這一輪回報 `not_watched` 略過、不建立任何寄送列，之後有入場紀錄就會在下一輪補上。商家把開場時間往後移後，只看過舊時間的人要看過新時間才會收到。商家改動開場時間時，舊時間尚未寄出的那封在寄送前被 supersede，新時間到期才寄；已寄過就不再寄。共用場次結束後才完成驗證、但之後入場看過的報名者，下一輪排程就會收到所有已到期的課後信（每條規則各一封）。
- **逐觀眾場次（即時入場、每日固定場次、隨選播放）**：權威資料是 `EvergreenSessionAssignment`（每筆報名一列），只有「在同一個瀏覽器完成 Email 驗證並進入觀看頁」的報名者會有列，常青期間只寄給他們。

逐觀眾場次的規則：

- **記錄時機**（皆需同一瀏覽器上有效的報名簽章 cookie `FORM_SUBMISSION_CHAT_SESSION_COOKIE`，且報名屬於這場、已驗證）：
  - `POST /api/live-evergreen-session`（claim／rejoin）回應已指派場次時記錄。
  - Email 驗證成功時，若請求帶的常青 cookie 解析出已指派場次（先進觀看頁、後驗證）也記錄。
  - 瀏覽器已有常青 cookie（觀看頁 client 不會再 claim）時，觀看頁（Server Component，只讀）若發現這位報名者目前的場次尚未記錄（沒有相同 fingerprint、開始時間不早於目前場次的列），就給 client 一個 `recordRegistration` 旗標，client 送一次 claim（沿用既有場次）由 Route Handler 寫入。沒有報名 cookie 或沒有逐觀眾場次的訪客不會多任何查詢。
  - GET 不寫入；寫入失敗只回報監控，不影響回應。
- **綁定**：寫入是單一條件式 `INSERT ... SELECT ... ON CONFLICT`，只從「這場直播、`VERIFIED`、表單屬於這個商家」的報名取 id；`(vendorId, liveId)` 與 `(liveId, formSubmissionId)` 複合 FK 再綁一次。`sessionStartAt` 只來自伺服器解析的場次。
- **更新規則**：排程 fingerprint 不同就取代；相同時只往較晚的場次移（兩個瀏覽器各有場次時以較晚者為準）。
- **寄送**：排程取 `sessionStartAt` 在「現在 − 影片長度 − 規則分鐘數」之前、72 小時內的列（逾期超過 72 小時不補寄），排除這位報名者在這條規則底下已有非 `superseded` 課後信的列，依場次開始時間由舊到新、每輪最多 `recipientLimit` 位；Email 無法使用的報名者跳過且不佔名額。以場次開始時間當 `liveScheduledAt` 建立快照；`{{live_start_at}}` 是觀眾自己的場次（與指定場次相同，以 Asia/Taipei 顯示）。不看 fingerprint：排程改掉之前已指派的場次照記錄的時間寄。寄送前檢查重新讀這位報名者的 assignment，場次不同或沒有 assignment 就不寄。
- **一位報名者、一條規則最多一封**：rejoin 把場次往後移時，舊場次尚未寄出的那封在寄送前被 supersede，新場次到期後的下一輪才建立新的那封；模板改版也一樣（舊版在寄送前被 supersede，下一輪建立新版）。已寄過就不再寄。
- **owner 2026-11-23 決定（Q-17，A4-02 已實作）**：課後信只寄給看過直播的報名者，三種模式一致。「看過」的依據在逐觀眾模式是 `EvergreenSessionAssignment`（驗證過的瀏覽器開啟觀看頁就記錄），共用開場時間與常青結束後補寄沒有這種列，改用 `LiveRegistrationAttendance`（`/api/live-admission` 入場紀錄）。兩者不同：場次列只代表開過觀看頁，入場紀錄代表實際被放行播放；後者不受「驗證與觀看要同一個瀏覽器」限制，個人觀看連結也會記錄。沒看過的人不建立寄送列，只在 job 回應回報 `not_watched`。寄送前檢查也會再確認一次：已排入但沒有入場紀錄的列在寄送前被 supersede。
- **常青關閉、結束或改回草稿**：沿用 #582，依原開播時間補寄，但只補寄給有入場紀錄（任何時間）的報名者；常青期間已收到同一規則課後信的人不會再收到。範圍是 `isEvergreen` 仍為開啟、但目前不生效（已結束、草稿等）的直播；商家把 `isEvergreen` 關掉後，系統無法分辨它曾是常青場，就當作一般固定時間直播，仍寄給所有已驗證報名者。指定場次直播與從未設定常青的直播不受影響。
- **設定重存**：常青生效時儲存常青設定，會在 commit 後把這場直播所有排隊中的課後信標為 `superseded`（`supersedeFixedTimeNotificationsForActiveEvergreen`）；這些報名者會重新出現在排程查詢，若場次仍在 72 小時內，下一輪依同一個 id 重新啟用；超過 72 小時的就不再寄。
- **涵蓋不到的情況**（不是錯誤，是目前設計的限制）：
  - 在 A 裝置看、在 B 裝置驗證：A 沒有報名 cookie，不會記錄；B 只有在自己進入觀看頁後才記錄 B 的場次。
  - 報名 cookie 是全域單一 cookie，以最後一筆報名為準：同一瀏覽器報名多場常青直播時，只有最後那場會記錄。
  - 回訪或換裝置 rejoin 會把場次往後移，尚未寄出的課後信跟著延後。
  - 從未在已驗證的瀏覽器進入觀看頁的報名者，常青期間不寄。
  - 商家把共用開場時間移除、改回逐觀眾模式後，只在共用期間看過、之後沒再進觀看頁的報名者不會被記錄，逐觀眾期間收不到課後信（共用期間已寄出的仍算數，同一規則不會再寄）。

### Email 追銷序列（F-3，封測）

設計見 `docs/product/delayed-steps-design.md`。商家要有平台在 `/admin/vendor-features` 開通的 `email_sequences`，owner／admin 才能在 `/messages/sequences` 管理；開關關閉時頁面 404、Server Action 拒絕、不加入新的人、job 不執行該商家的進度（進度保留），已排隊還沒寄出的序列信在寄送前被略過。

- **對象與起點**：一條序列綁一場直播。報名者完成 Email 驗證時加入該直播「寄送中」的序列，起點是驗證時間；只加入 `verifiedAt >= activatedAt` 的人（啟用或暫停後重新啟用都不回頭寄）。加入當下已退訂、在黑名單或 Email 無法使用的人記成「已停止」、不會收信，之後重新訂閱或解除封鎖也不會自動加回。同一個 Email 從不同表單報名同一場，同一條序列只收一份。驗證路由加入失敗只回報，job 每輪補過去 48 小時漏掉的人。
- **步驟**：每一步是「驗證後幾分鐘」寄一封 `sequence_email` 模板（1 小時到 90 天，後台以小時／天輸入），同一條序列的時間不重複。job 每輪每人最多推進一步；某一步的時間已過 24 小時就跳過不寄。商家中途修改時：比目前進度早的新步驟不補寄、停用的步驟直接跳過、改延遲的步驟照新時間；同一封對同一個人最多寄一次，改了時間也不重寄，被移到某人目前進度之前的那一封他不會補收。精度等於 job 頻率。
- **寄信**：每一步是一筆行銷信，一定附退訂連結，走既有寄送流程；寄送前再確認商家仍有授權、序列仍寄送中、步驟與模板未改、收件人不在黑名單、序列開啟「買了就停」時收件人報名後沒有購買、這封建立未超過 6 小時（排隊超過 6 小時被略過的信，那一步對那個人不會再寄）。沒有設定寄信服務時，job 不建任何序列信，進度原封不動。只改模板內容時，已排隊還沒寄出的那一封會被略過、不改寄新版本。寄送中的序列在用的模板不能停用或改觸發條件；仍遇到不可用的模板時，那一步約每 5 分鐘重試，逾期 24 小時才跳過。
- **吞吐量**：序列工作排在每輪 job 的最後（補漏 → 推進 → 寄序列信）；這一輪已跑超過 60 秒就整段留給下一輪（記一筆監控事件），100 秒後不再接新項目，整輪在排程 runner 的 120 秒逾時前結束。有時效的信與序列信各用每輪 20 封的寄送額度；worker 每輪只建「20 封減去仍在佇列的序列信」，從隨機的商家開始、每家份額依剩下的額度與商家數重算，用不完的再分給仍有到期 run 的商家；同一人前一封還在佇列時下一步會等。全平台約「每輪 20 封 × job 頻率」（每 5 分鐘一輪＝每小時 240 封；每小時一輪＝每小時 20 封），大場次排在後面的人可能晚數小時，晚超過 24 小時的那一步會被跳過。開放給一般商家前由 owner 決定 job 頻率與額度（`docs/product/delayed-steps-design.md` 第 9 節）。
- **停止**：退訂（同一交易停止該收件人在這個商家所有進行中的序列）、黑名單、序列暫停（進行中的人停止，重新啟用不復活）、序列刪除、報名刪除、「買了就停」（見下）。進度因重試用完而停止（`failed`）時，已排隊還沒寄出的序列信在寄送前仍會被略過（寄送前檢查只放行進行中或已完成的進度），這點與自動化延遲步驟不同（後者 `failed` 已排隊的信照寄，見下方「延遲步驟」）。
- **買了就停（F-3 PR 2）**：每條序列一個開關（`EmailSequence.stopOnPurchase`），新序列預設開啟，在序列編輯頁勾選，列表顯示目前設定。
  - **購買的定義**：同一個商家、同一個客戶鍵（`automationCustomerKeyHash`：報名 Email 與訂單買家 Email 以 trim＋小寫正規化後的商家專屬雜湊，和學員專區、CRM、自動化同一套）的 canonical 訂單（`CommerceOrder`），在**這筆報名建立之後**付款（`paidAt >= FormSubmission.createdAt`），且不是測試訂單。任何商品都算，不限這條序列綁的直播或專案。訂單狀態是已付款、部分退款或全額退款都算（付款確實發生過）；未付款、付款失敗、逾期、取消不算。報名前就付款的舊訂單不算（老客戶報名新的直播仍會收到這條序列）。其他商家的訂單一律不算。只判斷「有沒有」，不讀金額、商品或買家資料。
  - **判斷點**：(1) job 推進每一個人的下一步時、建信之前查；命中就把這個人的進度標成已停止（`cancelled / purchased`），之後的步驟都不寄。商家剛好同時存檔改了設定時，這一輪放棄、下一輪依新設定判斷。(2) 已排隊還沒寄出的序列信，寄送前再查一次（含最後一封、進度已完成的情況）：命中就不寄，寄送紀錄顯示「收件者報名後已在你這裡買了商品……」（`sequence_recipient_purchased`；商家手動重排的路徑顯示一般的 `sequence_superseded`）。
  - **付款流程不變**：付款 webhook、交易與回應沒有新增任何讀寫，也不在付款當下主動停止進度；所以付款後到下一步到點前，後台仍把這個人算在「進行中」，到點時才改成「已停止（其中因購買停止）」。已排隊的那一封在寄送前就會被擋，不會寄出。
  - **不恢復**：一旦因購買停止就不會恢復；退款（部分或全額）不會讓序列重新開始。退款發生在下一步到點之前也一樣停止，因為付款確實發生過。商家之後關掉開關，也不會讓已停止的人恢復。
  - **併發**：job 沒看到付款（付款尚未 commit）而建了那一步的信時，寄送前的檢查一定看得到已 commit 的付款而擋下。唯一的剩餘視窗是付款剛好在「寄送前檢查已通過、呼叫寄信服務之前」commit，那一封會寄出，之後的步驟仍會停止。
  - **後台**：`/messages/sequences` 每條序列的「已停止」人數下方另列「其中因購買停止 N 人」。
  - **已知限制**：判斷不看金額，0 元訂單（例如免費商品或全額折抵）只要轉成已付款，目前也算購買、會停止序列。
- **上限**：每商家 5 條寄送中的序列、每條 10 封；目前沒有 Email 用量計量。

### 信件中的收件人姓名（A2-13）

報名者、預約者、買家的姓名是他們在公開表單或結帳頁自己填的。公開表單任何人都能填別人的 Email，所以姓名可能是陌生人寫的文字，被當成以商家名義寄出的釣魚連結（例如姓名填 `[點我](https://…)` 或 `evil.test`，再填受害者的 Email）。信件內文經 `rich-text.ts` 渲染（markdown 連結、`http(s)://`、`**粗體**`、行首 `#`／`-`／`1.`），收件端的郵件軟體也會把裸網域變成連結，所以姓名在進信件之前一律經過共用的 `src/lib/safe-recipient-name.ts`（`safeRecipientName`，A2-04 自動化範本原本的清理抽出來共用，行為不變）：

- **像網址就整個換成預設稱呼**：判斷前先做 NFKC，並移除 Unicode 所有 Default_Ignorable_Code_Point 與格式字元（`\p{Cf}`：零寬、bidi、CGJ U+034F、variation selector、tag 字元、蒙古文 FVS、高棉文 U+17B4、U+FFF9、U+1BCA0、U+1D173 等，整個類別都移除，不是列舉清單；#670 審查 MAJOR-1）。只要含 `://`、`www.`，或任何語言的字母、組合字元或數字以 `.` 或 `。` 相接（點後面接組合字元也算，例如 `evil.́test`；含全形，例如 `ｅｖｉｌ．ｔｅｓｔ`、`evil。test`、`釣魚網站。測試`），清理前後各判斷一次，命中就整個姓名不用，不是只清掉網址片段。同一個判斷也用在自動化「自訂訊息」檢查商家文字是否含網址（`genericEmailTextLooksLikeLink`）。商家文字另外也擋主機名稱含其他語言字母的網址（例如 `例子.com`、`eviĺ.com`），但這種主機只認**小寫**的頂級網域，因為中文常緊接英文詞（`本週主題.App 開發入門`、`王老師.Tech 講座`、`直播.TV 版本` 照常放行，已存的規則也不會在執行時被停寄；#670 複審 MINOR-1）；純 ASCII 主機的判斷不變，大小寫都算（`EVIL.COM`）。顯示用的清理也移除同一整類字元，所以 emoji 的變體選擇字元與零寬連接字元會被拿掉（`❤️` 顯示成 `❤`）。
- **其餘反覆清理到結果不再變化**：換行與控制字元變空白；移除 `[]()*<>{}` 與反引號、`http(s)://`、行首的 `#`、`1.`、`1)`、`-`、`+`、`*`、`>`（含連續堆疊，例如 `# # x` 變成 `x`）；最多 80 個字（以 code point 計）。`hthttps://tps://evil.test` 這種拿掉一段又拼出一段的寫法，在第一步就被整個擋下。
- **代價**：
  - 含點的真名（例如 `Mr.Lin`、`J.K.`）會換成預設稱呼；用全形 `．` 隔開的姓名（例如 `麥可．喬丹`）也一樣，因為 NFKC 會把 `．` 變成 `.`。用間隔號 `・`、`·` 的（`麥可・喬丹`）不受影響。
  - 顯示的是 NFKC 正規化後的姓名，可能和報名者輸入的不同：全形英數字變半形（`ＭＡＲＹ` 變 `MARY`）、半形片假名變全形（`ｶﾀｶﾅ` 變 `カタカナ`）、拆開的重音合併（`Jose` 加 U+0301 變 `José`）。
  - 一般姓名照原樣：`王小明`、`Mary Jane`、`O'Brien`、`José Müller`、`राहुल`。
  - **接受的殘留風險**：用其他看起來像點的符號或空白隔開的寫法，例如 `evil⋅test`（U+22C5）、`evil·test`（U+00B7）、`evil . test`，不會被當成網址而照原樣顯示。人讀得懂，但郵件軟體與 `rich-text.ts` 都不會把它們解析成網域、也不會變成可點的連結，收件人必須自己手動改寫再輸入，釣魚效果與信裡任何一段普通文字相同；把這些符號一併擋下會誤傷用間隔號的真名（例如 `麥可·喬丹`）。

各路徑的處理：

| 信件 | 收件地址 | 處理 | 預設稱呼 |
| --- | --- | --- | --- |
| 報名 Email 驗證信（`ensureFormSubmissionVerificationDelivery`） | 未驗證 | 一律「您好：」開頭，**不帶姓名**（#670 審查 MINOR-1：寄到未驗證的地址，也不需要姓名）；原本是只合併空白的 `safeDisplayText` | 「您好」 |
| 指定場次「你已報名」通知（`ensureFixedSessionAlreadyRegisteredDelivery`） | 可能未驗證（任何人輸入同一 Email 都會觸發） | 報名 `VERIFIED` 才帶姓名（呼叫端傳 `recipientVerified`，沒傳視為未驗證），並經 `safeRecipientName`；帶的是那筆報名自己存的姓名，不是這次請求填的姓名 | 「您好」 |
| 指定場次取消通知（`ensureFixedSessionCancelledDelivery`） | 已驗證 | `safeRecipientName` | 「您好」 |
| 付款成功收據（`ensureCommerceOrderPaidDelivery`） | 未驗證（結帳時填的 Email） | `safeRecipientName`；不能用時整句改成「您好：」 | 不帶姓名 |
| 商家訊息範本的 `{{name}}`（報名確認、開播前提醒、`before_live`／`during_live` 通知、課後信、Email 追銷序列、範本預覽） | 已驗證（這些路徑都只寄給 `VERIFIED` 報名，序列信寄送前也重讀 `VERIFIED`） | `renderMessageTemplate` 內一律經 `safeRecipientName`，主旨與內文都是；其他變數（直播名稱、商家名稱、連結）是商家自己的資料，不變 | 「你」（`MESSAGE_TEMPLATE_NAME_FALLBACK`） |
| 自動化「自訂訊息」範本的 `{{name}}`（A2-04） | 立即動作不限；延遲步驟只寄已確認的地址 | 不變：報名 `VERIFIED` 才帶姓名、諮詢預約改取同 Email 已驗證報名的姓名，並經同一個清理 | 「你」 |

報名的姓名建立後不會被改寫（同一 Email 重新報名只沿用原本那筆，不更新姓名），所以已驗證報名的姓名就是驗證當時的值。不寄信的地方（LINE 推播、學員通知、自動化固定範本）不帶報名者姓名，不在此範圍；後台與公開頁面顯示姓名走 React 轉義，也不在此範圍。

**部署前已排入的信保留原本的內容**（#670 審查 MINOR-2）：信件在排入佇列時就把主旨與內文加密存起來（`EmailDelivery.payloadEncryptedEnvelope`），寄送時不重新產生。所以部署前已排入、尚未寄出的開播提醒（`live_reminder`）、直播通知（`before_live`／`during_live`）、課後信與序列信，仍是當時的內容，可能含未清理的姓名；部署之後才排入的信才會清理。驗證信、已報名通知、場次取消通知、收據在事件發生時排入、隨即（或下一輪 Email job）寄出，實際上不受影響。之後因設定變更而重新排入時，`live_reminder` 與直播通知會以同一個 id 回來，並改寫成當下產生的內容（`ensureLiveReminderDelivery` 重新啟用時也改寫內容，A2-13 起；直播通知原本就會）。#670 第一版提案的腳本（先標成 `superseded` 再靠提醒 reconcile 重建）經複審實測會讓提醒永久消失（reconcile 每批 100 筆並沿用之前的進度，重跑時已救回的提醒會再被標掉），已移除。A3-03 改用 `scripts/rerender-queued-reminder-content.ts`：只處理仍在排程中（`queued`／`failed`）或還能手動重送的 `exhausted` 的 `live_reminder`、`before_live`、`during_live`，依原始資料原地重算主旨與內文，以 compare-and-set 只改加密內容、不改狀態；只有確認儲存的內容正是 #670 前的寫法、而且之前的寄送確定沒送達 Resend 時才改寫（重試沿用同一個 Idempotency-Key，內容不同會被 Resend 以 409 拒絕），無法完整重現或可能已送達的列不寫。執行說明、判斷規則與 Production 授權要求見 `docs/production-database-runbook.md` 9.4。執行前，以及腳本不寫的列（`unrecognized`、`ambiguousAttempt`、`keyMismatch`、`unrenderable`），仍是接受的殘留風險；課後信與序列信不在範圍內。

回歸測試：`src/lib/safe-recipient-name.test.ts`、`src/lib/email-delivery-recipient-name.test.ts`、`src/lib/commerce-order-email.test.ts`、`src/lib/automation-generic-email.test.ts`，以及 DB 測試 `src/lib/sequence-email-dispatch.db.test.ts`（經真正的寄送流程檢查 HTML 與純文字）、`src/lib/live-notification-delivery.db.test.ts`、`src/lib/live-session-switch.db.test.ts`（經報名 API：已驗證報名的「你已報名」通知帶它自己存的姓名，不帶這次請求填的姓名）；共用案例在 `src/test/recipient-name-cases.ts`。

### 自動化規則（F-4：既有缺口、延遲步驟、付款完成）

設計見 `docs/product/delayed-steps-design.md` 第 8 節。規則在 `/settings/automations`（全商家）與漏斗編輯器（只限該漏斗頁的 `form_registered`＋貼標籤）管理；事件發生時，規則的「立即執行」動作在同一個 request 內同步執行（`src/lib/automation-workflow.ts`；`payment_paid` 例外，在付款 webhook 回應之後執行，見下方「付款完成」；`form_no_show` 由 Email job 在場次結束後執行，見下方「報名後未出席直播」），延遲步驟由 job 之後執行（見下方「延遲步驟」）。

- **權限**：兩處都是 owner 與 admin（`requireVendorManagerMember`／`requireVendorManagerContext`），accountant、support、其他舊角色與 partner 都被拒；頁面與每個 Server Action（建立、套用劇本、模擬、啟用／停用、刪除）各自檢查，每個規則 id 在最後的查詢綁目前商家。導覽與設定 hub 原本就只對 owner／admin 顯示。沒有管理規則的 API route（`/api/automation/vouchers/redeem` 是買家兌換折價券，不在此範圍），也沒有匯入或複製規則的流程。例外是自訂 LINE 推播動作與派券的 LINE 通知只限 owner，見下方「LINE 推播」。
- **可用的觸發條件**：只有 `AVAILABLE_AUTOMATION_TRIGGERS` 裡的 `form_registered`（`/api/form-submissions`）、`form_no_show`（Email job，Q-11，封測：只對有 `automation_form_no_show` 授權的商家，見下方「報名後未出席直播」）、`viewer_watch_progress`（Email job，Q-11，封測：只對有 `automation_watch_progress` 授權的商家，見下方「觀看直播達到指定進度」）、`webinar_attended_duration_gte`（同一段 Email job，Q-11，封測：只對有 `automation_watch_duration` 授權的商家，見下方「觀看直播累計達指定時間」）、`consultation_booked`（公開預約）、`consultation_no_show`（商家標記未出席）、`payment_paid`（付款 webhook，F-4 PR 3）。七個 trigger 都有正式呼叫端；之後若有 trigger 沒有呼叫端，就從清單拿掉，後台不提供，伺服器端也拒絕用它建立規則、套用劇本或重新啟用（`trigger_unavailable`），既有規則照常列出並標示「此觸發條件目前不會執行」，可以停用與刪除。劇本只顯示觸發條件與條件都能執行的（「諮詢預約提醒與防爽約」、「高客單 VIP 自動尊榮升級」、「開播缺席喚醒再行銷」）；「高意向追單漏斗」的條件是舊的「觀看秒數且尚未購買」，watch pass 不判斷「尚未購買」，所以即使有授權也不顯示、伺服器端拒絕套用（`trigger_unavailable`）。
- **商家存檔時進來的事件（A2-08）**：商家儲存延遲步驟、啟用／停用、刪除規則或在漏斗編輯器修改時，會在交易內以 `FOR UPDATE` 鎖住規則列（交易上限 15 秒）；事件寫執行紀錄時的外鍵檢查要等這個鎖。由請求觸發的四個 trigger（`DEFERRABLE_AUTOMATION_TRIGGERS`：`form_registered`、`consultation_booked`、`consultation_no_show`、`payment_paid`，含付款 webhook 的 `after()` 與補跑）寫執行紀錄時在自己的短交易內以一句 `set_config` 設 `lock_timeout = 2s`、`statement_timeout = 3s`，等不到鎖（或這個短交易開不起來、拿不到連線：P2028／P2024，#671 MINOR-1）就放棄：這條規則對這個事件不寫執行紀錄、不做任何動作，改在 `AutomationDeferredDispatch` 記下規則、trigger 與對象 id（報名、預約或訂單，不存 Email；這筆寫入也有 2 秒 `lock_timeout`），事件的其他規則與請求本身照常完成（新寫入一列時回報 warning `automation_dispatch / claim_deferred`，job 重試時仍被鎖不再重複回報）。Email job 每輪在 watch pass 之後、寄信之前執行 `runDeferredAutomationDispatches`（`src/lib/automation-deferred-dispatch.ts`）：以商家綁定重讀對象重建事件（報名經表單綁商家並帶入它的漏斗頁；預約以 vendorId 綁定，`consultation_no_show` 只在仍是 `no_show`、`consultation_booked` 只在未取消時；訂單經 `dispatchPaymentPaidAutomationForOrder`，仍須已付款、未退款、非測試單、商家未停權），以 `onlyRuleIds` 只跑這條規則，規則仍須屬於該商家、啟用中且 trigger 相同，並以 `rulesUnchangedSince` = 該列建立時間 + 75 秒（存檔交易上限 15 秒加 60 秒時鐘偏差）只接受造成延後的那次存檔：之後才修改、或停用再啟用的規則不補跑、直接結案（#671 MINOR-3）；事件 id 與執行紀錄冪等鍵與即時路徑相同，所以 job、webhook 重送、付款補跑或兩輪 job 同時跑也只執行一次。仍被鎖時保留、不計次，連續 3 筆被鎖就停止本輪；派送前先以事件 id 查這條規則的執行紀錄、不看規則版本（#671 R-1）：已有結果就結案；別處已 claim 但仍是 `running` 時保留、不計次，超過 5 分鐘（`AUTOMATION_EXECUTION_RECLAIM_AFTER_MS`）後只有在它屬於規則目前版本時才由同一個派送接手完成，屬於舊版本就結案並回報，不以新版本重複執行（#671 MINOR-2）；其他結果（已執行、別處已執行完畢、規則已停用、刪除或之後被修改、對象已不存在）刪除該列；等鎖以外的錯誤計次並依時間退避（`nextAttemptAt`：1、2、5、10 分鐘，之後每 30 分鐘，#671 MINOR-5），不以次數放棄；超過 48 小時的列刪除並回報 `dispatch_expired`；停權商家的列不處理。每輪最多 50 筆、商家間輪流，本段最多 10 秒且在本輪 55 秒後不開始。補跑時執行紀錄的時間是 job 執行的時間，所以延遲步驟從那時起算（通常晚幾分鐘）。job 觸發的 trigger（`form_no_show`、兩個觀看 trigger）沒有請求在等，維持等到存檔結束。
- **報名後未出席直播（`form_no_show`，Q-11，封測）**：程式在 `src/lib/form-no-show-automation.ts`。
  - **封測旗標**（獨立審查 M-1）：只能辨識在完成報名驗證的同一個瀏覽器觀看的人，換裝置觀看的比例可能很高，所以放在 `automation_form_no_show` 封測授權後面（預設關閉，平台在 `/admin/vendor-features` 逐商家開通；migration `20261117110200_automation_form_no_show_grant` 只加允許值）。沒有授權的商家：後台的觸發條件下拉與劇本都看不到它；建立、套用劇本、重新啟用、模擬、新增或修改延遲步驟都回 `trigger_unavailable`；job 不掃這個商家；延遲步驟 worker 遇到這種規則的進度就停止（`definition_paused`）。既有的這種規則照常列出並說明「目前是封測功能，尚未對你的商家開放」，可以停用與刪除。共用判斷是 `isAutomationTriggerAvailableForVendor`。
  - **誤判說明**：劇本卡、建立規則的說明與每一條 `form_no_show` 規則都顯示「只能辨識在報名驗證的瀏覽器，或從提醒信、開播通知的個人連結進場的裝置；在其他裝置或瀏覽器直接打開直播頁觀看（例如用手機的 App 內建瀏覽器驗證、之後在電腦直接開直播頁）的人，會被算成未出席。指定場次直播在其他場次結束前，從個人連結觀看自己場次的回放不會記為出席。」（Q-17 起；後一句是審查 m-1）；這個 trigger 寄出的每一封信最後都加一行「如果你已經看過這場直播，請忽略這封信。」
  - **觀看紀錄**：原本沒有任何「哪位報名者看過」的資料（`LiveViewerSession` 是匿名的入場 token、`StreamUsageLedgerEntry` 不記報名者），所以新增 `LiveRegistrationAttendance`（每筆報名一列，`firstAdmittedAt`／`lastAdmittedAt`）。觀看頁開啟後與每 30 秒向 `/api/live-admission` 要求播放入場；伺服器只在這位觀眾的場次正在播放或在回放時才放行。放行的請求若帶著已驗章的報名 cookie（`FORM_SUBMISSION_CHAT_SESSION_COOKIE`，Email 驗證後設定）或這場直播的出席 cookie（個人觀看連結設定，Q-17，各自以自己的金鑰驗章），而且那筆報名屬於這場直播、已驗證、表單屬於這個商家，就以單一條件式 `INSERT ... SELECT ... ON CONFLICT` 寫入或把 `lastAdmittedAt` 往後移；兩個 cookie 都指向這場直播的合格報名時只記報名 cookie 那筆（報名 cookie 屬於別場直播時才用出席 cookie）；5 分鐘內的請求只讀不寫（審查 m-1）。寫入失敗只回報監控（`source: "live_registration_attendance"`），入場回應不變；兩個 cookie 都沒有的請求不寫入、不查詢。
  - **判定**：一筆報名對一個場次算未出席，要同時成立：已驗證（`VERIFIED`）、屬於這場直播與這個商家、在場次結束前就已建立；場次結束已滿 30 分鐘（`FORM_NO_SHOW_GRACE_MS`，給最後幾次入場續期寫入的時間），且不超過再往前 24 小時（`FORM_NO_SHOW_LOOKBACK_MS`，job 停擺太久就不補發）；沒有 `lastAdmittedAt` 在場次開始時間之後（含）的觀看紀錄，也就是場次中或 job 執行前的回放都沒有在完成驗證的瀏覽器看過。
  - **場次**（依直播模式）：單一開播時間的預錄（VOD）是 `scheduledAt` 起算影片長度（商家提前結束時到 `endedAt` 為止，開播前就結束的不算）；真人直播是開始時間（`startedAt` 與 `scheduledAt` 較早者）到 `endedAt`，結束後才判斷；指定場次是報名者自己的 `LiveSession`（取消的不算，商家結束直播時只算 `endedAt` 前已播完的）；常青場有商家共用開場時間時用**目前的**共用開場時間；逐觀眾常青場用 `EvergreenSessionAssignment` 記錄的個人場次，沒進過觀看頁、沒有紀錄的報名者沒有場次，不算未出席（與 F-2 課後信相同）。直播是草稿、未知影片長度時不判斷。
  - **哪些報名屬於這一場**（審查 m-4）：指定場次與逐觀眾常青場本來就記著報名者自己的場次。單一開播時間（與常青共用開場時間）的直播只存**目前的**時間，商家把同一場直播改到新時間再辦一次時，上一場的時間沒有任何紀錄（`Live` 只有一個 `scheduledAt`，沒有歷史），無法可靠判斷「上一場何時結束」。所以採兩個有資料根據的條件：(1) 只算 `verifiedAt`（沒有時用 `createdAt`）不早於本場開始前 14 天的報名（`FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS`；研討會通常在開播前一到兩週開放報名），所以相隔超過 14 天的重辦不會寄給上一場的報名者；(2) 有任何觀看紀錄的報名者都排除（看過上一場就屬於上一場，不寄「錯過這一場」）。相隔 14 天內的重辦，上一場沒來看的人會再被算一次；這寫在後台說明（「單一開播時間的直播只算開播前 14 天內完成驗證的報名者」）與這裡。
  - **觸發點**：`/api/jobs/email-deliveries` 每輪在課後信之後、這一輪寄送之前呼叫 `runFormNoShowAutomation`（兩者都是「報名者的場次結束」驅動，立即動作排的 Email 由同一輪送出）。沿用該 job 的 `JOB_SECRET`／`CRON_SECRET`，不新增端點。每輪最多 50 個事件、最多掃 50 個商家（起點每分鐘輪換），各商家依場次結束時間由早到晚、商家之間輪流。截止時間（審查 m-2、複審 MINOR-1）是 `min(30 秒, 35 秒 − route 已用時間)`，不到 5 秒就整段跳過，所以這一段最晚在這一輪開始後 35 秒結束，後面的這一輪寄送、LINE、學員通知與序列信（啟動截止 60 秒）保有其餘時間；這只限制這一段本身，不保證後面的步驟一定在序列信啟動截止前做完。掃描最多用截止時間的三分之二（逐商家、逐場次檢查），其餘留給派送。整段丟錯只送 `captureOperationalError`（`source: "email_delivery_job"`、`operation: "form_no_show"`），job 照常回 200，回應的 `formNoShow` 只有計數。
  - **快掉出窗口的提醒**（審查 m-3）：這一輪找到但因上限或截止沒派送、而場次結束時間距離 24 小時窗口邊界不到 2 小時的事件，每輪送一次 `captureOperationalError`（`source: "form_no_show_automation"`、`operation: "backlog_near_lookback"`、fingerprint `form-no-show-backlog-near-lookback`，不含任何 id）。
  - **規則**：啟用中、全商家（`funnelPageId` 為空；漏斗編輯器只管 `form_registered`，所以沒有漏斗範圍的未出席規則）、可解析、商家未凍結且有授權，且 `updatedAt` 不晚於場次結束時間：場次結束後才建立或重新啟用的規則不回頭補發那一場。
  - **冪等**：事件 id 是 `form-no-show:{報名 id}:{場次鍵}`，場次鍵依模式是 `live-{scheduledAt 毫秒}`、`shared-{共用開場毫秒}`、`session-{場次 id}-{開始毫秒}`、`evergreen-{個人場次開始毫秒}`；執行紀錄的冪等鍵由事件 id 與規則版本決定，所以同一筆報名、同一個場次、同一條規則只會有一筆執行紀錄（DB 測試：兩個 job 用各自的連線同時掃描、派送同一批事件，每個事件只執行一次）。掃描時已有紀錄的不再挑；只補兩種：超過 5 分鐘的 `running`（process 中途死掉）與第一次執行就 `failed / action_failed`、結束超過 10 分鐘且從未重領的（重試一次，與 `payment_paid` 補跑相同的條件式重領）。dispatch 只跑掃描挑中的規則（`onlyRuleIds`），並以 `rulesUnchangedSince` 再過濾一次。
  - **改期**：場次鍵綁開始時間，所以改期就是另一個場次。場次結束前改期：舊時間從未結束，不會觸發，只看新時間；已觸發過後商家又把同一場直播排到新時間：受上面 m-4 的兩個條件限制（14 天內驗證、沒有任何觀看紀錄），新場次結束時沒來看的人會再觸發一次（每個場次一次）。逐觀眾常青場 rejoin 把場次往後移也一樣。
  - **動作**：與其他立即動作完全相同（`runRuleActions`）：貼標籤、派券（LINE 通知 owner 限定旗標）、LINE 推播（owner 限定）、Email（行銷信、退訂連結、建立時與寄送前查退訂與黑名單）。Email 用這個 trigger 自己的文案（審查 m-5）：「直播回放」範本的主旨是「錯過直播了嗎？回放在這裡」，內文只有回放連結，不提諮詢；每封信最後加「如果你已經看過這場直播，請忽略這封信。」`{{webinar_url}}` 只在回放開放時（`replayEnabled` 且未過 `replayAvailableUntil`，指定場次另看該場的 `sessionReplayWindowHours`，而且直播自己的影片屬於同一商家、依播放來源同一套規則 `isExistingLiveVideoReady` 可以播放；複審 NIT-1）才是觀看頁；回放關閉或過期時，需要回放連結的 Email 動作記為略過（`replay_unavailable`，日誌說明「這場直播目前沒有開放回放」），其他動作照做。
  - **沒有內容的信**（審查 m-6，所有 trigger）：自動化 Email 範本裡缺連結的那一行整行省略（`renderAutomationEmailBody`）；整封信都沒有內容時不寄，記為略過（`no_content`，日誌說明「這封信沒有可寄送的內容（缺少需要的連結）」），不算失敗、不重試。（複審 MINOR-2「每個範本缺必要連結就不寄」暫緩：「表單報名成功」的事件沒有任何連結，照做會讓這類規則的 Email 全部停寄，待決定。）
  - **Email 範本與觸發條件（Q-18）**：每個範本只在事件真的帶有它需要的連結時可選。`consultation_confirmation`：諮詢預約成功、諮詢未出席（`consultationUrl`）；`webinar_replay`：報名後未出席直播（`webinarUrl`，回放開放時才有）；`class_reminder`（課前提醒）任何觸發條件都不開放（文案「課程即將開始」對已結束的場次語意錯誤；既有規則照舊、只顯示提示）；`repurchase_followup`：任何觸發條件，但同一份動作（同一條規則的立即動作，或同一個延遲步驟）裡要有「派發回購券」；表單報名成功、訂單付款完成與觀看直播達到指定進度（Q-11）的事件不帶連結。新建規則、套用劇本、新增或編輯延遲步驟時，伺服器端驗證（`automationActionsEmailTemplatesUsable`），不合的範本回 `email_template_unavailable`；後台的範本清單只列可用的（`AutomationEmailTemplateSelect` 跟著觸發事件與「發送回購券」勾選變化）。編輯既有步驟時，步驟本來就有的範本可以保留（只改延遲時間不必換範本）。**既有規則與步驟不受影響**：不修改、不停用、寄送行為不變；不合規的組合在規則上顯示提示與建議範本（`automationEmailTemplateAdvice`），不強制。規則本身沒有編輯功能，啟用／停用不受此限。**自訂訊息（A2-04，`generic_message`）**：不含連結，所有觸發條件都可選（含延遲步驟）；商家自填主旨與內文，存在動作 JSON（`subject`、`body`），不新增欄位、沒有 migration。主旨單行（禁 CR/LF、控制字元與 U+200E／200F／061C、零寬字元）最多 100 字，內文最多 2000 字，長度以 code point 計；內文支援基本格式（粗體、標題、清單，由既有信件管線轉義後渲染），**但不含連結**：主旨與內文含 `://`、markdown 連結、`www.`、`mailto:`／`javascript:`／`data:` 後面緊接內容（「JavaScript: 從零開始」這類後面是空白的不算）、以常見頂級網域結尾的主機（com、net、org、tw、io、co、me、app、dev、info、biz、xyz、shop、cn、hk、jp 等，含保留的 test／example），或主機後面接 `/` 或埠號，伺服器端一律拒絕；`Node.js`、`Next.js`、`ASP.NET`、`Mr.Lin`、`report.pdf` 這類不算網址（`invalid_email_content`；步驟格式不對則為 `invalid_step`）。只能用該觸發條件真的有的變數（`name`、`vendor_name`、`live_title`：報名／觀看／未出席四個觸發有三個、諮詢預約兩個觸發有前兩個、訂單付款只有 `vendor_name`）。變數值只取自伺服器端同商家的紀錄（報名、預約、直播、商家），並反覆清理到結果不再變化（清掉換行、`[]()*<>{}`、網址前綴、行首的 `#`、`1.`、`-` 等符號，含連續堆疊者）。**收件人姓名是外人輸入的，所以：**報名要已驗證（`VERIFIED`）才帶入，未驗證用「你」（公開表單任何人都能填別人的 Email，未驗證的姓名等於陌生人的文字）；諮詢預約本身沒有驗證狀態，姓名改取同商家、同 Email 且已驗證的報名（`lower(btrim(email))` 精確比對，參數綁定，不用 ILIKE，`_`、`%` 不是萬用字元），沒有就用「你」；姓名只要含 `://`、`www.` 或像網域（任何語言的字母或數字，接 `.` 或 `。` 再接字母或數字，全形與不可見字元先折疊）就整個改用「你」，不是只清掉網址片段（清理與判斷在共用的 `src/lib/safe-recipient-name.ts`，見上方「信件中的收件人姓名」）。表單沒有綁定直播時 `{{live_title}}` 為「本活動」。信件走既有管線：內文轉義、換行轉 `<br>`；每封自動化信（不只自訂訊息）都帶商家的寄件人名稱、reply-to 與聯絡頁尾（`brand`，讀自事件本身的 vendor），信末附簽章退訂連結；已退訂與黑名單收件人照常略過。儲存的文字日後被判定不合規時不寄，執行紀錄記為 `invalid_content`（不是 `no_content`）。**回滾風險**：舊版程式的動作 schema 是固定的 `z.enum`，讀不懂 `generic_message`，含它的規則整條無法解析（不執行），含它的延遲步驟快照依 Q-12 保留一次重試後停止為 `snapshot_invalid`。因此回滾到本功能之前的版本前，先停用或刪除使用自訂訊息的規則與步驟；部署順序同上方「動作 schema 的擴充需要兩段式部署」。
  - **延遲步驟**：`form_no_show` 列入 `DELAYED_STEP_AUTOMATION_TRIGGERS`，對象與 `form_registered` 相同（報名）；封測授權（延遲步驟的 `automation_delayed_steps` 與這裡的 `automation_form_no_show` 都要有；只有前者時新增與修改步驟回 `trigger_unavailable`，刪除步驟照常可以）、起點、停止條件與寄送規則都沿用下方「延遲步驟」。到點時重讀報名，回放開放時才帶 `{{webinar_url}}`。報名者在進度開始之後被放行觀看過（`lastAdmittedAt` 晚於起點）就不再是未出席，進度停止；「看過就停」沿用既有的停止原因 `subject_gone`（審查 m-7、複審 NIT-3），不另加原因代碼，後台的停止人數一起計算。
  - **撤銷與重新開通授權**（複審 NIT-2）：平台收回 `automation_form_no_show` 後，job 不再掃描這個商家；進行中的 `form_no_show` 延遲步驟進度在下一步到點時被停止（`definition_paused`），重新開通也不會恢復。重新開通後，job 會對結束時間仍在 24 小時窗口內、且規則在場次結束前就已啟用的場次補發立即動作（撤銷期間沒有派送、也沒有執行紀錄），所以撤銷不到一天又開通時，那段期間結束的場次會在開通後的下一輪收到未出席動作；更早結束的不補。
  - **部署時停用既有規則**：與 `payment_paid` 相同，migration `20261117110100_pause_form_no_show_rules` 把所有仍啟用的 `form_no_show` 規則改成停用（#599 隱藏時沒有停用），商家要用時自行重新啟用；重新啟用會更新 `updatedAt`，所以不會回頭對啟用前結束的場次發送。
  - **涵蓋不到的情況**（設計限制）：在沒有報名 cookie 的裝置（換裝置、清除 cookie、在 A 裝置驗證卻在 B 裝置看、App 內建瀏覽器開驗證信）觀看的人會被算成未出席（M-1 的 (b) 改善另開工作）；同一瀏覽器報名多場時 cookie 以最後一筆為準，其他場的觀看不會記錄；直播被刪除、報名被刪除時紀錄一起刪除；常青關閉、結束或改回草稿後，常青期間的個人場次不再判斷（之後依單一開播時間判斷）；每個商家每輪最多讀 200 場可能有場次落在窗口內的直播（依 `scheduledAt` 由早到晚），超過時較晚的直播要等之後的輪次，極端情況可能超過 24 小時窗口而遺漏（會觸發上面的快掉出窗口提醒只限已找到的事件）。
- **觀看直播達到指定進度（`viewer_watch_progress`，Q-11，封測）**：程式在 `src/lib/live-watch-progress.ts`（累計）與 `src/lib/watch-progress-automation.ts`（判斷與派送）。
  - **封測旗標**：`automation_watch_progress`（預設關閉，平台在 `/admin/vendor-features` 逐商家開通；migration `20261118090200_automation_watch_progress_grant` 只加允許值）。與 `form_no_show` 共用 `isAutomationTriggerAvailableForVendor`（每個 trigger 自己的授權，彼此不通用）：沒有授權時後台下拉看不到，建立、重新啟用、模擬、新增或修改延遲步驟都回 `trigger_unavailable`，job 不掃，worker 遇到這種規則的進度就停止（`definition_paused`），Q-13 補建也不處理；既有規則列出並說明「目前是封測功能，尚未對你的商家開放」，可以停用與刪除。
  - **資料來源（觀看進度怎麼算）**：瀏覽器不送任何數字。觀看頁每 30 秒向 `/api/live-admission` 續約一次播放許可；伺服器只在觀眾**自己的場次播放中**（`admitLiveViewer` 回傳 `runtimeState === "playing"`；預錄、指定場次、常青逐觀眾與共用開場都依各自的場次判斷，回放不算；指定場次另要求報名自己選的 `liveSessionId` 就是這次放行的場次，只帶出席 cookie、跟著公開時間表進場的裝置在別的場次播放時不累計，審查 MINOR-1；A2-10 起個人連結同時設場次提示 cookie，這台裝置被放行的就是報名自己的場次，所以照常累計；自己的場次已取消、或還沒開始而其他場次正在播時改跟公開場次，不累計；見「個人觀看連結」的「指定場次的場次提示」）放行時，用與 `LiveRegistrationAttendance` 相同、已驗章的報名 cookie 或本直播出席 cookie 找出 `VERIFIED` 報名，在 `LiveWatchProgress` 累計：距上次累計滿 25 秒（略短於 30 秒的續約間隔，續約稍早到達也不會被略過，所以穩定觀看的每次續約都會計入，最多只少最後一次續約之後到離開的時間（不到一次續約間隔，約 30 秒），審查 MINOR-4、複審 MINOR-B）才寫一次，間隔不超過 120 秒就加上這段時間，超過就不加（離開、休眠、斷線的時間不算）。時間一律用資料庫的 `statement_timestamp()`（審查 MINOR-5），不受各台應用伺服器時鐘誤差影響。每筆報名只有一個時鐘，所以多裝置或多分頁同時觀看、重新整理、伺服器重送都不會多算。`/api/live-admission` 原本就有同源檢查、每 IP 每分鐘 120 次限流與 strict body（不接受秒數或報名 id），沒有新增端點。
  - **分母（場次長度）**：VOD 類（單一開播時間、指定場次、常青）是這場直播的影片長度（影片必須屬於同一商家）；真人直播沒有預定長度，結束後以實際播放長度（`endedAt − startedAt`，沒有 `startedAt` 時用 `scheduledAt`；晚開播不從預定時間起算，審查 MAJOR-1）計算，所以真人直播只在結束後約 5 分鐘內一次判斷所有門檻，商家要在直播結束時按「結束」（後台有提醒）。進度＝累計秒數 ÷ 長度，取整數百分比（最多 100）。同一筆報名在不同場次的觀看時間會累加（改期或多個場次的時間會加在一起，後台有說明），每個門檻仍只觸發一次。
  - **防偽造**：能累計的只有持有該報名已驗章 cookie 的瀏覽器，每秒最多加一秒，而且只在自己的場次播放中；要讓 N 個人觸發，需要 N 筆完成 Email 驗證的報名並實際掛著播放頁夠久。掛著不看與開著分頁沒看無法區分（與一般 webinar 平台的「停留時間」相同）。個人觀看連結被轉寄時，對方的觀看時間也會記在報名者名下（Q-17 已接受的取捨）。
  - **觸發點**：`/api/jobs/email-deliveries` 每輪在未出席之後、這一輪寄送之前呼叫 `runWatchProgressAutomation`，達到門檻後約 5 分鐘內執行。每輪最多 50 個事件、最多掃 50 個商家（起點每分鐘輪換）、商家之間輪流，各商家依最近累計時間由舊到新；截止 `min(15 秒, 45 秒 − route 已用時間)`，不到 3 秒整段跳過；整段丟錯只送 `captureOperationalError`（`operation: "watch_progress"`），回應的 `watchProgress` 只有計數。
  - **判斷**（每個條件都綁規則的商家）：`LiveWatchProgress` 屬於本商家、最近 24 小時內到期（最近一次累計；真人直播取最近一次累計與 `endedAt` 較晚者，所以直播隔天才按結束也照樣判斷，審查 MINOR-3）；報名 `VERIFIED`、屬於同一場直播、表單屬於本商家；直播屬於本商家且長度已知；`watchedSeconds × 100 ≥ 門檻 × 長度`；規則啟用中、全商家、條件是 `watch_percent_gte`、`updatedAt` 不晚於報名者最近一次累計（規則建立、修改或重新啟用之後還在看的人才算，不回頭補給之前看完的人）；執行紀錄沒有、或是卡住的 running、或是第一次 `action_failed` 已過 10 分鐘（重試一次）。
  - **冪等**：事件 id `watch-progress:{報名 id}:{門檻}`，執行紀錄的冪等鍵由它與規則版本組成，所以每位報名者、每條規則、每個門檻只執行一次；兩個 job 同時跑也只執行一次。同一個 Email 用不同表單報名同一場直播也只執行一次（#651 審查 MINOR-3，見下方「觀看直播累計達指定時間」的「同一個人只執行一次」）。執行紀錄不寫 `liveId`，不擋直播刪除。
  - **門檻與後台**：條件 `{ type: "watch_percent_gte", percent }`，伺服器只接受 1 到 100 的整數（欄位 `watchPercent`，不讀付款金額欄位）；後台提供 25／50／75／90%。每條規則一個門檻，要多個門檻就建多條規則。模擬以「模擬觀看進度（%）」判斷。#599 隱藏期間存下的舊規則（條件是 `watch_seconds_gte`）不會執行：migration `20261118090100_pause_viewer_watch_progress_rules` 停用它們，之後也不能重新啟用（`condition_unsupported`）或模擬，只能停用或刪除，後台說明請改用百分比重建。
  - **動作與 Email 範本**：事件不帶任何連結（觀眾正在或剛在觀看頁），依 Q-18 對照表：沒有派券時只有「自訂訊息」可選；同一份動作有派券時可再選「追購通知」。對象是報名（`buyer_registration`），貼標籤、派券、LINE（owner 限定）照常。
  - **延遲步驟**：列入 `DELAYED_STEP_AUTOMATION_TRIGGERS`，對象與 `form_registered` 相同（報名，到點時重讀、`VERIFIED` 才寄 Email）；需要 `automation_delayed_steps` 與 `automation_watch_progress` 兩個授權。門檻只在達到時判斷一次，延遲步驟不再重新判斷進度。
  - **涵蓋不到的情況**（設計限制）：在沒有報名 cookie、也沒有從個人連結進場的裝置觀看的時間不計入；回放不計入；真人直播在播出中不會觸發；每次進場最後一次續約之後到離開的時間（不到一次續約間隔，約 30 秒）不計入（`creditLiveWatchProgress` 只在續約時加上距上次累計的時間）。
- **觀看直播累計達指定時間（`webinar_attended_duration_gte`，Q-11，封測）**：程式在 `src/lib/watch-progress-automation.ts`（與「觀看直播達到指定進度」同一段掃描）。
  - **封測旗標**：自己的 `automation_watch_duration`（預設關閉，平台在 `/admin/vendor-features` 逐商家開通；migration `20261118100100_automation_watch_duration_grant` 只加允許值）。不與 `automation_watch_progress` 共用：資料來源相同，但這是另一個產品規則（分鐘數，真人直播播出中就觸發），獨立授權讓平台可以分開開通與收回，已開通百分比的商家也不會在沒被告知的情況下多一個 trigger。沒有授權時的行為與其他封測 trigger 相同（後台下拉看不到；建立、重新啟用、模擬、新增或修改延遲步驟回 `trigger_unavailable`；job 不掃；worker 遇到這種規則的進度就停止 `definition_paused`；Q-13 補建不處理；既有規則列出並說明「目前是封測功能，尚未對你的商家開放」，可以停用與刪除）。
  - **資料來源**：與「觀看直播達到指定進度」完全相同的 `LiveWatchProgress`（同一個入場續約累計、資料庫時鐘、每筆報名一個時鐘、只在自己的場次播放中、指定場次只累計選了這次放行場次的報名，#647 審查 MINOR-1、MINOR-5），不另建資料來源，`/api/live-admission` 不變。
  - **判斷**：`watchedSeconds ≥ 分鐘數 × 60`，不需要場次長度當分母。所以 #647 的 MAJOR-1（真人直播的分母用實際播放長度）與 MINOR-3（真人直播以 `endedAt` 回溯）不適用：一列在最近一次累計時就可以判斷，回溯條件只有 `lastCreditedAt > 回溯起點`，也就是 MINOR-A 的第一個分支（`(vendorId, lastCreditedAt)` 索引範圍），沒有結束直播的第二個分支。以 5 萬列合成資料 `ANALYZE` 後 `EXPLAIN ANALYZE` 確認走 `LiveWatchProgress_vendorId_lastCreditedAt_idx` 的 Bitmap Index Scan，只讀窗口內的列（SQL 不 join `Live`：join 會讓 planner 從商家的每場直播讀遍舊列；直播屬於本商家由複合 FK `(vendorId, liveId) → Live(vendorId, id)` 保證）。其他條件與百分比相同、每個都綁規則的商家：`LiveWatchProgress` 屬於本商家、報名 `VERIFIED`、屬於同一場直播、表單屬於本商家；規則啟用中、全商家、條件是 `watch_minutes_gte`、`updatedAt` 不晚於最近一次累計；執行紀錄沒有、或是卡住的 running、或是第一次 `action_failed` 已過 10 分鐘（重試一次）。
  - **真人直播在播出中就觸發**（產品取捨）：觀看時間只在觀眾自己的場次播放中累計，是實際看到的時間，不是距離預定開始的時間，所以晚開播也只從實際播放開始計；門檻是絕對分鐘數，不會因為直播後來變長或變短而改變結果，在播出中判斷不會誤判。好處是可以在直播進行中就追單（例如看滿 30 分鐘就送折價券），不用等商家按「結束」。百分比 trigger 仍在結束後才判斷。
  - **跨場次累加**：同一筆報名的觀看時間跨場次累加（改期、指定場次換場重看），與百分比相同（#647 MINOR-2），後台說明「同一筆報名在不同場次的觀看時間會累加」，每條規則對每位報名者仍只執行一次。
  - **同一個人只執行一次**（#651 審查 MINOR-3，兩個 watch trigger 都適用）：同一個商家、同一個 Email（`subjectKeyHash` 的定義：商家＋去頭尾空白、轉小寫的 Email，與裝置無關）用不同表單報名同一場直播時，每條規則、每個門檻只執行一次（例如只派一張券）。`subjectKeyHash` 是加了密鑰的 HMAC，資料庫算不出來，所以每個事件派送前一刻（每輪最多 50 個）以同一場直播、去頭尾空白轉小寫的 Email 找出這個人在本商家表單的其他報名（索引 `FormSubmission_live_email_normalized_idx`），再以事件 id 查它們在這些規則、這個門檻的執行紀錄；那筆紀錄的狀態都算（failed 或卡住的 running 由它自己的報名重試），**唯一的例外是 `duplicate_person`**：被這個檢查擋下的報名沒有執行過規則，算進去會讓兩筆報名互相擋住、這個人永遠拿不到券（#663 審查 MAJOR-1）。已執行過的規則記成 `skipped`、錯誤代碼 `duplicate_person`（後台執行日誌可見），不執行動作、不建延遲步驟，之後的掃描因為已有紀錄不會再選到它，所以只佔一輪的一個名額（A2-01，#651 複審 MINOR-A：原本是掃描內的 `NOT EXISTS`，全平台報名變多後會讀遍 `FormSubmission`；52 萬筆合成資料上大商家的掃描由 34 秒／113 秒降到 0.3 秒／0.4 秒，見 `docs/codex-goal/PRISMA_INVARIANTS.md`）。同一輪掃到同一個人的兩筆報名時只派送最早跨過門檻的那筆。不同直播仍各自執行（規則是全商家的，換一場研討會就是新的事件，與原本「每位報名者」的設計一致）。
  - **冪等**：事件 id `watch-duration:{報名 id}:{分鐘數}`，執行紀錄的冪等鍵由它與規則版本組成（`watch-duration:{事件 id}:version:{版本}`），所以每位報名者、每條規則只執行一次；兩個 job 同時跑也只執行一次。原本這個 trigger（沒有呼叫端時）的冪等鍵綁「觀眾」（`viewer:{liveId}:{subjectKeyHash}`），已改成和百分比一樣綁 job 組出的事件 id：從未有正式呼叫端，所以沒有任何執行紀錄用過舊鍵，改掉不會讓已執行的規則重跑，也不會留下「同一個 Email 多筆報名只算一次」這種和百分比不一致的行為。執行紀錄不寫 `liveId`，不擋直播刪除。
  - **觸發點與額度**：與百分比同一段 `runWatchProgressAutomation`，共用每輪 50 個事件、50 個商家、商家輪流、截止時間與快掉出窗口的提醒（同一個 `source: "watch_progress_automation"`）。百分比與分鐘是同一個商家的兩段獨立掃描（#651 審查 MINOR-1）：一段丟錯只回報監控（`operation: "vendor_scan"`、`errors` 加一），另一段的事件照常派送。
  - **排序**（#651 審查 MINOR-2）：同一個商家的事件依「大約何時跨過門檻」由早到晚：分鐘事件是 `lastCreditedAt − (watchedSeconds − 分鐘數 × 60)`（不早於第一次累計；跨場次累加時是近似值），百分比事件是可判斷的時間（最近一次累計或真人直播結束）。所以直播中跨過門檻、還繼續看的人不會因為每次續約都更新累計時間而一直往後排。每輪名額有限，同時達到門檻的人多時可能延後幾輪才執行（後台說明有寫）；24 小時回溯與快掉出窗口的提醒仍以最近一次累計為準。
  - **門檻與後台**：條件 `{ type: "watch_minutes_gte", minutes }`，伺服器只接受 1 到 1440 的整數（欄位 `watchMinutes`，不讀付款金額或百分比欄位）；後台提供 5／15／30／60 分鐘，只有開通授權的商家才看到這個選項。模擬以「模擬累計觀看（分鐘）」判斷。#599 隱藏期間存下的舊規則（條件是 `watch_seconds_gte`，或劇本的 `watch_seconds_gte_and_not_purchased`）不會執行：migration `20261118100000_pause_webinar_attended_duration_rules` 停用它們，之後也不能重新啟用（`condition_unsupported`）或模擬，只能停用或刪除，後台說明請改用分鐘數重建。
  - **動作與 Email 範本**：事件不帶任何連結，依 Q-18 對照表：沒有派券時只有「自訂訊息」可選；同一份動作有派券時可再選「追購通知」。對象是報名（`buyer_registration`）。
  - **延遲步驟**：列入 `DELAYED_STEP_AUTOMATION_TRIGGERS`，對象是報名；需要 `automation_delayed_steps` 與 `automation_watch_duration` 兩個授權。門檻只在達到時判斷一次。新增與修改步驟時先判斷授權（`trigger_unavailable`），再判斷條件（#651 審查 MINOR-5、複審 NIT，`viewer_watch_progress` 一樣）：條件是舊秒數的規則回 `condition_unsupported`（與重新啟用相同），刪除步驟照常可以。
  - **涵蓋不到的情況**：與百分比相同（其他裝置、回放不計入；每次進場最後一次續約之後到離開的時間（不到一次續約間隔，約 30 秒）不計入（`creditLiveWatchProgress` 只在續約時加上距上次累計的時間））；真人直播播出中可以觸發。兩個 job 剛好同時派送同一個人經由兩筆報名的同一個門檻時，仍可能各執行一次（同一輪內與之後的輪次都會排除，見上方「同一個人只執行一次」；要完全擋住需要把冪等鍵改成依人，未做）。
- **付款完成（`payment_paid`，F-4 PR 3）**：
  - **觸發點**：canonical 訂單（`CommerceOrder`）第一次轉成已付款的那一次。所有讓訂單變成已付款的正式路徑都經過 `processPaymentWebhook` 的 `reconcileCommerceOrderPaymentTransition`：PayUni notify 與 return（同一個交易狀態收斂成同一個 `WebhookEvent`）、`/api/jobs/webhook-retry` 重跑失敗事件、平台管理員的 WP4／Q1 回呼重跑。只有交易內回 `changed: true, status: "paid"` 時觸發，所以重送、return 與 notify 都到、之後換了 event id 的已付款通知、退款、部分退款、付款失敗都不觸發；付款失敗後又付款成功的訂單在成功那一次觸發。訂單金額一律為正（沒有零元訂單），也沒有後台手動標記已付款的流程。不觸發的：庫存到期對帳 job（`inventory-expiry-reconcile`，只在交易已付款而訂單未轉時補轉，正常流程不會發生）、平台訂閱扣款（商家付給平台，沒有 `CommerceOrder`，不是商家的買家；目前也沒有買家端的訂閱續扣）、測試訂單（`isTestOrder`）、凍結中的商家（付款照常入帳但不開通，自動化也不跑；解除凍結後不補跑）。
  - **失敗隔離**：付款的 Serializable 交易 commit 之後（電子發票與 audit 之後；它們丟錯也照樣觸發，因為付款已 commit、重送只會看到 `changed: false`）才呼叫 `runPaymentPaidAutomationAfterCommit`。在 request 內只註冊 `after()`，webhook 先回應，規則在回應後、route 的 `maxDuration`（60 秒，webhook-retry job 300 秒）內執行；request 外（腳本）就地執行，最多等 15 秒。這個呼叫永不丟錯：讀不到訂單、規則失敗（例如缺 `NEXT_PUBLIC_APP_URL` 的 `unsubscribe_url_unavailable`、動作丟錯）、資料庫錯誤、逾時都只送 `captureOperationalError`，context 只有監控白名單內的 `source: "payment_paid_automation"` 與 `operation`（`dispatch`：整段丟錯；`rule_failed`：至少一條規則記為失敗；`buyer_email`：買家 Email 無法解密；`inline_timeout`：request 外等超過 15 秒；`inline`：就地執行本身丟錯），不送商家、訂單、規則或買家資料（是哪一條規則、為什麼失敗記在執行紀錄）。付款結果、webhook 回應碼與回應內容不變。失敗的規則照既有規則記為 `failed`：同一筆訂單之後的付款通知都不再觸發，商家在執行日誌看得到失敗。`after()` 根本沒跑到或中途被中止（回應後平台結束 function、資料庫短暫故障）而**沒有留下執行紀錄**、留下死掉的 `running`，或第一次執行時動作丟錯（`action_failed`）的訂單，由下面的「補跑」處理（`action_failed` 最多補一次）。

  - **補跑**（Q-10，`src/lib/payment-paid-automation-catchup.ts`）：`/api/jobs/webhook-retry` 每輪（排程每 5 分鐘）在釋放庫存與重試 webhook 之後呼叫 `runPaymentPaidAutomationCatchup`；不新增端點，沿用該 job 的 `JOB_SECRET`／`CRON_SECRET`。
    - **撈哪些訂單**：付款時間（`paidAt`）與入帳時間（`payment.paid` 訂單事件的 `createdAt`）都在 10 分鐘前到 48 小時前之間（兩端都含；`PAYMENT_PAID_CATCHUP_MIN_AGE_MS`、`PAYMENT_PAID_CATCHUP_MAX_AGE_MS`）。10 分鐘＝登記 `after()` 的最長 route（webhook-retry 的 `maxDuration` 300 秒）加上執行紀錄被視為死掉的 5 分鐘，所以 `after()` 不是已經跑完就是已經停止，留下的 `running` 紀錄也已經可以重領；48 小時之後的「感謝購買」訊息、標籤或折價券晚到太久，job 也已經試過幾百輪。訂單條件與即時觸發點相同：仍是 `paid`、`refundedAmountCents = 0`（狀態仍是 `paid` 但已部分退款也不補）、不是測試訂單、商家現在沒有凍結；`payment.paid` 事件來自付款 webhook（不是庫存到期對帳 job 的補轉，也不是付款時商家凍結中的那種，解除凍結後一樣不補）。查詢只掃「有啟用中全商家 `payment_paid` 規則」的商家（SQL 內判斷，沒有規則數上限，不會有商家因排序被截掉）。
    - **哪些規則**：啟用中、全商家（漏斗範圍的規則不補，即時事件本來就不帶漏斗頁）、能解析，而且付款入帳之後沒有被建立、修改或重新啟用過（`updatedAt` 不晚於入帳時間）。所以停用中的規則不補；付款之後才建立的規則、付款時是停用而之後才重新啟用的規則，都不會回頭跑這筆訂單。每條規則各自判斷，只補這三種：這條規則對這筆訂單**沒有執行紀錄**；只有超過 5 分鐘的 `running`（process 中途死掉）；或第一次執行就記成 `failed / action_failed`（動作丟錯，例如資料庫或 outbox 暫時故障）、結束已超過 10 分鐘（`PAYMENT_PAID_CATCHUP_FAILED_RETRY_AFTER_MS`）、而且從沒被重領過（`startedAt` 仍等於 `createdAt`）。重領會更新 `startedAt`，所以 `action_failed` 最多補一次，第二次失敗就停在 `failed`（不加 migration 的有限重試）。其他失敗（例如缺部署設定的 `unsubscribe_url_unavailable`）不是暫時性的，不補；`completed`、`skipped` 也不補。不能解析的規則從不寫紀錄，掃描時排除後重掃（最多 3 次），不會每輪佔名額。
    - **只跑挑中的規則**：補跑只 dispatch 這輪查詢為這筆訂單挑出的規則（`onlyRuleIds`），同一筆訂單的其他規則（例如已經 `failed` 而不符合重試條件的）不會被順便重領。
    - **冪等**：補跑呼叫與即時路徑同一個 `dispatchPaymentPaidAutomationForOrder`，`eventId`（`payment-paid:{訂單 id}`）與執行紀錄的冪等鍵完全相同，所以即時路徑、補跑、兩個 job 同時跑，同一條規則同一筆訂單仍只會有一個 claim 執行動作（另一方得到 `duplicate`）。補跑重領 `failed` 時，重試條件（errorCode 是 `action_failed`、`startedAt` 仍等於 `createdAt`）寫在重領那一句條件式更新裡（比對再寫入），所以兩個補跑同時跑、或一個補跑掃描後另一個先重試過（或已改記成非暫時性錯誤），後到的一方得到 `duplicate`，重試仍最多一次；即時路徑重領 `failed` 的條件不變。重領的那次重跑所有動作，標籤（upsert）、折價券（決定性 id）、LINE（冪等鍵）、Email（決定性 id）都不會重複。
    - **上限、公平與時間**：每輪最多 20 筆訂單（`PAYMENT_PAID_CATCHUP_ORDER_LIMIT`），在商家之間輪流（每家最舊的一筆先，接著每家的第二筆……），單一商家大量漏掉時不會吃掉其他商家的額度。補跑排在最後，只用 route 剩下的時間：排程端（`scripts/scheduled-jobs-runner.mjs`）等 120 秒，所以 route 開始後已過 60 秒就跳過這輪補跑（回應 `paymentPaidCatchup: { skipped: true }`），否則到 `min(60 秒, 100 秒 − 已用時間)` 就不再開始新的訂單；剩下的等下一輪。
    - **監控**：某筆訂單補跑丟錯只送 `captureOperationalError`（`source: "payment_paid_automation"`、`operation: "catchup_dispatch"`，fingerprint 是商家＋訂單的雜湊與錯誤種類，同一筆訂單同一種錯誤合併成一則，不送任何 id），接著處理下一筆；補跑時有規則記為失敗送 `catchup_rule_failed`。整段補跑丟錯（例如查詢失敗）只送 `captureOperationalError`（`source: "webhook_retry_job"`、`operation: "payment_paid_catchup"`），job 仍回 200（若 webhook 重試或庫存釋放失敗，照舊回 503，`failures` 只列它們），回應帶 `paymentPaidCatchup: { failed: true }`。回應的 `paymentPaidCatchup` 只有計數或這兩個旗標，沒有商家、訂單或買家資料。
    - **已知限制**：入帳時間比付款時間晚超過 48 小時的訂單（webhook 隔了兩天才成功重試）不補。規則被改過（例如只改名稱）之後，改之前付款而漏掉的訂單也不補（保守：寧可不補，也不讓付款後才啟用的規則回頭執行）。一個每次都跑超過 5 分鐘而被中止的動作，48 小時內每輪都會被重領一次。單筆訂單的 dispatch 開始後不會被截止時間打斷，所以極端情況下 route 仍可能略超過 100 秒。無法解析的規則在掃描時排除後重掃，最多重掃 3 次；若 3 次後仍有這種規則，它們佔掉的名額該輪就空著，下一輪又會挑到同樣的規則。理論上若有大量商家只有無法解析的規則、訂單又比較舊，排在後面的正常商家可能在 48 小時內一直輪不到；規則在寫入時已經驗證過，實務上幾乎不會發生。
  - **冪等**：沿用執行紀錄的 unique 鍵（規則＋`order:{訂單 id}`＋規則版本），同一筆訂單同一條規則最多一筆執行紀錄；即使併發呼叫，標籤（upsert）、折價券（決定性 id）、LINE（冪等鍵）、Email（決定性 id）都只產生一次。
  - **資料只來自伺服器紀錄**：回應後重新讀訂單，綁 webhook 由伺服器建立的結帳交易解析出的商家（`id + vendorId`），且必須仍是 `paid`、`refundedAmountCents = 0`（回應後到執行前退款就不跑；退款與規則動作之間沒有鎖，退款若剛好發生在讀訂單之後、動作進行中，那次的動作照樣完成）。商家沒有啟用中的 `payment_paid` 規則時，連訂單都不讀。條件「訂單滿 N 元」比的是訂單的 `paidAmountCents`；客戶標籤與折價券綁訂單的 `automationCustomerKeyHash`（與報名同一套正規化，所以同一個 Email 的標籤合在一起）；Email 寄給訂單加密資料裡的買家 Email（讀不到就略過 Email 動作並回報）；LINE 找綁定這筆訂單（`buyer_order`）的 LINE 身分（買家若在付款完成之後才綁定 LINE，規則執行時還找不到，LINE 動作記為 `skipped / line_recipient_not_linked`（A2-09 之前記為 `not_linked`）、不補送）。webhook payload 與 request 參數都不進自動化。只有本商家的規則會執行。
  - **Email**：立即動作的規則不變（行銷信、附退訂連結、建立時與寄送前查退訂與黑名單）；與其他立即動作一樣不要求地址已驗證。
  - **後台**：建立規則時填「付款金額門檻（元）」（必填、正整數，存成分）；模擬以輸入的金額判斷。`payment_paid` 規則可以加延遲步驟（Q-09，見下一點），規則下方的延遲步驟區塊另外說明「全額退款或取消後不再執行（部分退款仍會繼續）」與 Email 限制。
  - **延遲步驟（Q-09，封測）**：與其他 trigger 相同要有 `automation_delayed_steps` 授權，起點、執行、額度、逾期跳過、冪等、停用與修改都照下方「延遲步驟」。這裡只列訂單特有的部分；設計見 `docs/product/delayed-steps-design.md` 第 8 節「Q-09」。
    - **建立 run**：與立即動作同一個入口。即時路徑（`runPaymentPaidAutomationAfterCommit` 的 `after()`）與補跑（`runPaymentPaidAutomationCatchup`）都經過 `dispatchPaymentPaidAutomationForOrder` → `dispatchAutomationEvent`，規則的立即動作結束後（完成或失敗都算）由同一個 `startDelayedSteps` 建 run，對象是訂單（`DelayedStepRun.commerceOrderId`，複合外鍵綁商家），起點是這筆訂單在這條規則的第一筆執行紀錄的 `createdAt`（即時路徑約等於付款時間；補跑時是補跑執行的時間）。條件不符（例如金額未達門檻）的規則不建 run。付款之後才新增或修改的步驟不回頭套用：建 run 時以付款入帳時間（第一個 `payment.paid` 事件）為截止點，規則只要有任何一個啟用中的步驟在那之後才建立或修改，這筆付款的整條 run 都不建（立即動作照常；即時路徑、補跑與 Email job 補建都一樣）。冪等靠既有 unique `(vendorId, automationRuleId, sourceExecutionLogId)` 與執行紀錄的冪等鍵：即時路徑與補跑（或兩個補跑）同時跑，同一筆訂單同一條規則只有一筆執行紀錄、一列 run。建 run 時規則列被商家存檔鎖住超過 2 秒時，執行紀錄留下補建標記（`delayedStepsPendingSubjectId` = 訂單 id），Email job 的 `startPendingAutomationRuns` 照 Q-13 的規則補建；補建時訂單已全額退款、取消或變成測試單，就清掉標記、不建 run。測試訂單與凍結中商家的付款本來就不觸發，所以不會有 run。
    - **到點重讀訂單**：每一步到點時以 `id + vendorId` 重讀訂單。訂單已全額退款（狀態 `refunded`，或退款總額已達付款金額）、已取消、或被標成測試單時，進度停止（`cancelled / subject_gone`），之後的步驟都不做。**部分退款仍繼續**（保守：購買仍成立，追蹤與回購仍適用）。商家停權時不撈、進度保留（與其他進度相同）；停權剛好落在 worker 領到這筆之後，也只交還租約、不執行、不扣重試次數。規則停用照舊 `definition_paused`。已排隊、還沒寄出的這種延遲步驟信，寄送前再查一次訂單，已全額退款或取消就不寄（`superseded`）。
    - **收件者 Email**：每一步重新解密訂單的買家 Email（run 不存地址）。付款只代表買家完成結帳，Email 沒有經過任何驗證流程（結帳時填什麼就是什麼），所以採保守規則：只有本商家有同一個 Email（忽略大小寫與前後空白後完全相同）的**已驗證報名**（與諮詢預約相同的比對），或本商家寄到這個 Email 的**學員專區登入連結送達並被抓取過**（`magic_link` 已兌換：連結在打開時就兌換，所以信件掃描器預先抓取也算；結帳成功頁的 `checkout_redirect` 不算；學員登出後那一列被刪除，就不再算）時才寄。否則這一步的 Email 記為略過（`recipient_unverified`，日誌說明「收件人的 Email 尚未在本商家完成驗證」），貼標籤、派券、LINE 照常執行。其他商家的報名或學員登入不算。這一筆訂單的密文解不開時 Email 記為 `recipient_not_linked` 並回報監控（`source: "automation_delayed_steps"`、`operation: "buyer_email"`，不含任何 id），其他動作照做；部署本身無法加解密（金鑰沒設定）時是平台問題，交還租約、不扣重試次數、這一步不執行；密文的金鑰 ID 不在目前的 keyring 裡時，這一步不執行、照一般失敗重試（每 10 分鐘、最多 5 次），不記成 `recipient_not_linked`。退訂、黑名單、6 小時逾時與寄送額度照延遲步驟的一般規則。
    - **LINE、派券與條件**：LINE 找綁定這筆訂單（`buyer_order`）的 LINE 身分；LINE 推播 owner 限定、派券的 LINE 通知旗標照既有規則。派券的金額與商品照規則或步驟的設定。後台新增的步驟條件一律是「事件發生時」；直接寫入的金額條件以訂單的 `paidAmountCents`（伺服器紀錄）判斷，金額不參與其他任何邏輯。
  - **部署時停用既有規則**（審查 MAJOR-1）：#599 隱藏這個 trigger 時沒有停用既有規則，畫面只標「此觸發條件目前不會執行」。為了不讓它們在部署後突然開始寄信、派券，migration `20261114120000_pause_payment_paid_rules` 把所有仍啟用的 `payment_paid` 規則改成停用（只改 `isActive` 與 `updatedAt`，不寫 AuditLog）。商家要用時到 `/settings/automations` 自行重新啟用，與一般停用中的規則相同；這些規則在部署前從未執行過。
- **刪除**：只有已停用、且從未執行過的規則可以刪除（刪除時它的延遲步驟一起刪掉）。有延遲步驟進度（run）的規則一定已有執行紀錄，所以也不能刪；交易內另外數一次 run，有就同樣回 `delete_has_history`。執行紀錄會連帶刪除它發出的客戶標籤與折價券（schema 的 Cascade），所以有執行紀錄的規則只能停用。刪除在一個交易內進行：先以 `SELECT ... FOR UPDATE` 鎖住這條規則（綁目前商家），取得鎖之後才用新的查詢確認「已停用」且「沒有任何執行紀錄」，都成立才刪，交易最多等 5 秒取得連線、15 秒完成。正在寫入的執行紀錄會先鎖住規則（外鍵），刪除會等它 commit，之後看到這筆紀錄而回 `delete_has_history`；刪除先拿到鎖時，之後才開始的執行會等刪除 commit，寫執行紀錄時發現規則已不存在（外鍵錯誤 P2003，並再查一次確認規則真的不在），該規則對這個事件記為 `rule_deleted` 並略過，同一事件的其他規則照常執行。執行中途才失去執行紀錄（P2025）時同樣只結束該規則。寫 AuditLog `delete_automation_rule`。
- **Email 動作**：`trigger: "automation"` 的 `EmailDelivery`，視為行銷信。
  - 建立時先查名單：收件人在本商家有未恢復的 `EmailSuppression`（退訂、退信、投訴都算）或有效的 Email 黑名單，就不建立寄送；這不算失敗，規則記為完成（不會被重領），執行紀錄的 `actionResults` 記 `{ status: "skipped", reason: "recipient_suppressed" | "recipient_blacklisted" }`，後台執行日誌的「說明」欄顯示原因，同一規則的其他動作照常執行。
  - 名單通過後才產生退訂連結：與序列信相同的 `createEmailUnsubscribeUrl`（簽章綁這封信的 id）與 `ensureEmailUnsubscribeFooter`，連結進 `/unsubscribe`，退訂記在寄信商家的 `EmailSuppression`。目前整個平台都沒有 `List-Unsubscribe` header，序列信也沒有。
  - 連結產生失敗（例如缺 `NEXT_PUBLIC_APP_URL` 或簽章金鑰）時絕不寄出沒有退訂連結的信：這個動作回 `{ status: "failed", reason: "unsubscribe_url_unavailable" }` 並送一次 `captureOperationalError`，同一規則的其他動作照常執行，但整筆執行記為 `failed`（`errorCode: unsubscribe_url_unavailable`），與「某個動作丟出錯誤」相同可被同一事件重領。差別是丟出錯誤時後面的動作不會執行，這種情況其他動作會先執行完。重領時所有動作再跑一次也不會重複：貼標籤是 upsert，派券、LINE 與 Email 都有決定性的 id 或冪等鍵。只有同一個事件再次送進來才會重領（例如同一筆報名的重送），不會自動排程重試。
  - 送出前：`dispatchEmailDelivery` 照既有規則查退訂（`automation` 不在任何豁免名單），另外查本商家 Email 黑名單，命中改 `suppressed`、`recipient_blacklisted`（與學員登入信相同）。
  - 都只看寄信商家自己的名單，其他商家的退訂與黑名單不影響。
  - 諮詢相關的觸發條件可能被商家拿來寄預約確認這類近似交易通知的信，但範本與觸發條件可以任意搭配、文案是行銷用途，所以全部比照行銷信處理，沒有豁免。
- **LINE 推播（owner 限定，owner 2026-11-14 決定）**：自訂 LINE 推播（`line_push`：商家自己寫的文字與按鈕網址，透過商家已連結的 LINE 官方帳號推送）只有 owner 可以設定；admin 仍可管理不含 LINE 推播的規則。取代原本「admin 可透過規則自訂 LINE 推播」的做法。LINE 官方帳號的連結設定（`/settings/line`）與 rich menu 本來就只限 owner。按鈕網址的檢查（只收 HTTPS 且不含帳密，或核准的佔位符）不變。
  - **判斷**：角色沿用 `member.role === "owner"`（與其他 owner 限定設定相同，在已通過 owner／admin 守門之後判斷）；平台沒有代操作（impersonation）機制，平台管理員沒有商家 membership，本來就進不了這兩處。是否含 LINE 推播一律看伺服器端解析後的動作與資料庫裡的規則，不看表單旗標：「規則含 LINE 推播」指立即動作或任何一個延遲步驟（啟用或停用的都算）含 `line_push`。共用判斷在 `src/lib/automation-line-push-policy.ts`，每個寫入入口都呼叫它。
  - **admin 被拒的操作**（錯誤碼 `line_push_owner_only`，什麼都不寫、不寫 AuditLog）：建立含 LINE 推播的規則；套用含 LINE 推播的劇本（「諮詢預約提醒與防爽約」）；新增或修改含 LINE 推播的延遲步驟；把含 LINE 推播的規則重新啟用（啟用等於讓推播開始發送）；在含 LINE 推播的規則上新增或修改任何步驟（即使新步驟不含 LINE 推播，也包括把含 LINE 推播的那一步改成不含；整條規則對 admin 唯讀）；漏斗編輯器裡修改或啟用含 LINE 推播的規則（漏斗規則的立即動作只有貼標籤，LINE 推播只可能來自 `/settings/automations` 加的延遲步驟）。規則與步驟的檢查在鎖住規則列（`FOR UPDATE`，綁目前商家）之後才讀，與 owner 同時加 LINE 推播步驟的操作互相排隊。
  - **admin 仍可的操作**（停止發送或移除，屬安全方向）：停用含 LINE 推播的規則、刪除規則（照原規則：已停用且沒有執行紀錄）、刪除步驟（包括含 LINE 推播的那一步；刪掉之後規則不再含 LINE 推播，admin 就能照常管理）、模擬。
  - **介面**：admin 在 `/settings/automations` 的動作區看不到 LINE 推播欄位，改顯示「LINE 推播僅限擁有者設定。」；含 LINE 推播的劇本不顯示套用按鈕；含 LINE 推播的規則標示「僅限擁有者修改」，只顯示停用、刪除規則、刪除步驟與模擬，沒有啟用、編輯步驟與新增步驟。漏斗編輯器對 admin 把這類規則顯示為唯讀，只留停用。owner 的介面不變。
  - **既有資料**：不做 migration、不改資料。這次變更前由 admin 建立的含 LINE 推播規則維持原狀、照常執行；之後只有 owner 能修改或在停用後重新啟用，admin 可以停用或刪除。
  - **派券的 LINE 通知（owner 限定，owner 2026-11-15 決定）**：規則或延遲步驟派券、而同一組動作沒有自訂 LINE 推播時，系統用平台固定文案（「感謝支持，您的專屬回購折價券已經準備好了。」＋「立即使用」按鈕，冪等鍵 `automation-voucher/{執行紀錄 id}`）透過商家的 LINE 官方帳號通知買家（觀看者 `viewer_session` 不送）。這則通知改成派券動作上的明確設定 `lineNotification`（布林，存在動作 JSON 裡，不做 migration），只有 owner 能開：
    - **既有資料**：變更前存的派券動作沒有這個欄位，一律視為開（照常送 LINE），與上面「既有資料」一致；新寫入的派券動作一律明確存 `true` 或 `false`。只有明確的 `false` 才不送。延遲步驟續跑時照第一次執行記下的動作快照（含這個欄位；舊快照沒有欄位同樣視為開）判斷，不看商家之後的修改。同一組動作有兩張券時，只有欄位為開的券會送，按鈕連到那一張。
    - **寫入**：admin 的派券動作在伺服器端一律存成 `false`（不看表單；admin 送出勾選也存 `false`，不拒絕），所以 admin 仍可建立派券規則、套用「高客單 VIP 自動尊榮升級」劇本、新增或修改派券的延遲步驟，只是不送 LINE。owner 由勾選「同時用 LINE 通知買家領券」決定，預設勾選；表單另帶 `voucherLineNotificationShown`，沒有這個欄位（變更前開著的舊頁面）時視為勾選。owner 套用劇本時派券存 `true`。延遲步驟的函式庫（`createAutomationRuleStep`／`updateAutomationRuleStep`）也依 `linePushAllowed` 再設定一次。
    - **「規則含 LINE 發送」**：上面的唯讀判斷改看「立即動作或任何一個延遲步驟有 `line_push`，或有欄位為開（`true` 或缺漏）的派券動作」。admin 對這種規則與含 LINE 推播的規則相同：不能重新啟用、不能新增或修改步驟，可以停用、刪除規則、刪除步驟；漏斗編輯器同樣唯讀、只留停用。因此 **admin 以前建立的派券規則（欄位缺漏＝開）變成 admin 唯讀**，這是預期行為：要讓 admin 繼續管理，由 owner 重新建立不送 LINE 的規則，或 admin 停用後另建一條（新規則會存 `false`）。錯誤碼沿用 `line_push_owner_only`。
    - **買家沒有 LINE 通知時怎麼拿到券**：券照樣發出（`AutomationVoucherGrant`）。(1) 學員專區「專屬優惠券」列出這位客戶（客戶雜湊）未使用、未過期的券（限可在本平台結帳、有庫存且已設定交付的商品）；(2) 同一組動作勾選 Email 通知並選「追購通知」範本時，信中附領券連結（立即動作照一般行銷信規則寄出；延遲步驟只寄給已驗證的地址）。後台對 admin 在派券欄位旁說明這兩個管道。
    - **介面**：owner 在派券欄位下方看到「同時用 LINE 通知買家領券」勾選與說明（同一條規則或同一步已勾 LINE 推播時不另外發）；admin 看不到勾選，改顯示「派券的 LINE 通知僅限擁有者設定。你設定的派券不會用 LINE 通知買家……」與上述管道，套用派券劇本時也顯示同一段。欄位為 `false` 的派券在規則摘要顯示「派發回購券（不發 LINE 通知）」。只因派券通知而唯讀的規則，說明寫「這條規則（的延遲步驟）派券時會用 LINE 通知買家」。漏斗編輯器沒有派券動作，只把唯讀說明改成「這條規則會發 LINE 訊息（LINE 推播或派券通知）」。
- **LINE 發不出去時（A2-09）**：自動化的 LINE 動作（自訂 LINE 推播與派券的 LINE 通知，立即動作與延遲步驟同一段程式 `queueAutomationLine`）只把訊息寫進 LINE 外送佇列（`LineDelivery`），真正呼叫 LINE API 的是 `processDueLineDeliveries`。分兩類處理：
  - **確定性的設定問題**：同一次執行重試幾次結果都一樣，所以這個動作記為 `skipped` 加固定原因碼，同一組的其他動作（Email、派券、貼標籤）照做，規則或這一步記為 `completed`，不重試、不送監控（只有 production 的 `line_button_url_not_https` 例外，見下）：`line_button_url_not_https`（按鈕連結不是 HTTPS，例如 http 的本機與 e2e 產生的折價券、回放或預約連結，或商家填了 http 的預約會議連結；LINE 只接受 HTTPS。production 遇到時送一次 warning 監控，`source: "automation_line"`、`operation` 與 fingerprint 都只有原因碼，不含任何 id；本機、測試與明確的本機 e2e 不送）、`line_message_empty`（訊息只有一個這個事件沒有的連結，填入後是空的）、`line_account_unavailable`（商家沒有啟用中的 LINE 官方帳號）、`line_recipient_not_linked`（對象在本商家沒有綁定 LINE，或綁定已撤銷）。執行紀錄只存 `{ type: "line_push", status: "skipped", reason }`（派券通知另有 `source: "voucher_delivery"`），不存連結、地址或 LINE id；後台執行日誌的「說明」欄顯示對應的中文（例如「LINE 未發送：按鈕連結不是 HTTPS 網址（例如預約的會議連結）」）。A2-09 之前：http 環境（本機、e2e）下按鈕連結會讓整條規則記為 `failed / action_failed`，排在 LINE 推播後面的 Email 與標籤沒有執行；延遲步驟每 10 分鐘重試、5 次後整條進度 `cancelled / failed`，之後的步驟都不會執行（`automation-line-failure-isolation.db.test.ts` 重現後修正）。沒綁定原本就不算失敗，只是記為 `not_linked`。
  - **暫時性錯誤**：寫入佇列時的資料庫錯誤（或加密失敗）照舊丟錯：規則記為 `failed / action_failed`，延遲步驟保留租約、10 分鐘後重領、最多 5 次；立即動作只有同一事件再送進來（或付款完成、未出席、觀看觸發各自的補跑）才重領。LINE API 的 5xx、408、429 與網路錯誤不會回到規則：佇列那一列自己退避重試（同一列、同一個 `X-Line-Retry-Key`，409 視為已送出），規則與延遲步驟早已完成，不會因此重跑。
  - **重試不會重做已完成的動作**：每個動作的產出都由執行紀錄 id 與動作序號決定（延遲步驟的紀錄 id 由 run 與步驟決定，重試沿用同一筆紀錄與第一次的動作快照），所以重領時派券是 `already_issued`（同一張券、同一個 bearer）、Email 是 `duplicate`（同一封信，不會再建一封）、標籤是 upsert、LINE 是 `duplicate`（冪等鍵）。DB 測試涵蓋：http 下兩種 LINE 動作被略過而 Email、派券、標籤照常完成、進度往下一步走；佇列寫入失敗後重試只多一列 LINE、券與信都不重複；LINE API 5xx 與網路錯誤只在佇列重試；跨租戶（只用本商家的官方帳號與綁定，另一商家綁在同一個報名 id 的身分不算；一家的暫時性錯誤不影響另一家的步驟）。
  - **不在範圍**：直播提醒、開播通知等非自動化的 LINE（`line-notification-materializer.ts`、`line-live-started.ts`）在 http 環境下的行為沒有改。
- **貼標籤、派券**：與立即動作相同。
- **延遲步驟（F-4 PR 2，封測）**：商家要有平台在 `/admin/vendor-features` 開通的 `automation_delayed_steps`（預設關閉）。沒有授權時：規則頁不顯示延遲步驟區塊、三個步驟 Server Action 回「此功能目前尚未開放」、事件不建立進度、job 不執行該商家的進度；授權收回後既有進度保留但不執行，已排隊還沒寄出的延遲步驟信在寄送前被略過。每條規則可加最多 10 個延遲步驟（`AutomationRuleStep`），每一步是「事件發生後 N 小時／天」（1 小時到 90 天，後台只提供小時與天）執行一組動作，動作與條件沿用規則的 schema 與上限（能加延遲步驟的四個 trigger 條件只有「事件發生時」）；同一條規則的延遲時間不重複。只有 `DELAYED_STEP_AUTOMATION_TRIGGERS`（`form_registered`、`form_no_show`、`viewer_watch_progress`、兩個諮詢 trigger，以及 Q-09 起的 `payment_paid`）能加延遲步驟；目前後台提供的觸發條件都在這份清單裡。不在清單裡的 trigger，新增與修改步驟的 Server Action 回 `steps_unsupported`，事件不建立進度，worker 遇到這種規則的進度（只可能來自直接改資料庫）就停止（`definition_paused`）。
  - **起點**：立即動作結束後（完成或失敗都算），規則有啟用中的步驟、trigger 是能加延遲步驟的六個之一、對象是本商家的報名（`form_registered`、`form_no_show`、`viewer_watch_progress`）、諮詢預約（`consultation_booked`、`consultation_no_show`）或仍算購買的訂單（`payment_paid`，見上方「付款完成」的「延遲步驟」）時，建一列 `DelayedStepRun`（起點＝這個事件第一次執行的時間）。第一步的到期時間在交易內先鎖住規則、依當下啟用中的步驟計算，所以事件進行中商家改了步驟也用改後的時間；規則已停用就不建。同一規則、同一事件只有一列；建立失敗只回報監控，不影響報名或預約的結果，同一事件重送時會補建。建立時最多等 2 秒取得規則列的鎖；商家剛好在存檔、鎖住規則超過 2 秒時，事件照常完成，執行紀錄記下「還欠一個 run」（`delayedStepsPendingSubjectId`），Email job 在完成 2 分鐘後、48 小時內以同一個起點（事件時間）與當下的步驟補建，每輪最多 50 筆、商家間輪流；補建因等鎖以外的錯誤失敗 5 次就放棄並回報監控（`start_run_abandoned`）。事件當下商家沒有延遲步驟授權或已停權時不記（Q-13，設計見 `docs/product/delayed-steps-design.md` 第 8 節第 17 點）。規則之後才加步驟、商家之後才開通授權，都不會讓之前的事件加入。只存參照（規則、執行紀錄、報名、預約或訂單、客戶雜湊），不存 Email。
  - **執行**：與 Email 追銷序列共用 worker（同一個租約、一輪一人最多一步、逾期 24 小時跳過、重試 5 次、商家停權不撈）。到點時重新讀取規則與對象：規則 trigger 被隱藏或規則已停用就停止（`definition_paused`）；報名被刪除時進度一起刪除；諮詢預約不存在，或 `consultation_booked` 的預約已被取消或標成未出席，就停止（`subject_gone`），已完成的諮詢繼續（諮詢後追蹤）；`consultation_no_show` 的進度從未出席的預約開始，之後沒有動作會再改這個狀態，只有預約被刪除才停止。條件依現在的資料重新判斷。每一步寫一筆執行紀錄（日誌「事件」欄標示「（延遲步驟）」），同一人同一步最多執行一次：中途失敗或租約過期重領時沿用同一筆紀錄，並照第一次執行時記下的動作清單重跑（商家中途改了動作也一樣），折價券、標籤、LINE 與 Email 都不會重複。記下的動作清單損壞（無法解析）時不改用目前的動作：第一次遇到保留租約、租約過期後再試一次，仍無法解析就把進度停止（`cancelled / failed`，執行紀錄 `snapshot_invalid`）並送一次監控，不再重試（Q-12）。保留一次重試是為了部署交接或回滾：舊程式可能讀不懂新程式寫的快照，所以**動作 schema 的擴充需要兩段式部署**（先部署能接受新欄位的程式，再部署開始寫入的程式；兩者之間不回滾到更舊的版本）。進度因重試用完或快照損壞而停止（`failed`）時，前面步驟與失敗那一步已排隊的信照寄，只是不再往下執行；其他停止原因（規則停用、對象消失等）才會略過已排隊的信（Q-12）。進度變成 `failed` 或 `completed` 之後，對象的變化（例如預約被取消、報名者已看過直播）不會再被偵測，已排隊的信照寄；退訂、黑名單、規則停用與 6 小時逾時在寄送前仍會擋下。
  - **停用規則**：`/settings/automations` 與漏斗編輯器的停用都在同一個交易內先鎖住規則（`lock_timeout` 5 秒，逾時回「規則正在被其他人修改或執行」；PostgreSQL 以每次取鎖分別計時，排在另一個等待者後面時要先等列的 tuple 鎖、再等持有者的交易，所以最多約 10 秒，仍在交易的 15 秒上限內），再把這條規則所有進行中的進度標成停止（`definition_paused`），所以停用後在下一步到期前又啟用，也不會繼續執行。worker 執行每一步前會再確認規則仍啟用，停用剛好發生在執行途中時，已建立的信在寄送前被略過。
  - **Email**：沿用立即動作的規則（行銷信、附退訂連結、建立時查退訂與黑名單、寄送前再查）。延遲步驟只寄給已確認的地址：報名要已完成 Email 驗證；諮詢預約的地址是公開表單填的，要本商家有同一個 Email（忽略大小寫與前後空白後完全相同）的已驗證報名才寄（比對走 partial index `FormSubmission_verified_email_normalized_idx`，Q-12）；訂單的買家 Email 要有同樣的已驗證報名，或登入過本商家學員專區（Q-09，見上方「付款完成」）。沒有確認時這一步的 Email 記為略過（`recipient_unverified`，日誌說明欄顯示「收件人的 Email 尚未在本商家完成驗證」），其他動作照做；立即動作不受影響。這些信是 `automation_step`，與序列信共用每輪 20 封的寄送額度、佇列上限與商家間的公平分配（一步的 Email 放不進這一輪剩下的額度就整步等下一輪），所以不會繞過序列信的全平台上限；建立超過 6 小時仍未寄出，或寄送前規則已停用、那個人的進度已停止，就略過。續跑中的步驟依第一次執行時記下的動作判斷要不要佔寄送額度。沒有 Email 的步驟（只貼標籤、LINE、派券）不受寄送額度影響，佇列滿或沒有設定寄信服務時照常執行；這一段每輪最多 200 個進度（也受這一輪剩下的 run 預算限制），在商家之間輪流（每家最早到期的一筆先，再輪第二筆），單一商家大量到期時不會佔滿整輪（Q-12）。已知限制：輪流的查詢要先取出全部到期、下一步不含 Email 的進度才能排名次，積壓量大時成本線性成長（合成資料 10 萬筆約 0.5 秒），正式開放給一般商家前需觀察。退訂只會讓之後的 Email 被略過，不會停止整條進度。寄送紀錄頁的類型篩選可選「自動化延遲信」。
  - **修改**：owner 與 admin 在規則下方新增、修改、刪除步驟（每個 Server Action 都綁目前商家，修改時先鎖住規則；含 LINE 推播或會發派券 LINE 通知的規則 admin 只能刪除步驟，見上方「LINE 推播」）。修改的步驟保留原本的 id；有人跑到一半時，比他目前進度早的新步驟不補做、停用或刪除的步驟直接跳過、改延遲的步驟照新時間，已執行過的那一步改了時間也不會再執行一次。觸發條件被隱藏的規則只能刪除步驟。
  - **不做**：視覺化流程編輯器；「到現在還沒買」條件；修改規則的立即動作（照舊只能在建立時設定）。（`payment_paid` 的延遲步驟已在 Q-09 完成，見上方「付款完成」。）

## 商家上線任務（onboarding）

權威實作是 `src/lib/merchant-onboarding.ts`；側欄、`/onboarding`、儀表板卡片與公開指南都渲染同一份 `buildOnboardingChecklist`，狀態只來自已保存的商家資料，沒有手動勾選。

- **互動角色與「發布互動腳本」不計入完成度**：這兩項放在 `journey` 步驟的 `suggestions`（`interactionSuggestions`），只作建議顯示；`summarizeSteps` 計算完成度只看各步驟的必要 `requirements`，所以沒有腳本也能拿到 100%。`journey` 步驟的必要條件只有「啟用報名表單」與「啟用報名確認 Email」。
- `launch` 步驟也不含互動腳本：`getLivePublishReadiness`（`src/lib/live-publish-readiness.ts`）把 `interaction_script` 放在 `recommendations`（只有銷售直播才出現），不在 `requirements`，不擋發布、也不進 `launchRequirements`。
- 平台服務付款步驟標為 `deferred`（依賴外部服務）：仍計入完成度，但「下一步」會先指向其他未完成的步驟；平台未要求綁定時該步驟為「不適用」且不計入。諮詢專案的 `launch` 步驟同樣為不適用。

## 歸因與佣金

先固定 provider、event ID、order number、pending transaction、vendor、affiliate、product／live、visitor／session 與 attribution record。URL／cookie／session 僅是候選來源，接受的歸因與價格由 checkout 伺服器綁定並凍結。

| 事件 | 前提 | 持久化結果與冪等界線 |
| --- | --- | --- |
| Referral visit | 有效 vendor／affiliate／link、政策窗口內 | candidate／click；visitor＋campaign＋有界時間桶 |
| Checkout | server product／live 與有效 attribution | pending transaction；vendor＋order number，金額及 affiliate 快照 |
| Provider paid | 簽章有效、已知 pending order、幣別及金額相符 | paid 與 eligible commission；provider＋event ID、conversion unique key |
| Partial／full refund | 已知交易、有效退款事件及剩餘可退金額 | RefundRecord 與冪等 void／append-only 負向 adjustment；provider＋refund event ID |
| Chargeback／拒付 | 已驗證 provider 拒付事件、已知原交易與金額 | 冪等 commission void／append-only 負向 adjustment；provider＋chargeback event ID，已鎖結算另追加 adjustment |
| Settlement lock | reconciliation 乾淨、核准期間 | 不可變 settlement snapshot；vendor＋period |
| Payout | 已鎖定且 eligible 的 settlement、核准帳戶 | batch／item state；batch＋settlement |

對帳必須一致：`refundedAmount = sum(valid RefundRecord)`；`net commission = positive commission + void/negative adjustments`；`settlement payable = collected - refunds - fees + adjustments`（D-31 A：聯盟佣金由商家自付，月結**不扣**佣金；`calculateSettlement` 的 `affiliateCommissionCents` 只回報、不扣除，規則與改成平台代扣代付前要補的項目見 `docs/operations/affiliate-commission-settlement-runbook.md`）。以目前資料模型的單位與唯一鍵實作，不用文字公式取代 ledger 驗證。

未知訂單或未驗證 webhook 不可產生權威付款與佣金；client price／vendor／affiliate／rate 不可覆寫 server records。結算鎖定後只追加 adjustment，不改舊 ledger 掩蓋修正。Chargeback／拒付也須核對原交易、佣金與結算調整，不能未經 provider 證據就當成普通退款或重複扣除。回歸涵蓋重複、部分退款、亂序、重複／亂序拒付、過期連結、無效 affiliate、self-referral 政策、provider retry、併發與跨租戶；click-through 不能宣稱收入。

### 折扣碼（A4-01，owner 2026-11-23）

商家在 `/discount-codes`（owner／admin）建立買家結帳時輸入的碼；權威實作是 `src/lib/discount-codes.ts`，資料模型見 Prisma 不變量 `20261124100000_discount_codes`。

- **碼與條件**：每個商家內唯一、不分大小寫（6–32 個英數字、`-`、`_`）。固定金額（NT$ 整數）或百分比（1–100）；全部商品或指定商品（只能選自己商店的商品）；開始／結束時間（商家時區輸入）；總使用上限、每位買家上限（以結帳 Email 判斷，不分大小寫）、最低消費（主商品＋加購商品的原價）；啟用／停用。不能刪除，只能停用。
- **金額**：只取自伺服器的 `DiscountCode`。折扣只套用在主商品，加購商品維持原價；主商品至少付 **NT$1**（PayUni 最低金額），TWD 折扣以整數元無條件捨去，所以折扣後永遠大於 0。結帳頁的預覽（`POST /api/payments/checkout/discount-code`）只是顯示；送出時瀏覽器帶「看到的折扣」，伺服器重新計算，不一致就拒絕（`DISCOUNT_CODE_CHANGED`），不會用另一個金額收款。
- **一筆訂單一種優惠**：折扣碼不能和快閃優惠或加購折抵（post-purchase credit）同時使用，伺服器拒絕（`DISCOUNT_CODE_NOT_COMBINABLE`），結帳頁在這兩種情況不顯示輸入框；確認快閃優惠時會移除已套用的碼。買家輸入折扣碼時，已領取的自動化／直播優惠券**不會被使用**、可以留到下次（理由：買家主動選擇並看過折扣碼的金額，優惠券不會因此被消耗掉）。
- **使用次數**：結帳時在建立訂單的同一個 Serializable 交易內保留——條件更新（同一 `revision`、啟用、在期間內、未達總上限）加一，再數同一買家已保留／已使用的次數，最後寫 `DiscountCodeRedemption`；任何一步不通過整筆訂單回滾，所以併發時也不會超用。待付款的訂單會先佔用次數。超過總上限或每人上限對買家都回同一個 `DISCOUNT_CODE_USAGE_LIMIT`（不讓回應證實某個 Email 用過這個碼），伺服器記錄（`discount_code_refused`，只有 id 與原因）仍分開。**每人上限是盡力而為，不是防濫用機制**：它只認結帳時填的 Email，換一個 Email 就是另一個買家，也會因下面的「重新計入」被超過；要限制濫用請用總上限、期間或停用。
- **釋放**：訂單轉為付款失敗（PayUni 失敗回呼、建立付款頁失敗）或逾期未付（庫存保留 30 分鐘到期）時，在同一交易釋放使用次數。之後 PayUni 仍收到這筆款（逾期後付款、付款失敗後又回報已付款，既有規則都允許）時，使用紀錄改為已使用並**重新計入**，即使因此超過總上限或每人上限（例如失敗後同一買家已用釋放出來的次數再下一單）——買家已付折扣後金額，不拒收也不補差額。
- **退款**：部分或全額退款都**不歸還**使用次數（避免買了退、退了再用）；需要時由商家調高上限。
- **快照**：訂單保存原價（`subtotalAmountCents`）、折扣後金額（`totalAmountCents`）；`DiscountCodeRedemption` 保存當時的碼、折扣方式與數值、原價、折扣與實付；付款交易 metadata 也記下碼與折扣。商家之後修改或停用折扣碼不影響已建立的訂單；修改會讓 `revision` 加一，用舊條件報價、尚未建立的結帳會被拒絕。
- **佣金**：以折扣後的實付金額計算（付款交易的 `grossAmountCents`；商家佣金政策的主商品行金額扣掉折扣）。部分／全額退款沿用既有規則：依退款占實付金額的比例沖回、全額退款歸零並作廢。
- **租戶**：碼只在「被購買商品的商家」內查；用 A 商家的碼結 B 商家的商品，與輸入不存在的碼得到完全相同的回應（`DISCOUNT_CODE_INVALID`），不洩漏碼存在。
- **猜碼限制**（審查 m-1、MJ-1、MN-1、MN-2、NT-2；實作 `src/lib/discount-code-lookup-throttle.ts`）：
  - 碼至少 6 個字元；後台建立頁提示商家用不易猜的碼（8 個字元以上、混合英文與數字）。
  - **只有「碼不存在」算失敗**：查不到、別家的碼、停用、不在期間、不適用的商品（對外一律 `DISCOUNT_CODE_INVALID`，看不出碼存不存在）才計入。查到碼、已達使用上限、未達最低消費都表示碼存在，不計入，所以直播時大量買家輸入正確的碼不會把碼鎖住。
  - **三層上限**：每個 IP 每分鐘 10 次（`checkRateLimit`，預覽與沒帶 token 的結帳共用；IP 的取得方式由 A4-03 修正）；不看 IP 的**每商品每 10 分鐘 300 次**失敗；不看 IP 的**每商家每 10 分鐘 1000 次**失敗（避免商品數乘上單品上限後放大太多）。10 分鐘是固定時段（`DiscountCodeLookupThrottle`）。
  - **先預扣再查碼**：查碼前在同一個語句以 `INSERT … ON CONFLICT DO UPDATE … WHERE failureCount < 上限 RETURNING` 對商品與商家各預扣一次；拿不到就回 429、不查碼。查到碼或結果不計入時退回預扣。所以並發的錯誤猜測真的去查碼的次數不會超過上限。代價：查詢進行中的正確輸入也暫時佔一個名額，計數接近上限時，同時湧入的正確輸入可能短暫拿到 429。
  - **超過上限**：到時段結束前，該商品（或整個商家）的所有折扣碼查詢——包括正確的碼——都回 429 `DISCOUNT_CODE_TRY_LATER`（含 Retry-After），猜中與否看不出來；不帶折扣碼仍可結帳。代價：有人故意大量輸錯可以讓商品或商家暫時無法用新查的折扣碼（每輪最長 10 分鐘）。
  - **預覽 token**：預覽成功時回傳 30 分鐘的 HMAC token（`src/lib/discount-code-preview-token.ts`，用途 `discountCodePreview`），綁定商家、商品、碼與碼的 revision。結帳帶有效 token 時跳過上面的 IP 與商品／商家上限；沒帶或 token 不符（偽造、過期、別的碼或商品）時照常經過上限，所以結帳不會變成繞過檢查的猜碼管道。token 不決定金額：金額仍只取自 `DiscountCode`，商家修改過碼（revision 不同）時拒絕（`DISCOUNT_CODE_CHANGED`）。所以已在預覽套用的買家，即使商品之後被鎖，仍能結帳。
  - **計數寫入失敗**（NT-2）：預扣寫不進資料庫時，當作上限已滿回 429 並記錄 `discount_code_throttle_failed`（只有操作與錯誤類型），不中斷請求、也不放行猜碼；退回失敗只記錄，計數因此偏嚴。
  - **後續**：商品或商家被鎖住時通知商家（Email／後台提示），排在後續項目，目前只有伺服器記錄。
- **編輯器 `coupon` 元件**：放在訂單表單步驟的頁面上，該步驟的結帳頁就顯示折扣碼輸入框；元件的「預填折扣碼」只預填輸入框，仍由伺服器確認。一般商品結帳頁在商家有適用於該商品的啟用中折扣碼時顯示輸入框，`?code=` 只預填。

### 付款通知遺失時的主動查詢（A-2 05）

PayUni 的 Notify 整個遺失時，`/api/jobs/payment-reconcile`（`JOB_SECRET`，每 5 分鐘，與 webhook-retry 同頻率）主動向 PayUni 交易查詢並補單。權威實作是 `src/lib/payment-pending-reconciliation.ts`；查詢只在 adapter 的 `queryPendingPayment`（`src/lib/payment-providers/payuni.ts`，唯讀、只帶 `MerTradeNo`、回應必須通過 HashInfo 與解密）。

- **開關**：部署環境要設 `PAYMENT_RECONCILE_ENABLED=true` 才會執行；沒設（含 Production 預設）時回 `skipped: "disabled"`，不掃描、不查詢、不寫入。另外 PayUni 未設定（`checkoutReadiness` 不是 `ready`，含 Preview＋正式商店）時回 `skipped: "provider_unavailable"`。
- **掃描**：PayUni、`paymentMode = platform`、狀態 `pending` 或 `expired`（`expired` 是本地庫存保留 30 分鐘逾時，不是 PayUni 的決定；既有規則允許逾時後 paid）、建立 15 分鐘到 3 天、沒有 `paymentManualReconciliation` 保留（自己這列仍 active 的例外，見下）、且還沒到期前不重查。partial index `PaymentTransaction_payuni_reconcilable_createdAt_idx` 只收 PayUni 的 pending／expired 交易。每輪最多 20 筆，依商家輪流（每家最早到期的一筆排在任何一家的第二筆之前），40 秒後不再開始新的查詢，每次查詢最多 10 秒。
- **狀態**：每筆交易一列 `PaymentPendingReconciliation`（`vendorId`＋交易 id 複合外鍵）。認領＝在查詢前以「目前次數與到期時間」條件更新次數與下次查詢時間，所以兩個重疊的 run 只有一個會查。等待 15 分鐘、30 分鐘、1 小時……最長 12 小時；最多查 10 次（約在結帳後 52 小時）。
- **入帳只走回呼路徑**：查到 `TradeStatus 1`＋`PaymentType 1`＋`DataSource A` 且沒有退款或請款取消時，組成與 UPP Notify 相同的 payload（同一個 event id `TradeNo:1`、同樣不帶手續費、幣別、商家與推廣碼），與回呼共用同一列 `WebhookEvent` 與 claim（`src/lib/payment-webhook-event-claim.ts`），再以伺服器紀錄的 vendor／交易／訂單編號作為 expected scope 交給 `processPaymentWebhook`。佣金、庫存、訂單、權限、收據、追蹤與 `payment_paid` 自動化都在同一條管線，結果與回呼一致（`payment-pending-reconciliation.db.test.ts` 以快照比對兩條路徑）。`2`／`3` 同樣以失敗回呼的 event id 入帳為 failed。
- **退款與請款判斷**（官方交易查詢 Ver 2.0 信用卡欄位）：以 `RefundStatus`／`RefundType`／`RefundAmt` 判斷是否有退款；`RemainAmt` 只在 `CloseStatus = 2`（請款成功）時與 `TradeAmt` 比對；`CloseStatus` 1／7／9（申請中、處理中、未申請）或沒有這個欄位時不看 `RemainAmt`，照常入帳；`CloseStatus = 3`（請款取消）轉人工（`capture_cancelled`），表外的值也轉人工（`close_status_unknown`）。**待 Sandbox 驗證**：請款前 `RemainAmt`／`CloseAmt` 的實際值、授權取消是否以 `CloseStatus 3` 呈現、自動請款商店付款後幾分鐘內回報的 `CloseStatus`。
- **只入帳一次**：回呼與補單同時到達時，誰先 claim 到 `WebhookEvent` 誰處理；另一方得到 processed（重複）或 503（PayUni 會重送）／下輪再看。管線本身仍是 Serializable 交易，事件結案時再比對 claim。事件被別人持有到第 10 次查詢時轉人工（`event_in_progress_exhausted`）。
- **金額**：只取自伺服器的交易紀錄。PayUni 回傳的 `TradeAmt` 與交易金額不同時不入帳，轉人工並告警（管線內的不變式也會再拒絕一次）。
- **不改狀態的結果**：`4`（逾期，未收款）停止查詢、不改狀態（保留期限照常釋放）；`0`／`8`／`9` 或 `DataSource B` 下輪再查；`QUERY03001`（已驗章的查無）下輪再查。查滿 10 次仍查無時，**只有每次都查無**才停止（`closed`，PayUni 沒有這筆交易＝沒有收款，不需要人工）；曾經查到過交易（`providerTradeSeen`）後又查無的轉人工（`not_found_after_trade_seen`）。每輪只要有查無，就送一筆含數量的 warning（`operation=not_found_summary`），用來發現商店代號或環境設錯。
- **人工處理的界線**（`needs_manual_review`，同時在平台後台 webhook 頁新增一筆 `needs_manual_reconciliation` 事件 `manual:reconcile:<訂單編號>:<原因>`、Sentry `payment-reconcile-manual-review`、AuditLog `payment_reconcile_manual_review`）：
  - 可能已收款、會在 pending 交易加上 `paymentManualReconciliation` 保留（jsonb 合併，不覆寫其他 metadata），庫存不被逾期釋放：金額不符（`amount_mismatch`）、非信用卡收款（`payment_type_not_allowed`）、表外的 TradeStatus（`trade_status_unknown`）、PayUni 已退款但本地從未入帳（`refunded_at_provider`）、請款取消（`capture_cancelled`）、表外的請款狀態（`close_status_unknown`）、同一訂單編號有多筆交易且其中一筆 `TradeStatus 1`（`multiple_trades`）。
  - 不保留交易：多筆交易但都沒收款（`multiple_trades`）、查詢錯誤（網路、簽章、解密、格式）查滿 10 次（`query_attempts_exhausted`，error）、PayUni 一直停在待付款（`provider_pending_exhausted`，warning）、曾查到又查無（`not_found_after_trade_seen`）、事件被持有到上限（`event_in_progress_exhausted`）、交易超過 3 天視窗但補單列仍 active（`window_expired`，每輪先掃）、事件已用盡重試或已在人工佇列（`event_needs_attention`，不另建事件）。簽章或解密失敗每次都以 error 告警。
  - 寫入順序：先建立人工事件、寫保留、送告警與 AuditLog，**最後**才把補單列標成 `needs_manual_review`。任何一步失敗時列維持 `active`，下次到期時整段重做（每一步都可重複執行）；若只有最後一步失敗，下輪看到自己寫的保留就直接補標終態，不再查 PayUni。
  - 之後若收到這筆訂單的已驗證付款（回呼或補單），只有代表「還沒有結果」的五種人工事件會在同一個入帳交易內自動結案（`manual_reconciliation_resolved`）：`query_attempts_exhausted`、`provider_pending_exhausted`、`event_in_progress_exhausted`、`not_found_after_trade_seen`、`window_expired`。其餘原因（`refunded_at_provider`、`capture_cancelled`、`close_status_unknown`、`amount_mismatch`、`multiple_trades`、`trade_status_unknown`、`payment_type_not_allowed`）是付款事件解釋不了的狀況，維持開啟等人工處理。
  - 例外：已經超過 3 天視窗、從沒查到過交易、而且最後一次是查無的補單列，每輪開頭直接關閉（`closed / not_found`，計入 `notFoundClosed`），不轉人工。
- **入帳失敗**：管線丟錯時事件標 `failed`、15 分鐘後由 webhook-retry 接手（有重試上限與用盡告警）；售完（`InventoryUnavailableError`）另發 `webhook_retry_requires_attention`。補單列記為 `settled / *_handed_to_retry`，不再查詢。
- **Sandbox 實測（A4-05）**：`.github/workflows/staging-payuni-lost-callback.yml`，只在受保護的 master、staging Preview 環境執行。`phase=pay`（要 `source_sha`＋`deployment_host`，先過 lineage 與 alias 自證）用該 SHA 唯一的 WP4 合成買家結帳（NT$1，伺服器定價，與其他 WP4 任務共用「每個 SHA 一筆」的額度）付款：送出 UPP 表單前，runner 以 Sandbox 金鑰解開伺服器產生的 EncryptInfo，逐欄確認商店、訂單編號、金額、只收信用卡與兩個 staging 回呼網址都是應用程式產生的值，只把 `NotifyURL`／`ReturnURL` 換成 staging 上沒有路由的 `/api/qa/payuni-lost-callback-sink`；Return 在隔離瀏覽器內攔下、只在記憶體驗章確認 PayUni 回報已付款，不轉送給應用程式。付款步驟不帶 GitHub token、出站只到 staging alias 與 PayUni Sandbox。接著 `scripts/payuni-lost-callback-proof.ts` 在 `SET TRANSACTION READ ONLY` 快照內確認交易仍未決、沒有任何 paid 事件，並以唯讀交易查詢記下 `CloseStatus`／`RemainAmt` 等代碼；只有 PayUni 同時回報該筆 `FOUND`＋`TradeStatus 1`＋`DataSource A` 時才判定 `CALLBACK_WITHHELD`（回呼確實遺失），否則是 `NO_POSTING_OBSERVED`，不算通過。等 15 分鐘以上、跑過 `scheduled-jobs.yml job=payment-reconcile` 後執行 `phase=verify`，**必須**給 `source_sha` 與 `pay_run_id`（上一步 pay 的 run id）：workflow 先查 GitHub 確認該 run 是本 workflow 在 master 上成功的 `workflow_dispatch`，下載它的 `payuni-lost-callback-pay-<sha>` artifact，`pay.json` 必須是 `PAID_CALLBACK_WITHHELD` 且 `sourceSha` 相同，否則在注入任何 secret 前停止。之後的唯讀證明要求：交易 paid、paid 事件恰好一筆且由補單建立、訂單 `payment.paid` 一筆、補單列 `settled / paid_applied`、補單 AuditLog 一筆、沒有人工事件；再跑一次補單與 verify，數字不變即證明不會重複入帳。收據只有列舉值、計數與合成金額。
  - **交易查詢的 Result 編碼**：PayUni 的 EncryptInfo 是 PHP `http_build_query` 字串，Result 陣列解密後是平的 `Result[0][MerTradeNo]=…` 欄位，不是一個 `Result` 值（#189 在 trade/close 已見過）。app 的 `payUniResultRows` 一直支援；drill 原本只讀 `Result`，所以 run 45376157147 在 Return 已驗章付款後仍六次 `ROW_REJECTED`（A4-05 修正）。pay 收據與 proof 的 provider 證據多了去識別化的 `resultShape`（`ARRAY`／`OBJECT`／`JSON_STRING`／`QUERY_STRING`／`BRACKET_FIELDS`／`ABSENT`／`NONE`）與 `rowCheck`（`MATCHED`／`NO_ROWS`／`MULTIPLE_ROWS`／`ROW_NOT_OBJECT`／`ORDER_ABSENT`／`ORDER_MISMATCH`／`NONE`），只有列舉值（proof 以 drill 的清單白名單，不在清單內一律 `NONE`）。`MerTradeNo` 與 app 相同只接受字串或數字、trim 後比對。pay 收據升為 `celebratedeal-payuni-lost-callback-pay/v2`：`PAID_CALLBACK_WITHHELD` 必須同時是 `FOUND`＋`rowCheck MATCHED`＋`providerQueryPaid`，否則收據驗證與 verify gate 都拒絕；v1 收據不再接受。drill 與 app 的 Result 讀法以 `scripts/payuni-result-rows-parity.test.ts` 同一張 fixture 表鎖定。`scheduled-jobs.yml job=payment-reconcile` 的 log 另印補單計數（`candidates`、`examined`、`paid`、`pending`、`queryErrors`、`manualReview`…）與 `skipped=disabled|provider_unavailable`，不改變 outcome。
  - **送出後的對話框**：頁面上的「確定」modal 一律不點、直接以 `PAYMENT_CONFIRMATION_DIALOG` 停下；原生 alert／confirm 先 dismiss（不接受）再記錄，之後最多再等 15 秒，Return 回來就照常驗章，否則同樣停下。停下時 log 會多一行 `payuni_lost_callback_dialog=`（WP4 是 `wp4_payuni_dialog_text=`），只有去識別化的對話框文字與按鈕、被擋的第三方網域、送出後 PayUni POST 次數 `payuniPostsAfterSubmit` 與秒數。**`payuniPostsAfterSubmit > 0` 代表表單已送到 PayUni，可能已建立交易：重跑前先到 PayUni Sandbox 後台（或唯讀交易查詢）確認該訂單的交易狀態**，不要直接換 SHA 再付一次。
  - **欄位清單**：另印一行 `payuni_lost_callback_form_fields=`（WP4 是 `wp4_payuni_form_fields=`），唯讀列出付款頁主框架、open shadow root 與最多 7 個 iframe 裡的每個控制項：`name`／`id`、label 或 placeholder 文字（去識別化）、type、`required`／`aria-required`、是否為空、是否勾選、是否 `:invalid`／停用，另含只靠 class 的勾選元件與「條款／政策／同意」那一句。
    - 觸發時機：drill 在頁面「確定」modal 或原生 dialog 停下時（停止結果、回呼計數與秒數先定，之後才蒐集）；WP4 在送出步驟的診斷時，且瀏覽器仍停在 PayUni UPP 頁面，也就是看到「確定」modal（`PAYMENT_CONFIRMATION_*`／`PAYMENT_VALIDATION_*`），或送出後沒有導回（例如原生 dialog 後 `RETURN_CALLBACK_UNMAPPED`）。已導回 staging 結果頁時不蒐集。
    - **不記任何欄位的值**：是否為空在頁面內算完、只帶回布林值；與頁面上已輸入值相同的相鄰文字（輸入回顯）不會當成 label；`name`／`id`／placeholder 先套對話框文字遮罩再套結構白名單，所以 `12/30` 變 `#`、含數字的識別碼變 `ID`、16 字以上的長字串（例如 `radioOptionpayGroupCredit`）變 `TOKEN`。
    - `missingInfoDialog: true` 表示對話框是「請確認付款資訊已填寫」（2026-11-24 run 45362693554 起 PayUni 新增必填欄位）；它比對的是去識別化後的對話框文字，**文字被判為 `REDACTED`（例如含 4 個以上數字）時 `missingInfoDialog` 會是 `false`**，此時直接看 dialog 那一行。判讀時找 `required` 或 `ariaRequired` 為真且 `empty: true`／`checked: false` 的那一欄。蒐集不點、不填、不送出，也不改變停止代碼。
- **凍結商家**：與 PayUni 回呼完全相同——照常查詢與入帳（交易、訂單、佣金、月結資料），數位／課程權限留在 pending、`payment.paid` 事件標 `fulfillmentHeld`、不跑 `payment_paid` 自動化；解除凍結時由既有流程開通。理由：錢已經被收，凍結只擋交付，不能讓已付款的買家停在「未付款」。

## 租戶與權限

從已驗證使用者、active membership、current vendor、platform role 與 capability 追到最後一個 DB 操作。每個輸入 ID 及 relation connect 必須以 compound ownership predicate 或 server-side ownership check 綁定；不先做 global query 再於記憶體過濾。

| 資料 | 範圍 | 必要負向回歸 |
| --- | --- | --- |
| Product／video／form／live／script／role | vendorId＋feature permission | 外租戶不能 read／connect／mutate |
| Payment account／transaction／refund | vendorId＋實際 finance capability | 外租戶不能 list／export／mutate |
| Settlement／invoice／payout | vendor view；platform 明確 mutation | vendor finance 不能操作全域資源 |
| Affiliate／click／commission | vendorId＋affiliate ownership | referral code 不能跨 tenant |
| Audit／webhook | 平台或租戶範圍、必要去識別 | 不揭露其他 tenant、payload 或 secret |

### 商家成員角色範圍（F-025 現況，2026-11）

| 角色 | 後台 | 夥伴佣金 | 聯盟出款 | 買家客服資料 |
| --- | --- | --- | --- | --- |
| owner／admin | 可進入 | 全部（本商家） | 可標記已付款／作廢；需 15 分鐘內 MFA step-up | 客服案件全部 |
| accountant | 可進入（財務頁） | 全部（本商家，`requireVendorFinance`） | 同 owner：需 MFA step-up；不能核准收款資料或匯出提領 CSV（只限 owner／admin） | 不可進入客服案件 |
| support | 只有客服案件與帳號安全 | 不可 | 不可 | 本商家全部客服案件（不限指派給自己）；買家姓名與 Email 只看遮罩值，案件內容（買家回覆、內部紀錄）解密顯示；不可看付款或退款原因 |
| partner（夥伴） | 不可（永遠不成為 vendor context，所有商家 guard 導回夥伴入口） | 只有自己被授權的推廣者（`AffiliatePortalAccess` 綁定成員與使用者；上線看得到下線訂單的層級，但第 2 層以上不揭露推廣碼） | 不可 | 不可 |

聯盟出款另受平台開關 `AFFILIATE_PAYOUTS_DISABLED`（F-052）約束：開啟時任何角色都不能標記已付款或匯出提領 CSV；不論開關，標記已付款都必須有已啟用的商家出款政策與已匯出的扣繳快照。support 讀取範圍目前不縮小：案件多數未指派，縮成「只看指派給自己」會讓客服無法接手，留待有客服排班需求時再評估。

### 封測合作協議閘門（O-11，2026-11-20）

商家要先同意現行版本的《封測合作協議》才能使用後台。條文與版本只在 `src/lib/beta-agreement-content.ts`；公開頁 `/policies/beta-agreement` 與後台彈窗讀同一份。

| 角色 | 未同意時 |
| --- | --- |
| owner（active） | `/beta-agreement` 阻擋式彈窗：全文、乙方（商家名稱＋自己的帳號 Email，伺服器帶入）、捲到底才能勾選、勾選後才能送出；同意後回原頁（安全的站內路徑）或 `/dashboard` |
| admin／accountant／support／其他後台角色 | 同一頁，只顯示「等待商家 owner 同意」與全文，沒有同意按鈕；Server Action 也拒絕（`owner_required`） |
| partner | 不受影響（本來就不會成為 vendor context） |
| 平台管理員 | 不受影響（甲方），即使同時是某商家成員 |
| 學員、買家、公開頁 | 不受影響 |

- 閘門在 `requireVendorContext`（所有後台頁、layout、Server Action）、`requireVendorOwner` 與 `requireMerchantApiActor`（回 403 `BETA_AGREEMENT_REQUIRED`）。
- 直接用 `getCurrentAuth` 授權的 API 在角色檢查之後呼叫共用的 `betaAgreementApiResponse(auth)`，同樣回 403 `BETA_AGREEMENT_REQUIRED`：`products/upsert`、`live-danmaku/scripted` 的 POST（暖場腳本，協議第 5 條）、`live-danmaku`／`live-interactions/cards`／`live-chat/instructor`／`live-presenter` 的講師 POST、聯盟報酬匯出、`live-media` 的 `offer`（`heartbeat`／`stop` 不擋，部署當下正在進行的直播不會被切斷）。測試：`src/lib/beta-agreement-api-routes.db.test.ts`。
- 後續（尚未加閘門）：`media/videos/status`，以及上述 API 的 GET（講師端讀取）。未同意的商家打不開呼叫它們的後台頁，風險只剩直接打 API 讀自己商家的資料。
- `billing/plans/select` 的原生表單把 `/beta-agreement` 列在可轉址清單（`REDIRECT_PATHS`），未同意時轉到閘門而不是 500。
- 等待頁（非 owner）有「切換商家」，與 `/vendor-suspended` 共用 `src/lib/session-vendor-switch.ts`；稽核 `before.from = beta_agreement_pending`。
- 平台管理員本人是 owner 時不受閘門限制，但可自己開 `/beta-agreement` 為該商家同意。沒有 active owner 的商家見 `docs/goal-beta-prep-2026Q4/BETA-OPS.md`。
- 條文全文的 sha256 綁在版本號上（`src/lib/beta-agreement.test.ts`），audit `after.agreementSha256` 記錄同意當下的全文 hash；甲方名稱與信箱寫死在協議模組，不隨客服信箱變動。
- 判斷依據：這個 vendor 有沒有 `UserPolicyConsent(context = beta_agreement, agreementVersion = 現行版本)`；任何 owner 的同意都算，別的 vendor 的不算。條文實質變動時換版本號，所有商家下一次進後台都要重新同意。
- 新註冊：註冊頁只提示「進入後台前會請你閱讀並同意」並連到公開頁；`registerAction` 不寫協議同意，註冊後第一次進後台（`/welcome`）走同一個彈窗，同意後回 `/welcome`，同一人只同意一次。
- 測試與 fixture：e2e 以 `tests/e2e/helpers/beta-agreement.ts` 的 `seedBetaAgreementForLogin` 在登入前寫入同一種同意列（fixture，閘門照常檢查）；閘門本身由 `tests/e2e/beta-agreement.spec.ts` 與 `registration-onboarding.spec.ts` 用鍵盤操作驗證。staging WP4 合成商家由 `ensureWp4SandboxFixture` 寫入同意列；`staging-first-success.mjs` 在註冊後走 `BETA_AGREEMENT` 步驟。

### 商家凍結（F-036／B02-14）

平台管理員在 `/admin/vendor-features` 凍結或解除凍結整個商家（需要 15 分鐘內 MFA step-up；填寫內部原因；寫 AuditLog `vendor_suspended`／`vendor_suspension_lifted`）。權威資料是 `Vendor.suspendedAt`，判斷只走 `src/lib/vendor-suspension-state.ts`，各頁不自行判斷。

唯一的另一個寫入者是 staging 限定的首次成功 runner 清理（R-10，`src/lib/staging-first-success-cleanup.ts`）：只在 `isWp4BoundNonProductionRuntime()` 下、由 `JOB_SECRET` 保護的 ops route 執行，只凍結 runner 自己的合成商家（`suspendedReason` 固定為 `staging_first_success_cleanup`，actor `job:staging-first-success-cleanup`），凍結效果與上表完全相同；停用滿 7 天後才可手動刪除（第一次刪除前須 owner 同意，見 OWNER-ACTIONS）。Production 不可能執行。用法見 `docs/launch/staging-first-success-runner.md`。

| 入口 | 凍結中的行為 |
| --- | --- |
| 後台登入 | 可以登入（session 記錄該 vendor），落地 `/vendor-suspended`「商家已暫停」頁；同時是其他未凍結商家成員的人可在該頁「切換商家」（只在目前 session 的商家已凍結時可用；只能切到自己 active、非 partner、未凍結的成員身分；session 變更與 `session_vendor_switched` audit 同一交易，audit 只記「切換自凍結商家」不記原商家）；平台管理員仍回平台後台 |
| 平台凍結操作 | `/admin/vendor-features`：需填原因、勾選確認、15 分鐘內 MFA step-up；原因只在平台後台顯示 |
| 後台頁面與 layout、Server Action | `getCurrentAuth` 不給 vendor／member，`requireVendorContext`／`requireVendorOwner` 一律導向 `/vendor-suspended`，不做任何寫入 |
| 後台 API | `requireMerchantApiActor` 回 403 `VENDOR_SUSPENDED`；其他以 `auth.vendor` 判斷的 route 回 401／403 |
| 夥伴 portal | 該 vendor 的授權清單與對帳單不出現（404），提領／收款資料操作 404 |
| 直播觀看、入場、回放來源、常青場次 | `publicLiveAvailabilityWhere` 排除，404 |
| 報名表頁與送出 | 頁面 404；`/api/form-submissions` 回「Form not found」404；指定場次清單（`loadPublicLiveSessions`）不列出 |
| Email 驗證連結（`/api/form-submissions/verify`） | 與無效連結相同的「invalid」結果，不寫入 |
| 更換場次連結（`/api/live-session-switch`） | 與無效連結相同，不兌換、不給 cookie；解除後原連結在期限內仍可用 |
| 一頁式網站（`/lp`）、團隊夥伴頁（`/p`） | proxy 狀態、頁面與 runtime gate 都排除，404 |
| 結帳頁、`/api/payments/checkout` | 結帳頁 404；API 在讀取冪等重放前就回 404「Product not available」；直播間不列商品 |
| 結帳恢復（`/api/payments/checkout/recovery`）、加購／降購（`/api/checkout/upsell`） | 404（與未知結帳／無可用方案相同），不寫入、不簽發 token |
| 學員 portal | 凍結時同一交易刪除該 vendor 全部 `StudentPortalAccessToken`（F-030 的 grant 檢查上線後所有學員 session 即失效）；另外每次請求都擋：`requireStudentPortalSession` 的 vendor 查詢排除凍結商家、`loadFeatureGateVendor` 把凍結商家視為所有模組關閉（課程、通知、社群、預約等 route 404）；登入頁 404、不寄登入連結、連結無法兌換 |
| PayUni 付款回呼（含通知遺失時的補單查詢，A-2 05） | 照常驗章、入帳（交易、訂單、佣金、月結資料），但數位／課程權限留在 pending、不建立學員付款通知；`payment.paid` 事件標 `fulfillmentHeld`。解除凍結時同一交易開通已付款訂單的 pending 權限 |
| Email 與 LINE 排程、付款收據 | 不寄、不推播、不 claim，列維持 queued；解除後照常寄送（仍套用寄送前檢查）。學員通知 job 跳過該 vendor |
| 電子發票、月結、webhook 重試、追蹤事件 | 不變（金流與法定義務照常） |

已接受的取捨：凍結期間排隊的行銷信在解除後才會寄出，依賴既有寄送前檢查（例如直播已結束的提醒會被 supersede）；解除凍結不補寫凍結期間略過的學員付款通知。解除時先以短交易解除凍結，再分批（每批 500 筆、各自交易）開通，每張被開通的訂單寫一筆 `fulfillment.released_after_suspension` 事件；中途失敗時其餘權限維持 pending，平台後台會顯示「開通暫停期間的付款」可重跑。

買家客服頁（`/support`，依結帳時的 buyer grant cookie）在凍結期間**保留已付款買家的交付連結**（2026-11-10 owner 決定，原 m5）：買家已付款，要保障其取得內容，所以 `/support` 刻意不加凍結檢查，已付款買家仍能查看訂單、開啟凍結前已開通的交付內容、建立客服案件。這不會讓凍結商家新增銷售或發布：結帳、一頁式網站、報名與直播入口仍依上表關閉；凍結期間才入帳的**數位／課程**付款，entitlement 仍維持 pending，`/support` 顯示「付款確認並開通後」而不給連結，解除凍結後才開通；**服務類**商品沒有 entitlement，凍結期間才付款的買家在 `/support` 仍可看到下單時保存的服務交付說明，這是刻意保留（保障已付款買家，商家恢復後依說明履約）；全額退款照常撤銷該筆訂單的交付內容。回歸測試見 `src/lib/owner-learner-access-policy.db.test.ts`。

### 學員 portal session 撤銷（F-030）

學員 session 只在當初兌換的 magic-link 列存在時有效，刪除該 vendor＋customer 的列即撤銷。以下流程會撤銷，且每處都綁目前 vendor：

- 商家封鎖 Email（`upsertBlacklistAction`，類型 `email`）：與封鎖同一交易呼叫 `revokeStudentPortalSessions`，撤銷該 Email 在本商家的學員 session；交易 commit 後再冪等呼叫一次，刪掉封鎖交易尚未 commit 時通過檢查的請求所建立、交易內撤銷看不到的連結，避免它換出 7 天的 session；其他商家不受影響。被封鎖的 Email **不能再申請學員登入連結**（2026-11-10 owner 決定）：`requestMagicLinkAction` 對每個請求都與資格查詢並行查本商家的有效 Email 黑名單，封鎖中的 Email 不建立 token、不排信，回應與「沒有可存取內容」的 Email 完全相同（同樣的查詢、同樣的通用訊息），不洩漏是否被封鎖或是否存在；寄送前 `dispatchEmailDelivery` 再查一次，封鎖前一刻排入的登入信改為 `suppressed`（`recipient_blacklisted`，寄送紀錄頁顯示「收件者在本商家黑名單中」）。解除封鎖後即可重新申請；其他商家的黑名單不適用。比對使用正規化（小寫、去空白）後的 Email；#136 引入正規化之前寫入的黑名單列沒有正規化回填，含大寫或前後空白的舊列不會被比中，需要時由商家重新封鎖該 Email。
- 全額退款：**刻意不撤銷** session。退款撤銷的課程／數位權限由每次請求的權益檢查擋下（課程頁、證書、社群回 404），而退款後的學員仍須保持登入，才能取消該商品的通知同意（既有 e2e `tests/e2e/learner-notifications.spec.ts`、`native-course-learning.spec.ts` 鎖住此行為）。本 PR 一度在退款時撤銷，造成 Release browser gates 5 個 spec 失敗，已移除。2026-11-10 owner 確認此政策：全額退款只撤銷**該筆訂單**所交付的內容（`convergeFullRefundFulfillment` 在退款交易內撤銷該訂單所有品項的 entitlement 與交付快照、取消未完成的服務與出貨），學員中心、課程、證書、社群與 `/support` 的交付連結都依此擋下；不登出學員，同一學員其他已付款訂單不受影響；部分退款不撤銷任何權限，累計退款達訂單全額時才撤銷；重複的退款回呼不會再改動權限。回歸測試見 `src/lib/owner-learner-access-policy.db.test.ts`。
- 商家被凍結：`revokeAllStudentPortalSessionsForVendor` 在凍結交易內批次撤銷該 vendor 全部學員 session（見上）。
- 客戶匿名化（`scripts/anonymize-customer.ts`，個資刪除請求）：原本就在同一交易刪除該 vendor＋customer 的列。
- 客戶 Email 變更：目前沒有任何「變更客戶 Email」的流程（商家或學員都無法改買家 Email），所以沒有接線；日後新增時必須在同一交易對舊 Email 呼叫 `revokeStudentPortalSessions`。

UI 隱藏不能充當權限。每個新增敏感 read／mutation／export／relation 用第二租戶回歸；拒絕不得洩漏存在性。Schema 變更評估 tenant key、FK、unique、index、既有 RLS 與 forward migration；RLS 是額外防線，不取代 server guard 或 audit。安全、finance、role、ownership 變更須有適當 audit。

Session 與機器憑證（F-016、F-030、F-036）：

- 後台 session cookie 是 `__Host-celebrate_session`（`Secure`、`Path=/`、無 `Domain`，`secure` 不再看 `NODE_ENV`），寫入與刪除一律經 `src/lib/session-cookie.ts`。本機 http 開發只靠瀏覽器對 `localhost`／`127.0.0.1` 的安全來源例外（Chromium、Firefox 可用；Safari 不行）。舊名 `celebrate_session` 只在 2026-12-15（`LEGACY_AUTH_COOKIE_SUNSET`）前作為讀取備援，且只接受 `UserSession.createdAt` 早於 2026-11-04（`LEGACY_AUTH_COOKIE_ISSUED_BEFORE`，本 PR 部署日）的 session；上線後新建的 session 只認 `__Host-` 名稱。登入時會清掉舊名。過渡期間子網域仍可能以舊名塞入部署前的 token，**sunset 之後才完全防止子網域塞 cookie**；sunset 後移除讀取備援。Playwright 手動放 cookie 時用 `domain`＋`path: "/"`＋`secure: true`，不要用 `url`。
- 平台管理員（`platformRole=platform_admin`）的 session 自建立起 24 小時失效（讀取時以 `UserSession.createdAt` 判斷，涵蓋舊 session）；商家後台 session 維持 14 天。敏感操作另有 `requireRecentMfa` step-up。
- 學員 portal session 最長 7 天，且只在當初兌換的 magic-link 列（`StudentPortalAccessToken`，同 vendor、同 customerKeyHash、已 consumed）仍存在時有效；登出、同一瀏覽器重新登入（先撤銷被覆蓋 cookie 的那一列）、`revokeStudentPortalSessions` 或客戶匿名化刪除該列即撤銷。`revokeStudentPortalSessions` 已接到商家封鎖 Email 與商家凍結（批次版 `revokeAllStudentPortalSessionsForVendor`）；全額退款刻意不撤銷，見「商家凍結」後的「學員 portal session 撤銷」；目前沒有變更客戶 Email 的流程。後台「撤銷學員登入」操作仍列為後續工作（F-030 M2）。任何清理該表的排程都必須保留已 consumed 的列至少 7 天。登入連結與 session cookie 的 `issuedAt` 容許比讀取端時鐘快至多 60 秒，規則見下方「伺服器時鐘偏差」；到期時間不放寬，連結仍只能兌換一次。
- Provider smoke 端點（test-email／analytics／monitoring、Cloudflare upload／live input）只認 `OPS_SMOKE_SECRET`，vendor 一律是部署設定的 `SMOKE_VENDOR_ID`；排程 `/api/jobs/*` 與 preflight 仍用 `JOB_SECRET`。

### 伺服器時鐘偏差（2026-11）

Web instance、排程 job 與資料庫各用自己的時鐘；一台寫入、另一台幾乎立刻讀取的時間戳，不能對「比我現在晚」零容忍。規則：

- 只放寬「簽發／記錄時間落在讀取端未來」這一側，上限 60 秒，唯一來源是 `src/lib/server-clock-skew.ts` 的 `SERVER_CLOCK_SKEW_SECONDS`／`SERVER_CLOCK_SKEW_MS`；`STUDENT_PORTAL_CLOCK_SKEW_SECONDS`、CSRF、recent MFA、evergreen viewer session 都引用它（`server-clock-skew.test.ts` 鎖住相等）。超過 60 秒不算時鐘差，照舊拒絕。Cloudflare Stream 簽名 token 的 `nbf` 往前 30 秒（`STREAM_TOKEN_CLOCK_SKEW_SECONDS`）是給 provider 驗證用的另一個值，不併入。
- 到期時間與 TTL 一律不延長：`expiresAt <= now` 照舊失效；以 `e > now + TTL` 判斷「未來簽發」的 token 改為 `e > now + TTL + 60`。舊金鑰的 rotation 判斷（`expiryFitsPreRotationIssue`、`issuedBeforeRotation`）不加容許值。
- 只用在伺服器寫入、且位於 HMAC／AEAD 保護值或伺服器資料列內的時間戳；client 無法選擇這些值，容許值不會讓偽造或過期的 token、cookie 通過。
- 業務先後順序（例如「同意早於確認」）不加容許值，改在寫入端依因果順序記錄：確認諮詢提醒的交易讀到所有符合條件管道的同意（各管道一列），若因時鐘差落在未來 60 秒內，確認時間記為 `max(現在, 最晚的 consentedAt)`，來源事件的 `occurredAt` 用同一個值。fan-out（`consentedAt <= occurredAt`）與派送（`consentedAt <= confirmedAt`）的嚴格比較因此在每個管道都成立，不會靜默漏發；超過時鐘偏差窗口的同意（包括確認後才重新同意）仍照舊壓掉。

| 位置 | 比較的時間戳 | 零容忍時的後果 |
| --- | --- | --- |
| `student-portal-auth.ts`、`email-delivery.ts`（學員 portal，#633） | 登入連結與 session cookie 的 `issuedAt` vs 讀取端時鐘 | 開了有效連結仍被送回登入頁、登入信不寄 |
| `learner-notification-dispatch.ts` 諮詢提醒派送 | payload `confirmedAt` vs 派送 job 時鐘；`startTime <= clock_timestamp() + 1 hour (+60 秒)` 是 DB 時鐘 vs 以 app 時鐘到期的來源 | 提醒永久 `suppressed`（`CONSULTATION_BOOKING_UNAVAILABLE`），不重試；放寬後提醒最多提早 60 秒寄出 |
| `learner-consultation-reminders.ts` 確認提醒 | `LearnerNotificationPreference.consentedAt` vs 確認端時鐘 | 409 `verification_required`，學員重試可恢復 |
| `team-funnel-attribution.ts` 歸因 cookie | 簽章內 `issuedAt` vs 結帳／表單端時鐘 | 歸因靜默丟失（影響佣金）；30 天 TTL 與 `AffiliateClick.createdAt` 視窗不變 |
| `form-submission-chat-session.ts` 報名後聊天 session | 簽章內到期秒數（簽發時間＋30 天） | 報名者的聊天 session 失效 |
| `registration-submission-receipt.ts` 報名成功回條 | 加密回條內 `expiresAt`（簽發時間＋60 秒） | 報名後感謝頁不顯示成功 |
| `live-viewer-pass.ts` 直播觀看 pass | 簽章內 `e`（最多簽發時間＋120 秒） | 觀看 pass 失效 |
| `live-session-result.ts`、`live-session-switch-token.ts`、`form-submission-line-binding-session.ts` | 簽章內 `e`（簽發時間＋TTL） | 感謝頁場次、更換場次連結、LINE 綁定失效 |

新增時間戳檢查時沿用這個常數，不要把容許值加到到期判斷上。

### 客戶端 IP 信任規則（A4-03，2026-11-24）

正式與 staging 網域的 DNS 在 Spaceship，直接指向 Vercel，不經 Cloudflare（O-7＝否），所以 Cloudflare WAF／rate rule 都不存在，限流只能在應用層做（D-20）。任何用戶端都能自己送 `cf-connecting-ip`、`true-client-ip`、`x-client-ip`、`forwarded` 等標頭，它們一律不採信。

- **唯一入口**：`src/lib/request-client-ip.ts` 的 `getTrustedClientIp(request 或 headers)`。限流（`checkRateLimit`）、稽核紀錄（`requestAuditMeta`）、session 的 `ipAddress`、密碼重設信、Turnstile `remoteip`、CSP 回報上限都走它。Server Action 為限流重建 Request 時，用 `copyTrustedClientIpHeaders(await headers())` 只複製它會讀的兩個標頭。
- **Vercel 部署（`VERCEL_ENV` 為 `production` 或 `preview`）**：讀 `x-real-ip`，沒有時讀 `x-forwarded-for` 第一個位址。依據：Vercel 官方 Request headers 文件寫明 `x-forwarded-for` 由 Vercel 覆寫、不轉送外部送來的值以防偽造，`x-real-ip` 與它相同；`@vercel/functions` 的 `ipAddress()` 也是讀這個標頭。Vercel Function 只能經 Vercel edge 進入，沒有可繞過的直連入口。格式不合（逗號、換行、非 IP、超過 16 跳）時視為沒有 IP，不退回其他標頭。
- **本機開發與測試（`NODE_ENV` 不是 `production`）**：讀同樣兩個標頭（本機 Next server 在沒有時以 socket 位址補上 `x-forwarded-for`），都沒有時用 runtime 位址。Next 的 server 用 `??=`，**保留**用戶端送來的 `x-forwarded-for`，所以這個模式只能用在不對外的環境。
- **本機 Playwright（`next start`，`NODE_ENV=production`）**：只有 `isExplicitLocalE2eRuntime` 成立時（`E2E_TEST_MODE=true`，`NEXT_PUBLIC_APP_URL` 是 loopback 且等於 `E2E_BASE_URL`）才比照本機模式，讓 smoke 測試以 `X-Forwarded-For` 隔離限流桶。e2e 不設 `VERCEL_ENV`。
- **其他 production runtime（CI build smoke、自架）**：不支援，一律回 null；限流把這類請求算進同一個 `unknown` 桶（偏嚴，不會被偽造標頭分桶），並每個執行個體每分鐘最多記一筆 `client_ip_unresolved` 錯誤 log（只含信任模式名稱）。
- **不可以在非 Vercel 的主機設定 `VERCEL_ENV`**（也不要把 `vercel env pull` 的檔案拿去對外的主機用）：它是「edge 已覆寫 `x-real-ip`／`x-forwarded-for`」的唯一訊號，設錯會讓用戶端自己送的 `x-forwarded-for` 被採信。
- **IPv6**：限流鍵把 IPv6 位址截到 /64（同一個用戶通常握有整個 /64，逐位址分桶等於可以輪換）；IPv4-mapped 位址（`::ffff:0:0/96`）改用內嵌的 IPv4 分桶。稽核紀錄、session 與 Turnstile 仍用完整位址。CSP 回報上限相同。
- **preflight 與健康檢查**：`CLIENT_IP_TRUST` 檢查在 Vercel 上（`VERCEL=1` 或有 `VERCEL_ENV`）而信任模式是 `none` 時 FAIL；CI 等非 Vercel 的 production 只給 WARN，避免 CI 的 `NODE_ENV=production` preflight 與 build 失敗。`RATE_LIMIT_PROVIDER=cloudflare_waf` 時：Vercel Production（`VERCEL_ENV=production`）FAIL；Vercel Preview（staging）只給 WARN，訊息相同，避免未確認的 staging 設定擋住所有 staging 部署。`/api/health` 與 `/api/admin/preflight` 回報 `clientIpTrust`（只有模式名稱）；provider 名稱在 `/api/admin/preflight` 的 `rateLimit.provider`。
- **部署後 smoke**：`scripts/external-smoke.ts`（只打 staging／preview）與 `scripts/qa/go-nogo-public-probe.mjs` 斷言 `/api/health` 的 `clientIpTrust === "vercel-edge"`；staging 另斷言 `deployment.commitSha` 存在（證明 Vercel 系統變數有進到 runtime）。Production 的健康檢查刻意不回部署身分（`commitSha` 一律 null），所以 Production（`GO_NOGO_TARGET=production`）只檢查信任模式。**建議（未實作）**：另設自訂變數 `DEPLOYMENT_PLATFORM=vercel`，在它存在而 `VERCEL_ENV` 缺少時讓 preflight 與執行時都 fail，補上 Vercel 系統變數沒進 runtime 時偵測不到的盲點。
- **直播觀眾（MAJOR-A）**：每個請求要同時通過兩道限流。(1) 寬鬆的每 IP 上限：`live-updates-read-ip` 每分鐘 5400（180×30）、`live-chat-read-ip` 1800（60×30）、`live-chat-write-ip` 600，讓同一個 NAT 或電信 CGNAT 後面的一整班觀眾不會互相卡住，同時限制單一來源靠開很多 admission 或報名把額度放大的倍數。(2) 身分桶：讀取（`live-updates-read` 180、`live-chat-read` 60）用以 query 的 vendorId／liveId 驗章、未過期、綁定本次 admission cookie 的 viewer pass（`liveViewerPassRateLimitIdentity`）；發言（`live-chat-write` 60）用驗章通過的聊天 session（`chatSpeakerRateLimitIdentity`，以報名 `submissionId` 的雜湊分桶）。兩者都不查資料庫，驗不過才退回 IP。注意：每次新的 admission 會拿到新的 pass、也就是新的桶，所以身分桶本身不是單一來源的上限，上限靠第 (1) 道。聊天發言仍要求有可信 IP（黑名單與紀錄用）。
- **呼叫端已知身分時**：`checkRateLimit(request, key, limit, windowMs, { clientIp })` 直接指定桶身分（直播聊天、購買廣播、live-updates 傳入已解析的 IP；講師私訊傳 `null` 搭配 per-user key；upsell 傳固定的 `authenticated-buyer` 搭配 grant 雜湊 key）。不可把原始標頭值傳進 `clientIp`。
- **直播聊天**：`liveChatIpTrustConfig` 在 Vercel 部署上與上面相同（不再需要 `x-celebratedeal-live-chat-ingress` proof，因為沒有任何前置 proxy 能注入它）；非 Vercel 的 production（本機 E2E）仍沿用 ingress proof 合約，本機開發仍只用 runtime 位址。
- `RATE_LIMIT_PROVIDER` 只選計數儲存，不決定信任哪個標頭。`cloudflare_waf` 時 `checkRateLimit` 不計數；網域不經 Cloudflare，所以 Production 的 preflight 直接 FAIL，staging 給 WARN；兩者都應使用 `RATE_LIMIT_PROVIDER=upstash_redis`。**staging 的 `/api/admin/preflight` 若出現這個 `RATE_LIMIT_PROVIDER` WARN，請 owner 把 staging 改為 `upstash_redis`（並設定 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`）。** **Production 部署的前置條件（MINOR-B）**：Production 是 `cloudflare_waf` 時 build 的 preflight 會失敗，owner 必須先在 Production 改成 `upstash_redis` 並設好 Upstash 兩個變數，才能部署。
- 測試：`src/lib/trusted-client-ip.test.ts`（偽造 `cf-connecting-ip`／`true-client-ip` 不改變限流鍵）、`src/lib/request-client-ip.test.ts`、`src/app/api/security/csp-report/route.test.ts`。

**CSP 轉強制（R-01）**：要等本項上線、並在 staging 累積一段時間的 `csp_violation` 回報後再評估；A4-03 本身不改 `CSP_ENFORCE`。

## 瀏覽器 QA

風險決定覆蓋範圍，使用固定非 Production 與唯一合成資料。角色涵蓋受影響的 anonymous、owner、staff、finance、platform admin 未驗證／已驗證 MFA；狀態涵蓋 empty、loading、validation／authorization／provider error、success、duplicate、large list、expired session。

驗證實際交付介面、可見結果、URL／state、API 回應及必要 DB 落地；相關情境另檢查 console errors 與 failed network requests。輸入欄位仍有文字不能證明 POST 成功。敏感流程包含登入／return／reset／MFA recovery、建立並發布商品／video／form／script／live、public playback／referral／CTA／lead、server-priced checkout／paid／refund／duplicate callback、vendor read-only finance／platform settlement／payout、跨租戶 ID 竄改。

視覺與 responsive 變更檢查 Chromium 與相關 390×844、768×1024、1280×800、1440×900 viewport；重大 UI 變更另驗 keyboard、a11y、clipping／overlap／內容密度。一般與受控 browser runner 沿用現行 [playwright.config.ts](../playwright.config.ts) 和 [CI](../.github/workflows/ci.yml)，必要時使用既有 scoped disposable runner。

證據記錄 `scenario | role | viewport | data state | result | revision/head | evidence | issue`，區分本機合成、外部 Sandbox 與 Production。問題回報附 severity、重現步驟、expected／actual、owner 及必要 console／network 證據；只存有界、去識別分類，不保存 raw log、URL query、header 或 payload。敏感旅程關閉可能保留 token／cookie／payload 的 trace／screenshot／video，改存有界且去識別的狀態；只有已確認不含敏感資訊的視覺 fixture 才保留影像。不得停用 assertions、盲改 snapshot、重試掩蓋固定失敗或把 external-required 改成 PASS。

### Staging browser smoke（merge queue 流程）

每次 merge queue 合併、Vercel 建好 preview 並把固定 alias 指向該 deployment 之後執行。`<sha>` 為 master 上該 queue commit 的完整 40 碼 SHA，`<host>` 為 Vercel 為該 SHA 建立的 `celebrate-deal-staging-*.vercel.app` immutable host：

```
gh workflow run staging-browser-smoke.yml --ref master -f source_sha=<sha> -f deployment_host=<host> -f surface=fixed_alias
```

lineage 步驟（`node scripts/mvp-payuni-sandbox-e2e.mjs --verify-lineage`）依序驗證：GitHub Deployment 紀錄（environment `Preview – celebrate-deal-staging`）的最新 success status 指向 `<host>` 且 SHA 完全相同；`<sha>` 為 `master` 本身或其祖先（GitHub compare API，不比對分支名稱，因此 `gh-readonly-queue/*` ref 的 deployment 可通過；所有 surface 都檢查）；alias 自證：對 alias `GET /api/health`，回應的 `deployment.commitSha` 必須等於 `<sha>`、`deployment.vercelUrl` 必須等於 `<host>`（兩者由 Vercel 注入，只在 Preview 回傳）。Vercel 防火牆會以 403 拒絕直接探測 immutable host，所以只有 `immutable_preview` 才探測該 host。下一步 `--verify-alias` 是獨立的 Vercel API 證明；token 無權限（401／403／缺少）時才退回同一個 master 檢查加 alias 自證——這和 lineage 步驟是同一道證明，不是第二道。自證只擋得住誠實但未審查的部署，擋不了偽造，長期應修好 `VERCEL_TOKEN` 權限。host 與 SHA 的綁定由前述 Deployment 紀錄證明。所有受保護 runner（WP2／WP4／LINE／funnel）同樣只在 alias 自證通過後打 alias，細節見 `docs/launch/secure-staging-runner.md`「固定 alias 自證」。

## 設計與互動

先定義頁面受眾、單一主要工作、資料密度與 mobile workflow；重用目前 [ui.tsx](../src/components/ui.tsx)、[globals.css](../src/app/globals.css) 的元件與 token。定義 default、hover、focus-visible、disabled、loading、empty、error、success、selected，再做視覺調整。

後台保持中性、清楚、適當資訊密度；橘／紅橘／金保留給 conversion、urgency、success 或主要動作。文字使用自然繁中、舒適行高與直接動詞。不要無產品理由加入紫藍漸層、發光裝飾、玻璃效果、巨大圓角、巢狀卡片、emoji icon 或競爭的主要 CTA；mobile 不能只是縮小 desktop。

驗證 hierarchy、label／metadata、table scanning／filter／pagination／empty／error、form recovery、visible focus／current／live semantics、contrast 及 reduced motion。動畫用於說明狀態；慶祝需真實確認事件及既有使用者授權。沒有實際驗證不能宣稱 a11y／responsive 完成。

## 驗收與交付

先核對 git scope、migrations、secret／tenant／payment／commission／idempotency／audit、對應 unit／integration／DB／browser／build／preflight 與 unresolved findings。每次證據綁目前 revision/head，保留所有失敗與歷史 checksum。外部 provider 缺證據就明確 blocked，不以 mock 或本機 demo 代替真實 Sandbox 成功。

PR 合併前 CI 必須通過；security／payment／DB 變更另需一次獨立審查（`.claude/agents/reviewer.md`），不得自行核准。Production、正式 DB／付款／退款／寄信仍需要另外明確授權。

交付回報包含 scope、已通過與失敗的 gate、證據、外部相依、forward migration 與可恢復方式、必要 review、實際下一步與 owner；不要把未驗證配置或 requested/resolved model 當成 observed。

## 已接受的殘餘風險

- 直播網址（`Live.slug`）全站唯一。草稿自動存檔與送出時的「直播網址已被使用」提示，會讓任何商家成員得知某個網址是否已被任何租戶使用（只回布林值，不回 id）。這與送出時資料庫唯一鍵衝突本來就能得到的訊號相同；若日後要改成租戶命名空間，另開議題。
