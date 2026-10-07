# 剩餘功能交付矩陣

接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head PR CI 待交付 | LOCAL_ACCEPTED |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | root 唯一 writer | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | F2.1 已實作並正在驗證；其餘完整範圍保留 | IN_PROGRESS |
| F3.1 | #211 `b5397dbb45ddc4dc15a3059b7dec90b5a7771487`：editor parent echo、文件替換與 undo/redo lifecycle | 現行 FunnelPageEditor / FunnelStepPagesEditor | 主代理 writer；f3_inspect 唯讀 | parent echo 保留歷史；外部替換顯示新文件；undo/redo 不還原外部舊文件；真實瀏覽器測試 | `remaining-capabilities-f3.1-local-receipt-20261006.json`：14 unit、9 Chromium、lint/typecheck、獨立複審與 canonical READY；push/PR CI PASS，#369 squash `2319c742`，合併 tree 與驗收 head 一致 | DELIVERED |
| F3.2 | 同來源：popup/template/flow 完整互動、team/video UI 與 guard inventory | F3.1、逐功能核對實際介面 | 主代理，待分批路由 | 完整瀏覽器互動與持久化；必要 disposable QA；舊 selector 只對應已交付 UI | 待產生 | PENDING |
| Q1 | `35d8f59341bcb776e548c69fe874a3f4d1fe2528`：固定 PENDING_REFUND consumer | 精確交易 ID、非 Production 綁定、現行退款契約 | 主代理，待分批路由 | 權限/CSRF、單筆 processed RefundRecord、冪等/重複拒絕；sandbox 與 mock 分列 | 待產生 | PENDING |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`：owner/buyer/subscription recovery 與 ops | 固定非 Production 資源/環境契約 | 主代理，待分批路由 | 隔離、越權/錯環境拒絕、recovery 回歸與必要 staging 實測 | 待產生 | PENDING |
| A1 | `937f796d25d0e27db753b7786ea77ea3e773a686`、`bf45235f8b10fa1fded2da0a4c079e5b883cfef0`：未遷移應用/workflow | F1/F2/Q1/Q2 | 主代理直接處理 | 每個有用能力接現行 canonical vNext；無第二套 launcher/舊排程 | 待產生 | PENDING |
| E1 | future-work E1：歷史證據及 tmp/support 差異 | 每批候選 snapshot | 主代理 | 新 revision 綁定的 validation/review/CI/acceptance；不降低測試範圍 | 各批收據 | IN_PROGRESS |

## 執行契約

- 現行 canonical policy：一個 writer、一個唯讀 helper；每 task 最多四次 dispatch，depth 1，不遞迴。
- 本輪明確 user dispatch，`automatic_spawn=false` 不改寫。模型路由保存在各批 route receipt；主代理模型不因路由而宣稱切換，observed 未回報時為 unknown。
- 已確認 `.github/workflows/ci.yml` 同時監聽 push/pull_request；保留現有 lint、typecheck、unit/coverage、router 與 browser gate。
- 檢查未執行不得標 PASS；同一 snapshot 經 canonical acceptance 與精確 head CI 才可交付。正式環境操作未授權。

## 2026-10-06 交付 checkpoint

F3.1：PR [#369](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/369)，候選 head `00d43f4875489a1fa6f0b30a5cb2397f35fa3743`，merge `2319c742f1455681ff08b720c193a2faf1545e27`。push run `37354840583` 與 PR run `37354873011` 全部 quality PASS；expected head 合併後 tree 比對無差異。

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。

### 2026-10-07 F2 private #381 現行 CI 失敗診斷

- ID：f2-live-private-chat-purchase-broadcast；base head 716c8253467a2b7b69c7bbc92d650ded6e18a4ae；PR #381 未交付；owner root 唯一 writer。
- 精確 CI 37569742620 line58 與新 runner line64 的實際 assertion 是講師頁面的「合成觀眾甲」button；先前判讀成登入失敗錯誤，現在已更正。實際登入 assertion 通過。
- 三份 memory-mode 新失敗收據保留：86 migrations、25 DB PASS、2 browser PASS、1 instructor inbox FAIL，零 skip/flaky，cleanup PASS；不宣稱成功。
- 登入-only 診斷已移出候選程式，保留於自有 ignored tmp。新增真正 inbox 診斷只輸出 navigation/API HTTP status、頁面與精確合成訊息存在的 boolean，不輸出帳號、識別、URL、Cookie、body 或 raw error。
- 16 項 privacy/reporter unit 與 scoped lint PASS；原斷言、權限與 rate limit 不變；來源 fingerprint 擴及實際 auth、rate limiter、reporter/config。
- 新隔離完整 runner session 18782 RUNNING；不能使用先前 cloudflare_waf 隔離成功代替 full CI 的 memory 條件。尚未修正根因、尚未新獨立審查，canonical 現行候選非 READY。Goal ACTIVE。

- 2026-10-07 最新 session 18782 FAIL 收據保留於 docs/remaining-capabilities-private-inbox-memory-diagnosis-20261007.json，closed diagnostic PRIVATE_INBOX:N200:A403:P1:M0；實際登入已成功，第一則 viewer private message 未落地。
- 根因契約：production-mode memory → liveChatIpTrustConfig none → private POST 缺 trusted IP 被拒絕。原 getByText 未證明 POST/DB persistence。修正明確 loopback E2E + owned ingress proof 契約，memory limiter 不變；一般 Production、公網 URL、缺/錯 proof 仍拒絕。
- 完整 CI 此 private journey 也啟動自有 loopback ingress，其他 journeys 不改路由。加强 real viewer/instructor POST201、message list、精確 DB1、講師 browser GET200→撤權403；原跨租戶、重送、內容替換、真實回應遺失、身分切換與驗證撤銷 assertions 保留。
- 最新 62 targeted tests/7 files、TypeScript、scoped lint PASS；新增安全回歸涵蓋旗標/公網/不一致 loopback、缺 proof、錯 proof、畸形 IP 與原有 Cloudflare/development 契約。
- 新完整 memory/disposable runner session 56354 RUNNING，尚未新 head commit/CI 或獨立複審。原 task dispatch 4/4，未擅自增派。NOT_READY 未交付，Goal ACTIVE。

- 上述 session 56354 終態 PASS：86 migrations、25 DB、3 actual browser、memory limiter，zero skip/flaky、cleanup PASS。source sha256:0d1da01e323e67810d3f27ab92e58fcf737f88a475e8473d9761d5c209479c55；實際 viewer/instructor POST201、精確訊息落地、rendered list、講師 browser GET200→撤權403 與原剩餘 assertions 全部通過。新證據 docs/remaining-capabilities-private-memory-browser-pass-20261007.json。現行主線 a10728f4147ce84ad6d33524ed0e412660602283 尚待整合，不以舊 CI 宣稱新修正交付；最後獨立審查未執行，原 task 4/4 cap 保留。
