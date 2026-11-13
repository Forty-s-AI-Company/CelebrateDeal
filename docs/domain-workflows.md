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
- **換裝置觀看**：觀看頁以報名驗證後設定的簽章 cookie（30 天）辨識報名者。在沒有這個 cookie 的裝置（例如在電腦報名、用手機開信）上，觀看者跟隨公開時程：正在播的場次，否則下一場，最後一場之後則是最近一場的回放。這是 Phase 1 的已知限制。
- **公開回放**：每場回放期限是「場次結束＋`sessionReplayWindowHours`」與直播 `replayAvailableUntil` 中較早者。沒有 cookie 的觀看者在最後一場之後看到的是最後一場的回放，所以任何人在回放開啟期間都能看到回放，不限於報名者；與單一開播時間的直播相同，回放不是報名者限定內容。

### 常青場課後信（F-2）

常青場（`isActiveEvergreenLive`）的觀眾場次只存在簽章 httpOnly cookie。課後信（`post_live_followup`）依常青模式分兩種：

- **商家設定共用開場時間（`evergreenSessionStartAt`）**：這場等同單一固定時間的場次。排程對**所有已驗證報名者**以**目前的**共用開場時間計算（開場＋影片長度＋規則分鐘數），走一般單一時間的路徑，不讀也不寫 `EvergreenSessionAssignment`；設定共用開場前就驗證的人也會收到。商家改動開場時間時，舊時間尚未寄出的那封在寄送前被 supersede，新時間到期才寄；已寄過就不再寄。共用場次結束後才完成驗證的報名者，下一輪排程就會收到所有已到期的課後信（每條規則各一封），和一般單一時間直播相同。
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
- **常青關閉、結束或改回草稿**：沿用 #582，依原開播時間補寄給已驗證報名者；常青期間已收到同一規則課後信的人不會再收到（待 owner 決定是否改變補寄對象）。
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
- **寄信**：每一步是一筆行銷信，一定附退訂連結，走既有寄送流程；寄送前再確認商家仍有授權、序列仍寄送中、步驟與模板未改、收件人不在黑名單、這封建立未超過 6 小時。只改模板內容時，已排隊還沒寄出的那一封會被略過、不改寄新版本。寄送中的序列在用的模板不能停用或改觸發條件；仍遇到不可用的模板時，那一步約每 5 分鐘重試，逾期 24 小時才跳過。
- **吞吐量**：序列工作排在每輪 job 的最後（補漏 → 推進 → 寄序列信）；這一輪已跑超過 90 秒就整段留給下一輪，240 秒後不再接新項目。有時效的信與序列信各用每輪 20 封的寄送額度；worker 每輪只建「20 封減去仍在佇列的序列信」，平均分給有到期 run 的商家、起始商家每輪輪替，同一人前一封還在佇列時下一步會等。全平台約「每輪 20 封 × job 頻率」（每 5 分鐘一輪＝每小時 240 封；每小時一輪＝每小時 20 封），大場次排在後面的人可能晚數小時，晚超過 24 小時的那一步會被跳過。開放給一般商家前由 owner 決定 job 頻率與額度（`docs/product/delayed-steps-design.md` 第 9 節）。
- **停止**：退訂（同一交易停止該收件人在這個商家所有進行中的序列）、黑名單、序列暫停（進行中的人停止，重新啟用不復活）、序列刪除、報名刪除。「買了就停」是下一個 PR。
- **上限**：每商家 5 條寄送中的序列、每條 10 封；目前沒有 Email 用量計量。

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

### 商家凍結（F-036／B02-14）

平台管理員在 `/admin/vendor-features` 凍結或解除凍結整個商家（需要 15 分鐘內 MFA step-up；填寫內部原因；寫 AuditLog `vendor_suspended`／`vendor_suspension_lifted`）。權威資料是 `Vendor.suspendedAt`，判斷只走 `src/lib/vendor-suspension-state.ts`，各頁不自行判斷。

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
| PayUni 付款回呼 | 照常驗章、入帳（交易、訂單、佣金、月結資料），但數位／課程權限留在 pending、不建立學員付款通知；`payment.paid` 事件標 `fulfillmentHeld`。解除凍結時同一交易開通已付款訂單的 pending 權限 |
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
- 學員 portal session 最長 7 天，且只在當初兌換的 magic-link 列（`StudentPortalAccessToken`，同 vendor、同 customerKeyHash、已 consumed）仍存在時有效；登出、同一瀏覽器重新登入（先撤銷被覆蓋 cookie 的那一列）、`revokeStudentPortalSessions` 或客戶匿名化刪除該列即撤銷。`revokeStudentPortalSessions` 已接到商家封鎖 Email 與商家凍結（批次版 `revokeAllStudentPortalSessionsForVendor`）；全額退款刻意不撤銷，見「商家凍結」後的「學員 portal session 撤銷」；目前沒有變更客戶 Email 的流程。後台「撤銷學員登入」操作仍列為後續工作（F-030 M2）。任何清理該表的排程都必須保留已 consumed 的列至少 7 天。
- Provider smoke 端點（test-email／analytics／monitoring、Cloudflare upload／live input）只認 `OPS_SMOKE_SECRET`，vendor 一律是部署設定的 `SMOKE_VENDOR_ID`；排程 `/api/jobs/*` 與 preflight 仍用 `JOB_SECRET`。

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
