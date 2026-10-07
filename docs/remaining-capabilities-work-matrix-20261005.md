# 剩餘功能交付矩陣

目前核對主線：`728f0e591c0a5d4a83fe98d6a98146f9d7d0d842`（F3.1 #369 與 F1.1 #370 已交付）；F1 #370 head `84cdb475` 雙 CI SUCCESS、合併 tree 一致；Q1 #371 Draft head `561ffdfe` CI 未通過。以下最初接手 SHA 為歷史紀錄。

接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head push/PR CI SUCCESS；#370 squash `728f0e59`、tree 一致 | DELIVERED |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | root 唯一 writer | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | F2.1 已實作並正在驗證；其餘完整範圍保留 | IN_PROGRESS |
| F3.1 | #211 `b5397dbb45ddc4dc15a3059b7dec90b5a7771487`：editor parent echo、文件替換與 undo/redo lifecycle | 現行 FunnelPageEditor / FunnelStepPagesEditor | 主代理 writer；f3_inspect 唯讀 | parent echo 保留歷史；外部替換顯示新文件；undo/redo 不還原外部舊文件；真實瀏覽器測試 | `remaining-capabilities-f3.1-local-receipt-20261006.json`：14 unit、9 Chromium、lint/typecheck、獨立複審與 canonical READY；push/PR CI PASS，#369 squash `2319c742`，合併 tree 與驗收 head 一致 | DELIVERED |
| F3.2 | 流程編輯器已接入實际workspace；三項review finding修正完成完整回歸；team/video尚未承接。同來源：popup/template/flow 完整互動、team/video UI 與 guard inventory | F3.1、逐功能核對實際介面 | 主代理，待分批路由 | 完整瀏覽器互動與持久化；必要 disposable QA；舊 selector 只對應已交付 UI | `remaining-capabilities-f3.2-local-receipt-20261006.json`：13 unit、16 harness、actual workspace browser、獨立複審及 canonical READY；#372 CI/整合待驗證 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
| Q1 | #371 Draft；精確 consumer/proof 已實作，本機76 unit與8DB通過；CI未通過，sandbox指定交易驗收缺注入。`35d8f59341bcb776e548c69fe874a3f4d1fe2528`：固定 PENDING_REFUND consumer | 精確交易 ID、非 Production 綁定、現行退款契約 | 主代理，待分批路由 | 權限/CSRF、單筆 processed RefundRecord、冪等/重複拒絕；sandbox 與 mock 分列 | 待產生 | PENDING |
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

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
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


Q2 分支既有 checkpoint：

### 2026-10-06：AGY 修復交付與 Q2 接續

| ID | 精確來源／相依 | owner | 驗收與新證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| AGY-Claude | 修復 head `cc4070206340200acf3a10cd7ba558bda0dcb4bb`；PR #377 squash `5a25018d87fdfd780286107136968121088a9ac7` | root writer；一名 readonly reviewer，dispatch 2/4 | 兩個 Claude slug 各 40,093 字元實際 wrapper PASS；完整 routing/resilience、UTF8、超時與截斷回歸 PASS；獨立複審 findings=[]；canonical READY；push/PR CI `37407696287`、`37407703413` SUCCESS；accepted/merged tree 均 `bef8cd0de500e2817513006b35af7c210ca09006` | DELIVERED；不代表任何產品批次已交付 |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`；現行固定非 Production owner/buyer/subscription/ops 契約 | root writer；task dispatch 1/4 | 新增歷史 buyer 精確 source/tenant/checkout、單筆退款、重複事件及跨產品拒絕回歸；補正 recovery HTTP status 與既有 runner 契約；本次 targeted 67/67 PASS；先前 disposable PG 86 migrations、54/54 PASS 保留 | IMPLEMENTED_PARTIAL_VERIFICATION；尚需 buyer/callback 實際 DB、完整 workspace browser、Critical review、canonical acceptance、精確 head CI、PR；外部 sandbox secret/proof 尚缺，不能宣稱真實退款成功 |

### 2026-10-07：Q2 Critical 修正與 CI 相依更新

| ID | 精確來源／相依 | owner | 驗收與證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`；候選基底 `f66b5f0` | root writer；Critical task 3/4 | 新 forward migration：87 migrations、61/61 DB PASS；36/36 targeted unit、TS、lint PASS；新真實簽章 callback route 與 browser 最終回歸執行中；`remaining-capabilities-q2-review-fixes-20261007.json` 綁定產品與測試 hash | IMPLEMENTED_PENDING_FINAL_VERIFICATION；並行 retry、最新 browser、最後一次複審、canonical acceptance／CI／PR 尚未完成，不宣稱交付 |
| CI-sharp | head `85aa6e43b97858592364b8c6041d72b83c5284e6`；PR #378 | root；獨立 Critical reviewer，3/4 | production audit 0；實際 native SVG/PNG PASS；findings=[]；canonical READY `a2c0fb7c`；精確 head push／PR CI 執行中 | VERIFIED_PENDING_DELIVERY；CI 全通後 protected expected-head merge，再接入其他候選 |

### 2026-10-07：現行交付狀態核對（優先於前述歷史 pending）

以下為 GitHub PR 狀態及本機 Git tree 實際比對；不以 ancestry 單獨判定功能完成。原始 dirty 專案及歷史收據未改。

| ID | 精確來源／head | 相依與 owner | 驗收／新證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| F1.1 | PR #370 head `84cdb47567bbc85e3eee43b2557fc899507907d8`；merge `728f0e591c0a5d4a83fe98d6a98146f9d7d0d842` | 現行 portal auth/購買權益；root | 84 migrations、7 DB、1 actual browser、1067 Node TAP、Critical review、canonical READY 與完整 CI；本次 accepted/merged tree 同為 `8cbbcc07a75af21815d57ec9b276517293fe1486` | DELIVERED；F1 社群、多語/PWA/push、通知/SMS/WhatsApp 仍須完成 |
| F2.1 | PR #374 head `ff9ea27896689d9983a203832993b22e4d33097b`；merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73` | tenant/member/CAS/immutable ledger；root | 9 unit、85 migrations、6 DB、1 actual browser、1067 TAP、Critical review、canonical READY 與完整 CI；accepted/merged tree 同為 `4f63c92d6c24e6585484912863704b3ecffd1f43` | DELIVERED；F2 階梯/多層、扣繳/payout/export、推薦/加購/tracking/webhooks、私訊/廣播仍進行中 |
| CI-sharp | PR #378 head `85aa6e43b97858592364b8c6041d72b83c5284e6`；merge `f739c7e017d430f05cc10a85728f5335e1bc20be` | Q2 與其他批次 CI 相依；root | production audit 0、actual native image PASS、Critical findings=[]、canonical READY；push `37495923811`／PR `37495934523` SUCCESS；accepted/merged tree 同為 `8c75ffb60a78fdc814e38c34e30b4777e4f3cd38` | DELIVERED；需各候選接續主線及按影響驗證 |
| Q2 | 來源 `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`；產品修正 head `ff09b43b580a08b3c598f29844754ac688488985`；CI inventory head `b0362e3aca7624b2312a34535c5a60f19bfd1c52` | 固定非 Production；root writer；independent Critical reviewer dispatch4/4 | server-owned tenant/payment ID 經 dispatch 與 Serializable transaction 綁定；兩項新 real PG race/identity regression PASS；產品獨立 review findings=[]、observed unknown。87 migrations；67 DB 首次66 PASS/1 existing settlement FAIL/0 skip；CI inventory/API 同路徑回歸146 PASS、lint/TS PASS。最新完整 DB+2 browser及精確head CI執行中 | IMPLEMENTED_PENDING_ACCEPTANCE；尚未 READY/PR/交付；不得把本機合成 callback 說成外部真實退款 |
| F3.2／F1.2／F2.2 | 既有隔離候選與 checkpoint 保留 | root；各 task dispatch4/4，額外review授權尚待 | 已有實作及 DB/browser 證據，但最新候選必要獨立review尚未完成 | REVIEW_BLOCKED；不換task逃limit，不妨礙其他工作 |
| F1.3 | PR #375／隔離 portal-localization-pwa 候選 | root；review3/4 | 多語/PWA 已有 unit/DB/browser 證據；最新主線與社群整合待驗證 | IMPLEMENTED_PENDING_INTEGRATION_ACCEPTANCE |
| Q1 | Draft #371 head `561ffdfe57d6192ed472055846575aa8846a33d9` | 精確 PENDING_REFUND transaction、核准 sandbox secret 注入 | 76 unit、83 migrations、8 DB、Critical review；browser/provider proof 未完成 | EXTERNAL_BLOCKED；不得 mock 退款成功或選 latest 訂單 |
| A1/E1 | 已列精確歷史來源／每批 revision | F1/F2/Q1/Q2；root | canonical vNext 與本次 revision/head 證據持續補齊；保留歷史資料 | IN_PROGRESS；完整 Goal 尚未 COMPLETE |

Q2 latest exact candidate `b0362e3a`：87 migrations、67/67 DB、2/2 browser、0skip/flaky及cleanup PASS；產品revision `27323082`獨立review findings=[]，canonical assess_acceptance READY。永久新證據 `remaining-capabilities-q2-local-receipt-20261007.json`；精確新head CI及protected PR仍待，Goal IN_PROGRESS。

已交付主線 checkpoint：
本次整合 `origin/master` `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73`：F2.1 #374 已受保護 squash merge，accepted/merged tree `4f63c92d6c24e6585484912863704b3ecffd1f43` 一致。F3.2 Save acknowledgement 最新source `4ab03f...` 本機全部回歸通過、medium canonical READY；最新獨立review受同task dispatch4/4限制仍待授權。整合後驗證與CI待執行，未交付。


### 最新主線整合與驗證（2026-10-07）

| ID | 精確來源／相依 | owner | 驗收與證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| Q2 | accepted `3d32b0a029bedb83912b29e38f54a6c59b38b47b`；protected squash `a10728f4147ce84ad6d33524ed0e412660602283`／PR #379 | root；原 task 額外第5次 review 已由人類明確授權並完成 | 87 migrations、67 DB、2 browser；exact CI 37593169648/37593163815 SUCCESS；accepted/merged tree `7c40ca931b3d5d076edbbfc010aee141b0e7fd7d` 一致；授權 review 收據保留 | DELIVERED；合成非 Production 驗證，未操作正式服務 |
| F3.2 | accepted `f24993f8d68a018f0273a0930cc5b573f526d109`；squash `c95f5869a09e863fef92cd57f853bc2504144809`／#372 | root；人類授權第5次獨立 review 已完成 | exact CI 37550502233 SUCCESS；accepted/merged tree `31bbd6426f8813bd1231adf9262fcc7768e76060` 一致；實際 workspace Save/reload/tenant 回歸 | DELIVERED；不重做歷史批次 |
| F3 team/video | accepted `1dd0409c0bac4484465dc094a8ed0c866d91e767`；squash `4a4a0461aace0cde651b9a4021e415ef0da5e22a`／#382 | root | 85 migrations、2 browser；CI 37589645770/37589618194 SUCCESS；tree `bee631dc3f620ea74e02804db2090571bd3bf2ff` 一致 | DELIVERED；URL video CRUD 與租戶隔離；不宣稱外部 upload proof |
| F2 私訊／購買後廣播 | checkpoint `9b0816b559c98214d0beeeaf9c978db6f218f1f9`，現接入 main `a10728f4147ce84ad6d33524ed0e412660602283`；#381 | root 唯一 writer；原 task review4/4，額外 review 尚未授權 | checkpoint memory ingress 86 migrations/25 DB/3 browser PASS；main integration 148 targeted unit、35 security/reporting unit、12 historical migration TAP、TS/lint PASS；新的88 migrations/25 DB/3 browser執行中 | IMPLEMENTED_PENDING_ACCEPTANCE；不得沿用86-migration證據宣稱整合候選 READY；latest independent review、exact CI、gate與protected delivery未完成 |
