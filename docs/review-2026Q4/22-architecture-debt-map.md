# 22 架構債地圖（E-01 前置）

> 基線 `78621ca3`。依 `10-findings-register.md` 的去重結果，把 finding 對到模組，並並列測試可信度（`18-test-quality.md`、`11-architecture.md` 給 E-02 的證據表）、可隔離度（`11-architecture.md` 模組可隔離度表，1＝難、5＝易）與市場價值（市場研究「功能模組決策」的 Keep／Kill／Add／Defer）。唯讀，未新增 finding。
> 原任務指定檔名 `19-architecture-debt-map.md`，因編號 19 已被可觀測性報告使用，改存為本檔。

## 0. 先講結論

1. 熱度（BLOCKER×3＋MAJOR）最高的三個模組是 infra／CI（BLOCKER 2、MAJOR 15）、checkout／payments（BLOCKER 2、MAJOR 9）、live／interaction（BLOCKER 0、MAJOR 13）。
2. 錢路的債集中在兩處：**checkout／payments** 的 PayUni 回呼判斷（BLOCKER，F-037）與 **billing／settlement** 的月結（兩個 BLOCKER，F-038、F-039）。前者封測前必修；後者在封測免費、最早 12 月才月結的前提下可放到 L1，但必須在第一次撥款前修完。
3. **infra／CI** 的 BLOCKER 不是程式缺陷，而是「做了也看不見、壞了救不回」：沒有排程（F-042）、沒有 Production 備份證據（F-058）。它們讓其他模組的正確性失去意義，所以排在 L0 核心。
4. **live／interaction** 的 MAJOR 最多，但多數是首次成功路徑的 UX 斷點（預覽死路、slug、角色預設、標示策略），修法便宜；真正的結構風險是容量（輪詢與用量計量），取決於封測場次的同時在線人數。
5. 測試可信度與風險成反比的地方：billing／settlement（中低）、forms／funnel（中低）、LINE／notifications（中低）。checkout／payments 的 webhook 測試連真 DB、可信度高，但輸入格式不真實，所以 BLOCKER 照樣通過全部測試。
6. 除了橫切的 infra／CI，熱度前段的 checkout／payments、live／interaction、billing／settlement、auth／tenant 可隔離度都只有 1～2。這支持 B-01 的結論：**核心不重寫，以特徵化測試加同檔抽函式推進**；第一個 strangler 候選是 courses／portal（可隔離度 3，封測隱藏）。

## 1. 模組 × 風險熱度表

「BLOCKER／MAJOR」為去重後主模組是該模組的列數（合併列只算一次）；「L0 項」為含 L0 核心或可繞過段落的列數。

| 模組 | 範圍（01 系統地圖分群） | BLOCKER | MAJOR | 熱度 | L0 項 | 測試可信度（18／11） | 可隔離度（11） | 市場價值（市場研究） | 建議動作（供 E-01／E-02） |
|---|---|---:|---:|---:|---:|---|---|---|---|
| checkout／payments | payment／checkout／webhook／refund（97 檔）＋payuni／payment-providers | 2 | 9 | 15 | 4 | 中高：`payment-webhooks.test.ts` 44 案、0 mock、連真 DB（最值得保留的資產）；checkout `route.test.ts` 66 案但 11 個 mock；**PayUni 回呼輸入是自創欄位（B08-02）**，E2E 全用 demo provider | 1（結帳／金流核心：不可隱藏、不可下線） | Keep（精簡）：商品＋結帳，封測不隱藏；須補消保法揭露與 7 日解除權告知 | 保留並重構（不重寫）：先修 BLOCKER，再以特徵化測試＋同檔抽函式拆 `payment-webhooks`、checkout route（F-009、F-010） |
| billing／settlement | 平台 billing（方案、帳單、用量、付款方式，57 檔）＋月結／出款（`actions.ts` 財務區段約 990 行）＋Funnel 綁卡閘門（散落 ≥8 檔） | 2 | 4 | 10 | 2 | 中低：`billing.test.ts` 有精確金額但缺 B03-02／03；`billing-cycle.test.ts` mock 為主；`platform-plan-checkout.ts` 566 行無同名測試；`actions.test.ts` 財務區段靠手寫假 Prisma，真 DB 只有出款 5 案 | 2（billing 與配額閘門糾纏；綁卡閘門散落） | billing：Keep 架構／Add 公開價格頁，封測隱藏（封測免費）；Funnel 綁卡：Defer，封測隱藏 | 延後並隱藏：封測先關旗標（F-002），撥款前修月結兩個 BLOCKER 與淨額、佣金扣除（F-038、F-039、F-040、F-044）；之後把 `actions.ts` 財務區段下沉到 lib service |
| auth／tenant | auth／mfa／csrf／rate-limit／security（42 檔）＋tenant／sales project／team（23 檔） | 1 | 6 | 9 | 7 | 中：`auth.test.ts` 29 案但**有一條把 B02-01 漏洞釘為預期**（B08-03）；55 個 E2E direct-url／跨租戶 spec；`csrf.test.ts` 強；第二租戶負向案例缺 12 項（B08-05） | 1（被 487 條邊依賴；不可隱藏、不可下線） | 不在市場研究的模組決策範圍（平台基礎） | 保留並強化：合併 #436、補 partner 角色與第二租戶測試；`auth.ts` 拆分列 L3 |
| affiliate | affiliate／referral／commission／payout（49 檔）＋`actions.ts` 出款約 700 行 | 0 | 2 | 2 | 2 | 中：`affiliate-commission-accounting.test.ts` 金額導向強；`affiliate-actions.test.ts` 4 案弱；`affiliate-portal.db` 真 DB；payout outcome 無外租戶案例 | 2（佣金帳務是 webhook 交易的一部分） | 市場研究：Defer 並隱藏；**owner 決策（§2.3）：封測開放，佣金只累計不出款** | 保留但收斂：只累計、關出款（F-052 平台開關或不鎖月結）；B03-08 由 owner＋律師二選一 |
| live／interaction | live（chat／danmaku／interaction／studio／media，115 檔）＋cloudflare／media／stream（30 檔） | 0 | 13 | 13 | 9 | 中（未專門評估）：`stream-usage.test.ts:398` 把「序列化衝突回 exhausted」釘為預期（B06-06）；`live-stepper-form.test.tsx` 20 處弱斷言；`live-chat.db` 等 3 個 DB 測試只在 CI 執行 | 2（全專案最大，14 個模組依賴它） | 直播：Keep（核心）；虛擬使用者：市場研究建議 Kill 偽裝觀眾，**owner 10-18 選不標示版**；Add 場次透明度報告 | 保留並修主線：預覽死路、slug、角色預設、標示策略、時區；容量（輪詢、用量計量）依同時在線人數決定 |
| forms／funnel／landing | funnel／landing page／team-funnel（82 檔）＋form／registration（29 檔）；諮詢預約（Funnel 區塊） | 0 | 2 | 2 | 1 | 中低：`funnel-blocks/*` 0 測試、`landing-pages/*` 元件 7／25 有測試；`createLandingPagePuckConfig` 0 測試；報名失敗重試（#441）與 `proxy.test.ts` 有覆蓋 | Funnel／Landing 3、報名表單 2、team-funnel 3、諮詢預約 4 | 報名表單：Keep（核心）；Funnel：Keep 漏斗頁、Defer 綁卡；諮詢預約：Keep（輕量），預設隱藏 | 保留：封測主體；`/lp` proxy 讀 DB 先量測再決定重構；三種內容格式收斂列 L3 |
| courses／portal | course／student portal（38 檔） | 0 | 0 | 0 | 0 | 中：`student-course-learning.db`、`course-community.db` 真 DB＋4 個 E2E；`course-commission-accounting.test.ts` 3 案弱；`course-curriculum-actions` 無測試 | 3（`/portal` 前綴、獨立 session 與 model，金流只經 3 個契約檔） | Defer，封測隱藏（以場次回放權限替代） | 延後並隱藏；B-01 建議為第一個 strangler 候選（約 70 檔、5,900 行） |
| LINE／notifications | line／learner notification（41 檔）＋email（12 檔） | 0 | 2 | 2 | 2 | 中低：沒有 LINE E2E；#431 的 SMS、WhatsApp、Web Push 未用真實 provider 驗證；`email-delivery.ts` 1,220 行 | 3（不設定官方帳號即不啟用） | Keep（核心）＋Add 費用歸屬設定；須在 10-27 前決定 LINE 方案、加送達失敗告警 | 保留：先補排程（F-042）讓信與 LINE 真的會送，再補綁定教學與預設模板 |
| tracking | tracking（Meta CAPI／TikTok／analytics，29 檔） | 0 | 0 | 0 | 0 | 中：有獨立的 tracking DB＋瀏覽器 gate 在 CI 內執行 | 4（outbox 已是接縫） | Keep Meta、Defer TikTok／Google；預設關閉、由創辦人協助設定 | 保留現狀；只需排程（tracking-deliveries）與 job 失敗告警 |
| admin ops | payuni／wp4 sandbox（35 個非測試檔）＋28 條 `/api/admin/ops/**` | 0 | 3 | 3 | 2 | 中高：28 條 route 各有測試、`wp4-runtime-boundary.test.ts` 覆蓋環境閘門；但它們是 harness 本身 | 4（已被 preview-only 檢查封住；需先解耦 B01-07） | 內部工具，不屬市場模組 | 移除出正式 bundle：短期 proxy 404，中期建置期排除與 harness 解耦 |
| infra／CI | platform core（db／env／audit／monitoring）＋CI／workflow／排程／備份／Sentry | 2 | 15 | 21 | 8 | 覆蓋率可信但保護力有限：Statements 65.52%、Lines 70.78%；分母含 423 個 scripts 檔、`src/lib` 專屬值未輸出（B08-06）；CI 串行約 33 分鐘；flaky 根因未證實 | —（橫切） | 不屬市場模組；但單位成本（輪詢、Stream、LINE）與市場研究成本模型相關 | 封測前補三個「無法復原／看不見」缺口：排程、備份、Sentry PII；其餘 CI 與文件整理列 L2 |
| 跨模組（共用 UI／殼層） | 跨模組的共用 UI、商家殼層、錯誤頁與格式化（`ui.tsx`、`app-shell.tsx`、`format.ts`、`(app)/layout.tsx`） | 0 | 9 | 9 | 3 | 中：`FormSubmitButton` 設計良好；a11y 測試只攔 critical／serious、漏掉註冊與結帳等路由（B07-27）；CRM 與行動諮詢有 4 個純原始碼字串假測試（B08-01） | —（橫切） | 不屬單一模組；直接影響「講師從註冊到第一筆成交」的首次成功路徑 | 修共用元件一次受益：時區、狀態徽章、錯誤頁 retry、殼層查詢 |

## 2. 各模組的 BLOCKER／MAJOR 清單

### infra／CI（熱度 21）

- **F-006**［MAJOR，L3］`src/lib` 340 個頂層檔沒有目錄分層與內部相依規則，最長相依鏈 15 層，資料存取、領域規則、框架耦合混在同一層（B01-06）
- **F-031**［MAJOR，L0（①）／L2（②③）］MFA secret、LINE／Meta 憑證、PII envelope 等加密與 HMAC 金鑰都由 `CSRF_SECRET` 衍生（非 production 退回 `JOB_SECRET`），envelope 無 key id：輪替即全部密文不可解，還原備份時沒保存當時的 secret 也不可讀（B02-08、B04-03）
- **F-042**［BLOCKER，L0］repo 內沒有任何排程驅動 9 個 `/api/cron`、`/api/jobs` 端點（測試還禁止 `vercel.json` 加 crons）：交易信、開播提醒、LINE、學員通知、付款 webhook 重試、庫存保留釋放、月結都不會自動執行；4 個 job 只收 POST＋`JOB_SECRET`，Vercel Cron 無法直接驅動（B03-06、B09-01）
- **F-058**［BLOCKER，L0］Production 從來沒有備份或還原證據；唯一真實來源還原演練是 07-22（58 條 migration，現為 108）；runbook 寫 Supabase Free（無 managed backup、無 PITR）；staging 加密恢復 runner 缺金鑰仍 BLOCKED（B04-01）
- **F-059**［MAJOR，L2］財務與帳務表對 Vendor 的 FK 全是 ON DELETE CASCADE（全 schema 192 個 Cascade）：一次刪除 Vendor 會清掉付款、退款、結算、發票、佣金；AuditLog 對 Vendor 是 SetNull（B04-02）
- **F-060**［MAJOR，L0（可繞過）］schema 與 DB 實際索引漂移（4 個 partial unique、3 個 trgm GIN、3 個一般索引、3 處名稱不符），CI 沒有 drift 檢查；任何人跑一次 `migrate dev` 就可能產生 DROP INDEX，拔掉防重複預約與防重複抵扣的唯一性（B04-04）
- **F-090**［MAJOR，L0］Production 的函式區域、DB 區域、連線池參數都不在 repo 也沒有文件，preflight 不檢查；若沿用美東預設而 DB 在東京，將重現 Dashboard 逾時；`new PrismaClient()` 無池參數（B06-03、B04-14（連線池部分））
- **F-141**［MAJOR，L0（可繞過）］4 個 job（LINE、live-media、tracking、payuni probe）失敗分支只回 503、沒送 Sentry；沒有任何 heartbeat 或 Cron Monitor（B09-02）
- **F-142**［MAJOR，L1］`/api/health` 只做 `SELECT 1`，沒有 job lag、migration 版本或外部相依，綠燈不代表可用（B09-03）
- **F-143**［MAJOR，L0］Sentry 只關了 `userInfo` 與 `httpBodies`，cookies、headers、query params、stack frame 變數預設都收集，也沒有 `beforeSend`；PII 可能經海外 DSN 外流（B09-04）
- **F-146**［MAJOR，L1（10 分鐘，可隨任一 L0 PR 順手）］`quality` job 沒有 `timeout-minutes`（預設 360 分鐘），公開 repo 可被濫用 runner 時間（B09-07）
- **F-149**［MAJOR，L0（設定）］fork PR 核准政策只擋首次貢獻者，曾貢獻過的外部帳號 fork PR 可直接跑 workflow（B09-10）
- **F-152**［MAJOR，L0（設定；封測用 Production 時）］GitHub `Production` 與 `Preview – celebrate-deal` 環境完全無保護、沒有 workflow 使用；staging `buildCommand` 每次部署都跑 `db:migrate:deploy`，變數誤填即直接改 Production schema（含接手事項 T7）（B09-14）
- **F-153**［MAJOR，L0（設定）］公開 repo 的 secret scanning、push protection、Dependabot security updates 全部關閉，也沒有 `dependabot.yml`（B09-15）
- **F-156**［MAJOR，L2］CSP 只有 Report-Only 且 `script-src` 含 `unsafe-inline`／`unsafe-eval`；回報端點收下後直接回 204，部署以來蒐集到的違規資料為零（B09-18、A04-判讀4）
- **F-164**［MAJOR，L2］`docs/` 1,885 個檔案中約 1,725 個（91.5%）是可封存的收據與一次性報告，搜尋、審查與新人閱讀被淹沒（B10-10）
- **F-165**［MAJOR，L2］43 個 `docs/` 檔案被測試或 CI 以固定路徑讀取（含 readiness 快照的 30 個），直接搬動會讓 CI 變紅（B10-11）
- 另有 MINOR／NIT／未分級 39 列，見總表。

### checkout／payments（熱度 15）

- **F-003**［MAJOR，L1］`refundPaymentTransactionAction` 留有約 182 行不可達的舊 PayUni 退款實作；非 PayUni 交易退款只在本地記帳、不呼叫 provider（B01-03、B03-14）
- **F-008**［MAJOR，L3］PayUni adapter 為一個 zod schema 值匯入 1,302 行的 `payment-webhooks.ts`，載入 adapter 的傳遞閉包 50 個檔案、9 個模組（B01-08）
- **F-009**［MAJOR，L3］`processPaymentWebhookOnce` 347 行（complexity 61）在單一交易內扇出佣金、課程分潤、訂閱、推薦、發票、庫存、追蹤等領域（B01-09）
- **F-010**［MAJOR，L3］結帳 route 1,100 行包辦驗證、價格、庫存、歸因、冪等、發票、provider、追蹤，含 7 處內聯 Prisma（B01-10）
- **F-037**［BLOCKER，L0］PayUni 付款回呼只看 `Status`，不檢查 `TradeStatus`／`PaymentType`：刷卡失敗、取消、ATM／超商剛取號都被記為 paid（開通課程、算佣金、計入月結）；測試 fixture 全是自創欄位，所以抓不到（B03-01、B08-02）
- **F-040**［MAJOR，L1（首次月結前；封測期間資料之後依費率回算）］真實 PayUni 回呼沒有 `NetAmount`／`GatewayFee`，每次 paid 都把 `netAmountCents` 覆寫成 0：月結不扣手續費、佣金與課程撥款的 netReference 全為 0（B03-04）
- **F-041**［MAJOR，L0（可繞過）］商品可設任意 3 碼幣別，checkout 仍把 `priceCents/100` 當台幣送 PayUni（USD 50.00 只收 NT$50）；月結跨幣別直接加總（B03-05、B08-04（測試部分））
- **F-043**［MAJOR，L0（可繞過）］庫存保留過期後才收到 paid 且商品已售完時，整筆付款交易 rollback、重試後 exhausted：買家已被扣款、訂單停在未付，沒有自動退款或告警（B03-07）
- **F-050**［MAJOR，L1（封測交易量低，碰撞機率可忽略；公開上線前必修）］訂單號 `CD-<秒>-<Math.random 6 碼>` 沒有 DB 唯一約束；PayUni 回呼以 `(providerName, orderNumber)` 跨租戶反查且無索引：撞號時已付款訂單永遠無法入帳，量大時每筆回呼全表掃描（B03-16（唯一鍵部分）、B04-06）
- **F-062**［MAJOR，L2］核心帳務表（PaymentTransaction、RefundRecord、Settlement、PayoutItem 等）CHECK 為 0、status 為自由字串，付款狀態預設竟是 `"paid"`；`RefundRecord.providerEventId` 不唯一（B04-07、B03-16（CHECK 部分））
- **F-101**［BLOCKER，L0］買家結帳頁的必勾選項寫著「這些文件在正式上線前仍需真人 owner 核准」，內部備註直接顯示給每位買家（B07-01）
- 另有 MINOR／NIT／未分級 12 列，見總表。

### live／interaction（熱度 13）

- **F-079**［MAJOR，L0］觀眾端直播頁查無／未發布時 `notFound()` 落到 Next 預設英文 404（沒有根層與 `(viewer)` 的 not-found）；`global-error` 與 `p/[slug]/error` 沒有重試或返回動作（B05-03、B07-08、B05-07（not-found 部分））
- **F-091**［MAJOR，L1（(1)(3)；預期 >50 人同時在線則升 L0）／L2（(2)）］觀眾每人每分鐘約 53 次請求、185 條 SQL（聊天 3 秒、互動 2 秒），沒有可見性閘門與 since；300 人約 900 SQL/s；市場研究的請求量低估約 9 倍（B06-05）
- **F-092**［MAJOR，L0（可繞過）］用量心跳在 Serializable 交易內掃整月帳本，多人同時心跳的序列化衝突被轉成 `stream_minutes_exhausted`（429），觀眾端暫停播放、該分鐘不入帳（B06-06）
- **F-093**［MAJOR，L1］Cloudflare Stream 播放網址公開、永久有效、無簽章，任何人可不經入場、不計額度地觀看；用量靠客戶端心跳自報，遞送費記在平台帳上（B06-07）
- **F-095**［MAJOR，L0（決策；不納入封測則 UI 隱藏，未估）］瀏覽器直播（WHIP／WHEP）依賴自架媒體伺服器，沒有部署、容量、頻寬文件，清理 job 無排程；單點且無 CDN（B06-09）
- **F-102**［MAJOR，L0（可繞過）］「建立草稿並預覽」導向的預覽頁是死路（無回到編輯、發布、複製連結），內容是欄位清單與 Live Input UID；步驟 8 的手機預覽是寫死的假畫面（B07-02）
- **F-103**［MAJOR，L0］新建互動角色預設不是「排程角色」，腳本編輯器的角色下拉因此是空的且沒有空狀態；勾選框說明與現況不符（B07-03）
- **F-104**［MAJOR，L0］owner 10-18 選定封測開放「不標示」虛擬使用者，但角色頁、暖場控制台、彈幕、條款都寫「會標示」，聊天室仍輸出必填 `label`（空白時 fallback「一般觀眾」），用詞五種：目前做不到真正不標示（B07-04）
- **F-105**［MAJOR，L0（可繞過）］觀眾端彈幕元件 `LiveDanmaku` 沒有任何頁面掛載、也沒有 CSS，但講師控制台可「開啟全場彈幕」「手動發送」並顯示成功，觀眾什麼也看不到（B07-05）
- **F-106**［MAJOR，L1（不會卡住；建議與 F-110 同 PR 順手）］直播間、儀表板、影片、客服等頁的狀態徽章直接輸出資料庫列舉值（`draft`、`scheduled`、`vod`、`ready`…）（B07-06）
- **F-107**［MAJOR，L0］直播必填英文「Slug」、不從標題帶入、全站唯一卻無事先檢查；重複時 `tx.live.create` 的 P2002 未攔截，可能整頁錯誤且無返回按鈕（推論，需實測）（B07-07）
- **F-113**［MAJOR，L0］直播只要綁商品，發布前就必須有已發布的互動腳本；上線導引也把啟用角色、發布腳本列為完成條件：不想用虛擬使用者的講師被迫建立腳本（B07-14）
- **F-118**［MAJOR，L1］直播 8 步 stepper 在 390px 寬先堆約 510px 的步驟按鈕，控件 40px 高；步驟切換不移焦點、不通知螢幕閱讀器（B07-19）
- 另有 MINOR／NIT／未分級 8 列，見總表。

### billing／settlement（熱度 10）

- **F-002**［MAJOR，L0（可繞過）］封測要隱藏的課程、billing、Funnel 綁卡沒有任何旗標；綁卡閘門散落 ≥8 個檔案；新商家預設仍看到 payout、既有商家因 normalize 規則全開；6 個帳務導覽項無旗標（B01-02、B07-23（隱藏模組部分））
- **F-005**［MAJOR，L3（階段 0＝F-003 列 L1）］`src/app/actions.ts` 2,472 行／51 個 export，財務區段約 990 行與一般 CRUD 同檔；債務上限 2,500 只剩 28 行；`payment-webhooks.ts`、checkout route 同為高頻改動大檔（B01-05、A04-判讀3）
- **F-038**［BLOCKER，L1（封測免費且最早月結在 12 月；開始撥款前必修）］月結把商家付給平台的方案費與帳單款（`billingPurpose` 為 `platform_subscription_checkout`／`invoice_payment`）算成商家營收，經撥款全額退回商家；沒有回歸測試（B03-02、B08-04（測試部分））
- **F-039**［BLOCKER，L1（開始撥款前必修）］退款歸屬月份由表單決定、預設原銷售月（通常已鎖定），下月月結也不納入；超過當月營收的退款被 `Math.max(0, …)` 吃掉，跨月退款成為平台淨損失（B03-03、B08-04（測試部分））
- **F-061**［MAJOR，L2（封測免費；若封測跑 Production 且配額依方案則升 L0）］seed 第 8 行拒絕所有非 loopback DB，`SEED_MODE=production-bootstrap` 成為死碼，repo 內沒有建立 Production `BillingPlan` 的途徑；bootstrap 重跑還會把已調整的價格蓋回 seed 值（B04-05）
- **F-077**［MAJOR，L0（可繞過）］3 個 error boundary 用 16.3.8 已不存在的 `unstable_retry` prop，「重新載入」呼叫 undefined；測試手動塞 prop 所以全綠（B05-01）
- 另有 MINOR／NIT／未分級 7 列，見總表。

### auth／tenant（熱度 9）

- **F-001**［MAJOR，L1（owner 若定義隱藏＝不可觸及，升 L0）］功能模組的「隱藏」只是客戶端遮罩；伺服器元件、Server Action、API 仍可觸及，`funnel_builder`、`live_webinar`、`consultation_booking`、`analytics_advanced` 完全沒有伺服器端檢查（B01-01）
- **F-004**［MAJOR，L0（可繞過）］限流與審計的來源 IP 優先信任 `cf-connecting-ip`；若流量不經 Cloudflare 代理，攻擊者可偽造標頭繞過登入、註冊、重設密碼、客服、諮詢的 per-IP 限流（B01-04）
- **F-024**［BLOCKER，L0］沒有 MFA factor 的平台 admin 可直接進 `/admin/**`、執行正式退款、月結、出款、解密銀行帳號匯出；現有測試把漏洞釘為預期；修正 PR #436 與 master 衝突（CRLF 假衝突）（B02-01、B03-09、B08-03、B11-02）
- **F-088**［MAJOR，L0（可繞過）］`getCurrentAuth()` 沒有 `React.cache`，商家頁硬載入時 layout、page、details API 各查一次深度 include（每次 7～9 條 SQL），還載入 MFA 密文與全部復原碼雜湊（B06-01）
- **F-114**［MAJOR，L0］商家註冊頁沒有條款與隱私連結、沒有同意紀錄，也沒有專屬商家服務條款；之後無法證明商家同意「虛擬使用者責任歸商家」（B07-15）
- **F-134**［MAJOR，L1］高風險 server action 缺第二租戶負向案例（`vendor-member-actions` 無測試檔；payout outcome、payout policy、course curriculum、affiliate portal、PII 搜尋等）（B08-05）
- **F-169**［MAJOR，L0（可繞過）］沒有因子的 admin 帳號「誰先用密碼登入誰就能登記 TOTP」，`mfaVerifiedAt` 也沒有與因子 `enabledAt` 綁定；bootstrap 密碼外洩即可搶先登記（B11-03）
- 另有 MINOR／NIT／未分級 13 列，見總表。

### 跨模組（共用 UI／殼層）（熱度 9）

- **F-078**［MAJOR，L0（可繞過）］5 個 error boundary 用 `reset`（不向伺服器重取資料），Dashboard 逾時、結帳頁與付款結果頁出錯時按「重試」無效（需實測）（B05-02）
- **F-083**［MAJOR，L1（金流相鄰的方案結帳與出款在封測關閉）］12 個檔案的表單用裸 `<button>`，沒有 pending、防重送；含推廣夥伴「簽署提領」與方案結帳等金流相鄰操作（B05-09）
- **F-089**［MAJOR，L0（可繞過）］商家殼層 `(app)/layout.tsx` 約 4 段依序、10 餘條查詢（含 onboarding 計算），`loading.tsx` 遮不住，硬載入與 layout 級 revalidate 都要先等它（B06-02、B01-11（layout 部分））
- **F-110**［MAJOR，L0］`formatDateTime` 沒指定 `timeZone`，伺服器元件依執行環境（Vercel 預設 UTC）輸出：講師排 20:00 的場次在列表顯示 12:00；欄位標籤直接寫「Asia/Taipei」「轉成 UTC」（推論，需 staging 實測）（B07-11）
- **F-111**［MAJOR，L1（不會卡住；創辦人導入時口頭說明）］封測主線頁面大量工程術語（ref 追蹤、immutable usage ledger、fail closed、heartbeat、payment provider reference、Workspace、basis points…），且商品表單暴露封測隱藏的課程分潤欄位（B07-12）
- **F-115**［MAJOR，L1（不會卡住；可與 F-106 同 PR）］側欄固定顯示綠色閃爍圓點與「系統連線正常」，沒有連到任何健康檢查；另有英文「Live Commerce OS」「Beta」（B07-16）
- **F-116**［MAJOR，L1］儀表板 10 個 KPI 沒有「已付款訂單數／金額」，只有含未付款的「近 7 天訂單建立」（B07-17）
- **F-117**［MAJOR，L1］共用 `Field`／`TextArea`／`SelectField` 沒有 error、hint、`aria-invalid` 插槽；商品、直播、角色的伺服器錯誤只在頂端顯示泛用訊息、不聚焦欄位（B07-18）
- **F-133**［MAJOR，L1］4 個測試檔 7 個 case 只讀原始碼做 `toContain`（39 ms 通過、從未執行被測程式），剛好是處理 PII 與租戶範圍的 CRM 與行動諮詢（B08-01）
- 另有 MINOR／NIT／未分級 13 列，見總表。

### admin ops（熱度 3）

- **F-007**［MAJOR，L2］WP4 Sandbox harness 編進正式 auth、結帳、發票、方案頁；`createWp4PreviewMfaVerifiedSession` 可建立已通過 MFA 的 session，只靠環境變數組合保護（B01-07、B10-02）
- **F-016**［MAJOR，L0（①，可繞過）／L2（②③）］28 條 `/api/admin/ops/**` 隨正式 bundle 部署；其中 5 條（test-email、test-analytics、test-monitoring、cloudflare×2）與 `/api/cloudflare/*` 只靠與 cron 共用的 `JOB_SECRET`，可帶任意 vendorId；先回 401 再判斷環境（B01-16、B02-09、B03-21、B10-01）
- **F-168**［MAJOR，L0（F-024 的前置）］staging 財務 QA 帳號沒有 MFA factor，4 個 PayUni 退款／復原 runner 只處理 `/mfa/verify`：#436 合併後整條 Sandbox QA 鏈停在 `/mfa/setup`（B11-01）
- 另有 MINOR／NIT／未分級 2 列，見總表。

### affiliate（熱度 2）

- **F-025**［MAJOR，L0（可繞過）］夥伴入口與團隊上下線只能授權給既有 VendorMember，沒有最小權限的 partner 角色：accountant 可看全部夥伴佣金並標記任何出款、support 可讀全部買家客服 PII（B02-02）
- **F-044**［MAJOR，L1（開始撥款前必修）］月結先從商家撥款扣除聯盟佣金，但聯盟出款設計為商家自付後回報、平台沒有撥給聯盟的路徑（`payoutItemId` 從未寫入）：商家被扣兩次，或款項沒有出口（B03-08）
- 另有 MINOR／NIT／未分級 3 列，見總表。

### forms／funnel／landing（熱度 2）

- **F-015**［MAJOR，L1（量測）／L2（重構；封測導入廣告流量則升 L1）］`/lp/*` 每個 GET（含 RSC 預取）都在 proxy 讀整份已發布 content；同一請求 content 讀取解析 3 次、訪客寫入阻擋 TTFB，每次瀏覽至少 6 次 DB 往返（B01-15、B05-04、B06-04）
- **F-108**［MAJOR，L0（可繞過）］報名雙重確認完成頁沒有「前往直播間」「加入行事曆」；連結過期頁沒有連結也沒有「重寄確認信」（B07-09）
- 另有 MINOR／NIT／未分級 4 列，見總表。

### LINE／notifications（熱度 2）

- **F-109**［MAJOR，L0（可繞過）］「報名成功 Email」是發布必要條件，但新增模板時主旨與內容全空白、沒有範本（B07-10）
- **F-112**［MAJOR，L0（樣式，可繞過）／L1（教學與錯誤分類）］LINE 綁定頁沒有逐步教學、錯誤訊息泛用；三個檔案用了不存在的色票 `text-muted-foreground`、`text-destructive`，錯誤不會變紅；模板頁又寫 LINE「尚未串接」（B07-13）

### courses／portal（熱度 0）

- 沒有 BLOCKER／MAJOR。MINOR／NIT 共 1 列。

### tracking（熱度 0）

- 沒有 BLOCKER／MAJOR。MINOR／NIT 共 0 列。

## 3. 熱點交叉：哪些債同時壓在多個模組上

| 交叉點 | 涉及模組 | 相關列 | 說明 |
|---|---|---|---|
| `src/app/actions.ts`（2,472 行） | billing、affiliate、checkout、live | F-003、F-005、F-039、F-044、F-049、F-107 | 退款死碼、結算、出款、直播建立同檔；封測期間 F-107 也會動 `actions.ts:816`，同一時間只能一個 writer |
| `src/lib/auth.ts`（被 293 個檔傳遞依賴） | auth、admin ops、所有後台頁 | F-024、F-007、F-088、F-022 | MFA、WP4 session、請求快取都改同一檔；L0 只動 MFA，`getCurrentAuth` 快取排在 MFA 合併之後 |
| `payment-webhooks.ts`＋`payuni.ts` | checkout、billing、affiliate、courses | F-037、F-040、F-047、F-048、F-067、F-008、F-009 | 回呼判斷、淨額、eventId、未知訂單都在這兩檔；L0 修 TradeStatus 時建議同批處理 L1 的三個回呼項 |
| 排程與 job | infra、LINE、checkout、billing、tracking、live | F-042、F-141、F-142、F-043、F-095 | 一個缺口同時讓寄信、LINE、webhook 重試、庫存釋放、月結、追蹤、直播清理全部停擺 |
| 模組旗標 | billing、courses、affiliate、forms、live | F-001、F-002、F-111、F-122 | 封測「隱藏」靠它；目前只有客戶端遮罩，且缺課程、billing、綁卡旗標 |
| `/lp` proxy | forms／funnel、infra | F-015 | 三軸同一問題；封測若導入廣告流量才急 |

## 4. 與市場研究的落差（以 owner 決策為準）

| 項目 | 市場研究建議 | owner 決策（goal plan §2.3、§9） | 本地圖的處理 |
|---|---|---|---|
| 聯盟分潤 | Defer，封測隱藏，用人工轉介替代 | 封測開放，佣金只累計不出款 | 依 owner：保留累計，L0 以「不鎖月結」或平台開關（F-052）落實不出款；F-025 的夥伴身分混用改為 L0 可繞過；多層次傳銷與扣繳列律師／會計師清單 |
| 虛擬使用者 | Kill 偽裝觀眾，改造為系統強制標示的官方腳本角色 | 10-18 改選不標示版（B），商業統計只算真實資料 | 依 owner：F-104 採方案 A（標籤選填、移除 fallback、改寫文案與條款），商家服務條款須律師審閱；市場研究提出的法律風險列入律師清單 |
| 課程、billing、綁卡 | Defer／封測隱藏 | 一致 | 依 F-002 的旗標隱藏；綁卡視 T1 結果 |
| 諮詢預約 | Keep 輕量、預設隱藏 | 未另行決定 | 隨 F-002 的模組清單一起決定 |

## 5. 給 E-02（重構 vs 重寫）的摘要

- **不重寫**：checkout／payments、auth／tenant、billing、affiliate 的可隔離度都是 1～2，且測試中最可信的資產（webhook 真 DB 測試）就在這裡；B-01 估「特徵化測試＋同檔抽函式＋依賴反轉」合計約 17–25 人天，可與封測並行（F-007、F-008、F-009、F-010）。
- **可先清掉、讓核心變小**：admin ops／WP4 harness（約 54 檔）與死碼（約 20 檔），成本遠低於重寫（F-016、F-007、F-018、F-161）。
- **strangler 第一候選**：courses／portal（獨立 URL、session、model，金流只經 3 個契約檔；封測隱藏）。第二候選 tracking，但價值低。
- **重寫前提**：先做三件便宜且與結論無關的事：F-003（退款死碼）、F-004（限流 IP）、F-001（真正的功能關閉）。

## 6. 限制

- 模組歸屬是本檔的判斷（依主要檔案路徑）；跨模組的列歸到「跨模組」或最主要的模組，熱度數字只適合比較相對大小。
- 測試可信度引用 18、11、03 的文字判斷，沒有重新執行測試；live／interaction 與 LINE 沒有專門的可信度評估，標「未專門評估」或依 03 的缺口描述。
- 市場價值引用市場研究的【推論】決策；與 owner 決策衝突處以 owner 為準。
