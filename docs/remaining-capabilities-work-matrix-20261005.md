# 剩餘功能交付矩陣

目前核對主線：`728f0e591c0a5d4a83fe98d6a98146f9d7d0d842`（F3.1 #369 與 F1.1 #370 已交付）；F1 #370 head `84cdb475` 雙 CI SUCCESS、合併 tree 一致；Q1 #371 Draft head `561ffdfe` CI 未通過。以下最初接手 SHA 為歷史紀錄。

接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head CI PASS、#370 squash `728f0e59`，验收tree一致 | DELIVERED |
| F1.2 | `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`：學員社群、商家置頂／公告；依現行課程權益重建 | F1.1、portal session、tenant scope、manager CSRF/CAS | root 唯一 writer；Astra high readonly Critical review（observed unknown），dispatch4/4 | 發文／回覆／按讚／分頁／管理公告／退款撤權完整瀏覽器、跨租戶及併發DB、精確CI/PR | 最新候選8unit、TS/lint、1067 Node TAP零skip；85migration9DB、完整實際manager/learner browser PASS，review無findings，canonical READY；PR/CI待交付 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
| F1.3 | 現行 portal 多語與 PWA：繁中/英文登入、課程、社群、public-only離線提示 | #370 已交付；#373 社群待最新review/交付 | root唯一writer；獨立Critical reviewer dispatch3/4 | locale持久化、加密mailbox、跨租戶/退款撤權、禁止個資cache與offline writes | 17unit/1067TAP/85migrations/9DB/3Chromium/TS/strict-index/lint PASS；獨立精確review無findings；canonical READY | LOCAL_READY_DEPENDENCY_AND_CI_PENDING |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | 主代理，待分批路由 | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | 待產生 | PENDING |

| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head PR CI 待交付 | LOCAL_ACCEPTED |

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

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review及gate已通過；#370已交付，不宣稱外部影片 provider PASS。

## 2026-10-06 精確 CI 補正進度

F1.2 PR #373 head `92dcac17` 的 coverage gate 確認漏登社群 GET/POST API 契約及同路徑測試。已新增 8 個 route 邊界回歸，連同既有 8 unit 及契約 inventory 共17項 PASS，TS/strict-index/lint及1067 Node TAP PASS；完整隔離 coverage 正在執行。原始失敗與新 recovery 分開保留，task4/4，額外獨立複審待owner答覆，不宣稱最新修正已canonical READY。

F1.3 source `sha256:f53437d3633da1dfe86f7f2ae5b281000c8a66e63ada658cb63574510e45171b` 本機與獨立Critical驗收完成，證據 `remaining-capabilities-f1.3-local-receipt-20261006.json`；需合併依賴、核对主線影響及精確head CI才可交付。尚未執行外部寄信或push；F1其餘通知及SMS/WhatsApp功能仍必須完成。


F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。


本次社群接入 master `daa6372a`；F2.1 #374已交付、tree一致。F1.2舊head c968 CI雙SUCCESS；整合後129models/86migrations需重新驗證。最新獨立review同task dispatch4/4已用滿，extension待owner回覆，不宣稱已交付。
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


A1 domain workflow migration: exact source `bf45235f8b10fa1fded2da0a4c079e5b883cfef0`, current base `a10728f4147ce84ad6d33524ed0e412660602283`; root sole writer, one readonly reviewer, task `a1-canonical-domain-workflows` dispatch2/4. Six thin project adapters plus shared domain contracts preserve product actors, attribution/commission/refund/chargeback, tenant, browser console/network/privacy, design and canonical acceptance requirements. Six skill validations, links/anchors and 38 routing tests PASS; original MAJOR/MINOR fixed and independent incremental review findings=[]; observed unknown. Canonical revision `sha256:452d43d895b3fb606aed31ab8be39a8c50fe16fecd5a3f203133080f7a6688e6` READY. Evidence `remaining-capabilities-a1-domain-workflows-20261007.json`. Exact-head CI and protected PR delivery pending; remaining historical application/workflow scope retained, A1/Goal NOT COMPLETE.

### F1.3 current main integration 2026-10-07

Root integrated c72b5089; translated course controls retain hydration barrier. 129 models / 88 migrations; 9 DB, 3 actual browser journeys, 28 unit, 5 inventory Vitest, 12 migration TAP, TypeScript/lint PASS; zero skip/flaky, cleanup PASS. Initial setup syntax failure preserved and corrected without reducing assertions. New proof: `remaining-capabilities-f1.3-main-integrated-browser-20261007.json`. Original f1-portal-localization dispatch4/4; latest source independent review not executed. NOT_READY; exact new-head CI pending, not delivered; community dependency retained.

### F1 locale/PWA authorized review 5/5, 2026-10-08

Human authorized one extra original-task readonly review. Reviewer confirmed a MAJOR installed-start redirect outside SW scope. Root corrected to public /portal/start.html reusing existing page/layout, exact locale-return whitelist and offline link; kept /portal/ SW scope. Actual E2E now follows manifest start_url, checks controller and scope, offline reload 503, public-only caches, preserving existing course/refund/isolation assertions. Six unit tests and lint PASS; complete DB/browser runner active (session83807). Not READY, not delivered.
接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head CI PASS、#370 squash `728f0e59`，验收tree一致 | DELIVERED |
| F1.2 | `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`：學員社群、商家置頂／公告；依現行課程權益重建 | F1.1、portal session、tenant scope、manager CSRF/CAS | root 唯一 writer；Astra high readonly Critical review（observed unknown），dispatch4/4 | 發文／回覆／按讚／分頁／管理公告／退款撤權完整瀏覽器、跨租戶及併發DB、精確CI/PR | 最新候選8unit、TS/lint、1067 Node TAP零skip；85migration9DB、完整實際manager/learner browser PASS，review無findings，canonical READY；PR/CI待交付 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
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

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review及gate已通過；#370已交付，不宣稱外部影片 provider PASS。

## 2026-10-06 精確 CI 補正進度

F1.2 PR #373 head `92dcac17` 的 coverage gate 確認漏登社群 GET/POST API 契約及同路徑測試。已新增 8 個 route 邊界回歸，連同既有 8 unit 及契約 inventory 共17項 PASS，TS/strict-index/lint及1067 Node TAP PASS；完整隔離 coverage 正在執行。原始失敗與新 recovery 分開保留，task4/4，額外獨立複審待owner答覆，不宣稱最新修正已canonical READY。
F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。

本次社群接入 master `daa6372a`；F2.1 #374已交付、tree一致。F1.2舊head c968 CI雙SUCCESS；整合後129models/86migrations需重新驗證。最新獨立review同task dispatch4/4已用滿，extension待owner回覆，不宣稱已交付。

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


A1 domain workflow migration: exact source `bf45235f8b10fa1fded2da0a4c079e5b883cfef0`, current base `a10728f4147ce84ad6d33524ed0e412660602283`; root sole writer, one readonly reviewer, task `a1-canonical-domain-workflows` dispatch2/4. Six thin project adapters plus shared domain contracts preserve product actors, attribution/commission/refund/chargeback, tenant, browser console/network/privacy, design and canonical acceptance requirements. Six skill validations, links/anchors and 38 routing tests PASS; original MAJOR/MINOR fixed and independent incremental review findings=[]; observed unknown. Canonical revision `sha256:452d43d895b3fb606aed31ab8be39a8c50fe16fecd5a3f203133080f7a6688e6` READY. Evidence `remaining-capabilities-a1-domain-workflows-20261007.json`. Exact-head CI and protected PR delivery pending; remaining historical application/workflow scope retained, A1/Goal NOT COMPLETE.


## F2 推薦分享接續（2026-10-08）

| ID | 精確來源 | 缺口與相依 | owner | 驗收條件 | 證據 | 實際狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F2 referral sharing | b7956d803f8dfebbbfdb3a4faeff497ab4bc140e 的 referral-card、CopyReferralLink 與 form success caller；主線 #374 affiliate portal | 既有授權夥伴分享連結補 copy/QR；歷史活動邀請接入真實 verified session。相依既有 portal grant、public form DAL、signed registration session，沒有新增個人佣金契約 | root 唯一 writer；一個 readonly reviewer | clipboard readback、SVG文字邊界、QR decoded exact canonical URL、原 merchant attribution、無/invalid/unverified session隱藏、撤權/停用隱藏；DB/browser、Critical review、canonical gate、exact-head CI/protected PR | docs/remaining-capabilities-f2-referral-share-review-2-20261008.json；docs/remaining-capabilities-f2-referral-share-registration-browser-failure-20261008.json | IMPLEMENTED，9 unit/lint/TS PASS，review dispatch 2/4 無新 finding；87 migrations/6DB/夥伴browser PASS，但最新報名browser分享區塊缺席，正在診斷，NOT_READY/NOT_DELIVERED |

失敗收據保留；不以舊的一條成功旅程支持目前完整 scope。Goal F1/F2/F3/Q1/Q2/A1/E1 仍未全部完成。

F2 referral sharing 根因更新：Next16.3.8 的 NextRequest 將 127.0.0.1 正規化為 localhost，原驗證303回跳跨cookie主機。已以真正NextRequest重現並改用共享可信browser-return origin，付款helper保留既有wrapper。新增精確主機與cookiepath unit、移除暫時診斷。最新source `sha256:100ef87c2deb33d4da214faac26fe7f31501f2ffc27c94ef5ef5fcb7ab322f29`，31 targeted unit/lint通過；canonical完整runner與review dispatch3/4執行中，尚未READY或交付。

F2 referral sharing 最終候選 `sha256:4312b55a723fcee2d951fa9131c3f827fcfd035da1d31f4ea261a45ffd193fff`：31 unit、lint、TS、87 migrations、6DB、2actualbrowser zero skip/flaky、cleanup、獨立Critical review dispatch4/4全部PASS；22sourcebytes與Gitobjects完全一致，實際assess_acceptance READY。證據 `docs/remaining-capabilities-f2-referral-share-final-canonical-ready-20261008.json`。目前待精確head CI與受保護PR交付，整體Goal仍IN_PROGRESS。

### F2 referral CI correction 2026-10-08

Exact e968 head CI failed at unit/coverage. Complete local reproduction: 4668 passed, one legacy synchronous page-render test failed, cleanup PASS. Root changed only that unit renderer to asynchronous SSR, retained assertions and added forged-status denial checks; 6 focused tests and lint PASS. Complete unchanged coverage gate rerun active (session85409). No new head pushed, no merge, no current candidate READY claim.

Complete referral correction Git-blob mirror coverage passed: 638 Vitest files / 4669 tests, 1067 Node TAP, zero skip, all unchanged global/library coverage floors met, 87 disposable migrations, cleanup PASS. Historical three CRLF checksum failures retained; no checksum changed. New local correction commit and main integration still require current-source DB/browser and exact-head CI before delivery.
### F1.2 current main integration 2026-10-07

Root integrated c72b5089 into existing community branch; 129 models / 88 migrations, 9 DB + 1 actual browser + 22 unit/API + 5 inventory Vitest + 12 migration TAP PASS; TypeScript/lint PASS, zero skip/flaky, cleanup PASS. Fresh proof: `remaining-capabilities-f1.2-current-main-browser-20261007.json`. Original task dispatch4/4; extra independent review pending authorization. Canonical NOT_READY; exact new-head CI pending; no protected merge yet. All historical evidence retained.

F1.2 current-head CI37616047757 failed at WP-88 exact inventory after main integration: actual91 pages/52 manager vs old90/51. Full inventory corrected without deleting assertions/cases. New isolated complete WP-88 guard matrix browser + 88 migrations/9 DB PASS, zero skip/flaky, cleanup PASS; lint PASS. Receipt `remaining-capabilities-f1.2-main-guard-browser-pass-20261007.json`; new exact head CI and independent review still required.

Referral main integration a5964d83 after protected community delivery: existing sharing product code retained; new community migration/schema and its CI boundary inherited. Earlier 4669 Vitest/1067 TAP/full coverage PASS predates this main integration. Fresh 88-migration actual DB/browser and exact new-head CI required. No delivery claim until current canonical gate and protected merge.

### PWA integration with delivered community 2026-10-08

Root resolved the current a5964d83 main integration without losing locale or community behavior: structural AST comparison after removing locale-only additions was identical for community component, community page and course page. Main guard-capable browser runner retained. Earlier PWA 88-migration/9-DB/3-browser PASS predates this integration and does not prove the new candidate. Sixth readonly final review explicitly approved by owner; fresh complete validation and exact-head CI still required. Community PR373 is delivered with accepted/merged tree equality. Goal IN_PROGRESS.

### Referral delivered PWA main integration 20261008

Integrated delivered main `e573a101` before current final review. Prior head `85034bd4` push / PR CI both complete SUCCESS; those receipts do not substitute for new-head CI. Current revision and source impact verification, full TypeScript and exact-head CI pending. Existing 88 migrations / 6 DB / 2 browser evidence preserved with original head and timestamps. Task dispatch 4/4; current test/CI fixes are not claimed independently reviewed. Not delivered.
# 剩餘功能交付矩陣

目前核對主線：`728f0e591c0a5d4a83fe98d6a98146f9d7d0d842`（F3.1 #369 與 F1.1 #370 已交付）；F1 #370 head `84cdb475` 雙 CI SUCCESS、合併 tree 一致；Q1 #371 Draft head `561ffdfe` CI 未通過。以下最初接手 SHA 為歷史紀錄。

接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head CI PASS、#370 squash `728f0e59`，验收tree一致 | DELIVERED |
| F1.2 | `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`：學員社群、商家置頂／公告；依現行課程權益重建 | F1.1、portal session、tenant scope、manager CSRF/CAS | root 唯一 writer；Astra high readonly Critical review（observed unknown），dispatch4/4 | 發文／回覆／按讚／分頁／管理公告／退款撤權完整瀏覽器、跨租戶及併發DB、精確CI/PR | 最新候選8unit、TS/lint、1067 Node TAP零skip；85migration9DB、完整實際manager/learner browser PASS，review無findings，canonical READY；PR/CI待交付 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
| F1.3 | 現行 portal 多語與 PWA：繁中/英文登入、課程、社群、public-only離線提示 | #370 已交付；#373 社群待最新review/交付 | root唯一writer；獨立Critical reviewer dispatch3/4 | locale持久化、加密mailbox、跨租戶/退款撤權、禁止個資cache與offline writes | 17unit/1067TAP/85migrations/9DB/3Chromium/TS/strict-index/lint PASS；獨立精確review無findings；canonical READY | LOCAL_READY_DEPENDENCY_AND_CI_PENDING |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | 主代理，待分批路由 | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | 待產生 | PENDING |

| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head PR CI 待交付 | LOCAL_ACCEPTED |

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

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review及gate已通過；#370已交付，不宣稱外部影片 provider PASS。

## 2026-10-06 精確 CI 補正進度

F1.2 PR #373 head `92dcac17` 的 coverage gate 確認漏登社群 GET/POST API 契約及同路徑測試。已新增 8 個 route 邊界回歸，連同既有 8 unit 及契約 inventory 共17項 PASS，TS/strict-index/lint及1067 Node TAP PASS；完整隔離 coverage 正在執行。原始失敗與新 recovery 分開保留，task4/4，額外獨立複審待owner答覆，不宣稱最新修正已canonical READY。

F1.3 source `sha256:f53437d3633da1dfe86f7f2ae5b281000c8a66e63ada658cb63574510e45171b` 本機與獨立Critical驗收完成，證據 `remaining-capabilities-f1.3-local-receipt-20261006.json`；需合併依賴、核对主線影響及精確head CI才可交付。尚未執行外部寄信或push；F1其餘通知及SMS/WhatsApp功能仍必須完成。


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


本次社群接入 master `daa6372a`；F2.1 #374已交付、tree一致。F1.2舊head c968 CI雙SUCCESS；整合後129models/86migrations需重新驗證。最新獨立review同task dispatch4/4已用滿，extension待owner回覆，不宣稱已交付。
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


A1 domain workflow migration: exact source `bf45235f8b10fa1fded2da0a4c079e5b883cfef0`, current base `a10728f4147ce84ad6d33524ed0e412660602283`; root sole writer, one readonly reviewer, task `a1-canonical-domain-workflows` dispatch2/4. Six thin project adapters plus shared domain contracts preserve product actors, attribution/commission/refund/chargeback, tenant, browser console/network/privacy, design and canonical acceptance requirements. Six skill validations, links/anchors and 38 routing tests PASS; original MAJOR/MINOR fixed and independent incremental review findings=[]; observed unknown. Canonical revision `sha256:452d43d895b3fb606aed31ab8be39a8c50fe16fecd5a3f203133080f7a6688e6` READY. Evidence `remaining-capabilities-a1-domain-workflows-20261007.json`. Exact-head CI and protected PR delivery pending; remaining historical application/workflow scope retained, A1/Goal NOT COMPLETE.

### F1.3 current main integration 2026-10-07

Root integrated c72b5089; translated course controls retain hydration barrier. 129 models / 88 migrations; 9 DB, 3 actual browser journeys, 28 unit, 5 inventory Vitest, 12 migration TAP, TypeScript/lint PASS; zero skip/flaky, cleanup PASS. Initial setup syntax failure preserved and corrected without reducing assertions. New proof: `remaining-capabilities-f1.3-main-integrated-browser-20261007.json`. Original f1-portal-localization dispatch4/4; latest source independent review not executed. NOT_READY; exact new-head CI pending, not delivered; community dependency retained.

### F1 locale/PWA authorized review 5/5, 2026-10-08

Human authorized one extra original-task readonly review. Reviewer confirmed a MAJOR installed-start redirect outside SW scope. Root corrected to public /portal/start.html reusing existing page/layout, exact locale-return whitelist and offline link; kept /portal/ SW scope. Actual E2E now follows manifest start_url, checks controller and scope, offline reload 503, public-only caches, preserving existing course/refund/isolation assertions. Six unit tests and lint PASS; complete DB/browser runner active (session83807). Not READY, not delivered.
接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head CI PASS、#370 squash `728f0e59`，验收tree一致 | DELIVERED |
| F1.2 | `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`：學員社群、商家置頂／公告；依現行課程權益重建 | F1.1、portal session、tenant scope、manager CSRF/CAS | root 唯一 writer；Astra high readonly Critical review（observed unknown），dispatch4/4 | 發文／回覆／按讚／分頁／管理公告／退款撤權完整瀏覽器、跨租戶及併發DB、精確CI/PR | 最新候選8unit、TS/lint、1067 Node TAP零skip；85migration9DB、完整實際manager/learner browser PASS，review無findings，canonical READY；PR/CI待交付 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
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

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review及gate已通過；#370已交付，不宣稱外部影片 provider PASS。

## 2026-10-06 精確 CI 補正進度

F1.2 PR #373 head `92dcac17` 的 coverage gate 確認漏登社群 GET/POST API 契約及同路徑測試。已新增 8 個 route 邊界回歸，連同既有 8 unit 及契約 inventory 共17項 PASS，TS/strict-index/lint及1067 Node TAP PASS；完整隔離 coverage 正在執行。原始失敗與新 recovery 分開保留，task4/4，額外獨立複審待owner答覆，不宣稱最新修正已canonical READY。
F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。

本次社群接入 master `daa6372a`；F2.1 #374已交付、tree一致。F1.2舊head c968 CI雙SUCCESS；整合後129models/86migrations需重新驗證。最新獨立review同task dispatch4/4已用滿，extension待owner回覆，不宣稱已交付。

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

A1 domain workflow migration: exact source `bf45235f8b10fa1fded2da0a4c079e5b883cfef0`, current base `a10728f4147ce84ad6d33524ed0e412660602283`; root sole writer, one readonly reviewer, task `a1-canonical-domain-workflows` dispatch2/4. Six thin project adapters plus shared domain contracts preserve product actors, attribution/commission/refund/chargeback, tenant, browser console/network/privacy, design and canonical acceptance requirements. Six skill validations, links/anchors and 38 routing tests PASS; original MAJOR/MINOR fixed and independent incremental review findings=[]; observed unknown. Canonical revision `sha256:452d43d895b3fb606aed31ab8be39a8c50fe16fecd5a3f203133080f7a6688e6` READY. Evidence `remaining-capabilities-a1-domain-workflows-20261007.json`. Exact-head CI and protected PR delivery pending; remaining historical application/workflow scope retained, A1/Goal NOT COMPLETE.

### F1.2 current main integration 2026-10-07

Root integrated c72b5089 into existing community branch; 129 models / 88 migrations, 9 DB + 1 actual browser + 22 unit/API + 5 inventory Vitest + 12 migration TAP PASS; TypeScript/lint PASS, zero skip/flaky, cleanup PASS. Fresh proof: `remaining-capabilities-f1.2-current-main-browser-20261007.json`. Original task dispatch4/4; extra independent review pending authorization. Canonical NOT_READY; exact new-head CI pending; no protected merge yet. All historical evidence retained.

F1.2 current-head CI37616047757 failed at WP-88 exact inventory after main integration: actual91 pages/52 manager vs old90/51. Full inventory corrected without deleting assertions/cases. New isolated complete WP-88 guard matrix browser + 88 migrations/9 DB PASS, zero skip/flaky, cleanup PASS; lint PASS. Receipt `remaining-capabilities-f1.2-main-guard-browser-pass-20261007.json`; new exact head CI and independent review still required.

### PWA integration with delivered community 2026-10-08

Root resolved the current a5964d83 main integration without losing locale or community behavior: structural AST comparison after removing locale-only additions was identical for community component, community page and course page. Main guard-capable browser runner retained. Earlier PWA 88-migration/9-DB/3-browser PASS predates this integration and does not prove the new candidate. Sixth readonly final review explicitly approved by owner; fresh complete validation and exact-head CI still required. Community PR373 is delivered with accepted/merged tree equality. Goal IN_PROGRESS.

### Private messaging / purchase broadcast delivered-main integration 20261008

Integrated delivered community/PWA `e573a101`; preserved both documentation histories, both schema capabilities, every original migration and safety assertion. Exact inventory now 130 models / 89 migrations. Prior review 5 applies to `124214d2`; current main candidate requires fresh tests, current review and acceptance. No delivery claim.
# 剩餘功能交付矩陣

目前核對主線：`728f0e591c0a5d4a83fe98d6a98146f9d7d0d842`（F3.1 #369 與 F1.1 #370 已交付）；F1 #370 head `84cdb475` 雙 CI SUCCESS、合併 tree 一致；Q1 #371 Draft head `561ffdfe` CI 未通過。以下最初接手 SHA 為歷史紀錄。

接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確head CI雙SUCCESS、#370 squash 728f0e59、tree一致 | DELIVERED |

| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head CI PASS、#370 squash `728f0e59`，验收tree一致 | DELIVERED |
| F1.2 | `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`：學員社群、商家置頂／公告；依現行課程權益重建 | F1.1、portal session、tenant scope、manager CSRF/CAS | root 唯一 writer；Astra high readonly Critical review（observed unknown），dispatch4/4 | 發文／回覆／按讚／分頁／管理公告／退款撤權完整瀏覽器、跨租戶及併發DB、精確CI/PR | 最新候選8unit、TS/lint、1067 Node TAP零skip；85migration9DB、完整實際manager/learner browser PASS，review無findings，canonical READY；PR/CI待交付 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
| F1.3 | 現行 portal 多語與 PWA：繁中/英文登入、課程、社群、public-only離線提示 | #370 已交付；#373 社群待最新review/交付 | root唯一writer；獨立Critical reviewer dispatch3/4 | locale持久化、加密mailbox、跨租戶/退款撤權、禁止個資cache與offline writes | 17unit/1067TAP/85migrations/9DB/3Chromium/TS/strict-index/lint PASS；獨立精確review無findings；canonical READY | LOCAL_READY_DEPENDENCY_AND_CI_PENDING |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | 主代理，待分批路由 | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | 待產生 | PENDING |

| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head PR CI 待交付 | LOCAL_ACCEPTED |

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

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review及gate已通過；#370已交付，不宣稱外部影片 provider PASS。

## 2026-10-06 精確 CI 補正進度

F1.2 PR #373 head `92dcac17` 的 coverage gate 確認漏登社群 GET/POST API 契約及同路徑測試。已新增 8 個 route 邊界回歸，連同既有 8 unit 及契約 inventory 共17項 PASS，TS/strict-index/lint及1067 Node TAP PASS；完整隔離 coverage 正在執行。原始失敗與新 recovery 分開保留，task4/4，額外獨立複審待owner答覆，不宣稱最新修正已canonical READY。

F1.3 source `sha256:f53437d3633da1dfe86f7f2ae5b281000c8a66e63ada658cb63574510e45171b` 本機與獨立Critical驗收完成，證據 `remaining-capabilities-f1.3-local-receipt-20261006.json`；需合併依賴、核对主線影響及精確head CI才可交付。尚未執行外部寄信或push；F1其餘通知及SMS/WhatsApp功能仍必須完成。


F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。

F2.1 #374 已expected-head受保護squash merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73`；push/PR quality與Preview全部SUCCESS，accepted/merged tree同為 `4f63c92d6c24e6585484912863704b3ecffd1f43`。交付證據 `remaining-capabilities-f2.1-delivery-20261006.json`。F2階梯/多層等完整剩餘範圍持續實作。

F2.1已交付：#374 expected-head squash merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73`，acceptedhead `ff9ea27896689d9983a203832993b22e4d33097b`，tree `4f63c92d6c24e6585484912863704b3ecffd1f43` 一致；精確push/PR CI雙SUCCESS。

| F2.2 | F2剩餘階梯／多層佣金；以F2.1已交付契約為base | immutable收入快照、refund/provider/tenant契約 | root唯一writer、Critical readonlyreview task2/4 | 商家政策UI→exactcheckout→paid tier/counter→全部beneficiary refunds/disputes→portal；併發/冪等/跨租戶/DB/browser/review/canonical/CI | 106targetedunits、86migrations+53DB PASS；browser與獨立Critical review執行中 | IMPLEMENTED_PENDING_VALIDATION |

F2.2 latest source `sha256:c882900512caf63acb2bf3af821b3184614cebd3453d1cebd6b6c96714da88c0`：4605 Vitest、1067 TAP零skip、86 migrations、61 DB、1實際browser、lint/TS/strict全部PASS。抽離純payout helper後canonical gate僅因最新獨立review缺證據BLOCKED；同task dispatch4/4已用盡，額外1次核准待回覆，不宣稱READY或交付。收據 `remaining-capabilities-f2.2-current-regression-20261006.json`。

本次社群接入 master `daa6372a`；F2.1 #374已交付、tree一致。F1.2舊head c968 CI雙SUCCESS；整合後129models/86migrations需重新驗證。最新獨立review同task dispatch4/4已用滿，extension待owner回覆，不宣稱已交付。
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


A1 domain workflow migration: exact source `bf45235f8b10fa1fded2da0a4c079e5b883cfef0`, current base `a10728f4147ce84ad6d33524ed0e412660602283`; root sole writer, one readonly reviewer, task `a1-canonical-domain-workflows` dispatch2/4. Six thin project adapters plus shared domain contracts preserve product actors, attribution/commission/refund/chargeback, tenant, browser console/network/privacy, design and canonical acceptance requirements. Six skill validations, links/anchors and 38 routing tests PASS; original MAJOR/MINOR fixed and independent incremental review findings=[]; observed unknown. Canonical revision `sha256:452d43d895b3fb606aed31ab8be39a8c50fe16fecd5a3f203133080f7a6688e6` READY. Evidence `remaining-capabilities-a1-domain-workflows-20261007.json`. Exact-head CI and protected PR delivery pending; remaining historical application/workflow scope retained, A1/Goal NOT COMPLETE.

### F1.3 current main integration 2026-10-07

Root integrated c72b5089; translated course controls retain hydration barrier. 129 models / 88 migrations; 9 DB, 3 actual browser journeys, 28 unit, 5 inventory Vitest, 12 migration TAP, TypeScript/lint PASS; zero skip/flaky, cleanup PASS. Initial setup syntax failure preserved and corrected without reducing assertions. New proof: `remaining-capabilities-f1.3-main-integrated-browser-20261007.json`. Original f1-portal-localization dispatch4/4; latest source independent review not executed. NOT_READY; exact new-head CI pending, not delivered; community dependency retained.

### F1 locale/PWA authorized review 5/5, 2026-10-08

Human authorized one extra original-task readonly review. Reviewer confirmed a MAJOR installed-start redirect outside SW scope. Root corrected to public /portal/start.html reusing existing page/layout, exact locale-return whitelist and offline link; kept /portal/ SW scope. Actual E2E now follows manifest start_url, checks controller and scope, offline reload 503, public-only caches, preserving existing course/refund/isolation assertions. Six unit tests and lint PASS; complete DB/browser runner active (session83807). Not READY, not delivered.
接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head CI PASS、#370 squash `728f0e59`，验收tree一致 | DELIVERED |
| F1.2 | `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`：學員社群、商家置頂／公告；依現行課程權益重建 | F1.1、portal session、tenant scope、manager CSRF/CAS | root 唯一 writer；Astra high readonly Critical review（observed unknown），dispatch4/4 | 發文／回覆／按讚／分頁／管理公告／退款撤權完整瀏覽器、跨租戶及併發DB、精確CI/PR | 最新候選8unit、TS/lint、1067 Node TAP零skip；85migration9DB、完整實際manager/learner browser PASS，review無findings，canonical READY；PR/CI待交付 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
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

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review及gate已通過；#370已交付，不宣稱外部影片 provider PASS。

## 2026-10-06 精確 CI 補正進度

F1.2 PR #373 head `92dcac17` 的 coverage gate 確認漏登社群 GET/POST API 契約及同路徑測試。已新增 8 個 route 邊界回歸，連同既有 8 unit 及契約 inventory 共17項 PASS，TS/strict-index/lint及1067 Node TAP PASS；完整隔離 coverage 正在執行。原始失敗與新 recovery 分開保留，task4/4，額外獨立複審待owner答覆，不宣稱最新修正已canonical READY。
F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。

F2.1 #374 已expected-head受保護squash merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73`；push/PR quality與Preview全部SUCCESS，accepted/merged tree同為 `4f63c92d6c24e6585484912863704b3ecffd1f43`。交付證據 `remaining-capabilities-f2.1-delivery-20261006.json`。F2階梯/多層等完整剩餘範圍持續實作。

F2.1已交付：#374 expected-head squash merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73`，acceptedhead `ff9ea27896689d9983a203832993b22e4d33097b`，tree `4f63c92d6c24e6585484912863704b3ecffd1f43` 一致；精確push/PR CI雙SUCCESS。

| F2.2 | F2剩餘階梯／多層佣金；以F2.1已交付契約為base | immutable收入快照、refund/provider/tenant契約 | root唯一writer、Critical readonlyreview task2/4 | 商家政策UI→exactcheckout→paid tier/counter→全部beneficiary refunds/disputes→portal；併發/冪等/跨租戶/DB/browser/review/canonical/CI | 106targetedunits、86migrations+53DB PASS；browser與獨立Critical review執行中 | IMPLEMENTED_PENDING_VALIDATION |

F2.2 latest source `sha256:c882900512caf63acb2bf3af821b3184614cebd3453d1cebd6b6c96714da88c0`：4605 Vitest、1067 TAP零skip、86 migrations、61 DB、1實際browser、lint/TS/strict全部PASS。抽離純payout helper後canonical gate僅因最新獨立review缺證據BLOCKED；同task dispatch4/4已用盡，額外1次核准待回覆，不宣稱READY或交付。收據 `remaining-capabilities-f2.2-current-regression-20261006.json`。
本次社群接入 master `daa6372a`；F2.1 #374已交付、tree一致。F1.2舊head c968 CI雙SUCCESS；整合後129models/86migrations需重新驗證。最新獨立review同task dispatch4/4已用滿，extension待owner回覆，不宣稱已交付。

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


A1 domain workflow migration: exact source `bf45235f8b10fa1fded2da0a4c079e5b883cfef0`, current base `a10728f4147ce84ad6d33524ed0e412660602283`; root sole writer, one readonly reviewer, task `a1-canonical-domain-workflows` dispatch2/4. Six thin project adapters plus shared domain contracts preserve product actors, attribution/commission/refund/chargeback, tenant, browser console/network/privacy, design and canonical acceptance requirements. Six skill validations, links/anchors and 38 routing tests PASS; original MAJOR/MINOR fixed and independent incremental review findings=[]; observed unknown. Canonical revision `sha256:452d43d895b3fb606aed31ab8be39a8c50fe16fecd5a3f203133080f7a6688e6` READY. Evidence `remaining-capabilities-a1-domain-workflows-20261007.json`. Exact-head CI and protected PR delivery pending; remaining historical application/workflow scope retained, A1/Goal NOT COMPLETE.

### F2 remuneration current main integration 2026-10-07

Same task f2-merchant-remuneration, root sole writer. Integrated c72b5089; complete137-model/93-migration inventory, original migrations untouched. 29 remuneration DB + 61 webhook/commission DB + 1 actual financial browser + 39 unit + 5 inventory Vitest + 12 migration TAP PASS; TypeScript/lint PASS, zero skip/flaky, cleanup/sourceUnchanged PASS. Full1601-file source fingerprint retained in new proof `remaining-capabilities-f2-remuneration-main-integrated-validation-20261007.json`. Exact93-page guard inventory verified unchanged. Original untracked evidence preserved. Task dispatch4/4; extra independent review authorization pending, exact new-head CI pending, canonical NOT_READY and no delivery.

### F2.2 current main integration 2026-10-07

Same task f2-commission-policy, root sole writer. Original dirty checkpoint worktree preserved; clean isolated integration includes main c72b5089. Complete 133 model / 88 migration inventory; 61 DB refund/commission regressions + 1 actual merchant browser + 142 unit + 5 inventory Vitest + 12 migration TAP, TypeScript/lint PASS; zero skip/flaky, cleanup PASS. Evidence: `remaining-capabilities-f2.2-main-integrated-browser-20261007.json`. Latest independent review and exact new-head CI pending; canonical NOT_READY, no delivery. Dispatch count is unchanged.
### F1.2 current main integration 2026-10-07

Root integrated c72b5089 into existing community branch; 129 models / 88 migrations, 9 DB + 1 actual browser + 22 unit/API + 5 inventory Vitest + 12 migration TAP PASS; TypeScript/lint PASS, zero skip/flaky, cleanup PASS. Fresh proof: `remaining-capabilities-f1.2-current-main-browser-20261007.json`. Original task dispatch4/4; extra independent review pending authorization. Canonical NOT_READY; exact new-head CI pending; no protected merge yet. All historical evidence retained.

F1.2 current-head CI37616047757 failed at WP-88 exact inventory after main integration: actual91 pages/52 manager vs old90/51. Full inventory corrected without deleting assertions/cases. New isolated complete WP-88 guard matrix browser + 88 migrations/9 DB PASS, zero skip/flaky, cleanup PASS; lint PASS. Receipt `remaining-capabilities-f1.2-main-guard-browser-pass-20261007.json`; new exact head CI and independent review still required.

Commission integration with delivered community a5964d83: 136 models and 89 canonical forward migrations. Both community and immutable merchant-affiliate snapshot migrations retained. Updated exact inventory assertions without exclusions or reduced checks; fresh validation pending.

### F2 commission current inventory correction 20261008

- Original task `f2-commission-policy`, correct isolated worktree `commission-main-integration`, integrated product reviewed at `d3be0d9c` in explicitly authorized dispatch 6, raw findings `[]`; failed wrong-path dispatch 5 retained.
- Exact migration assertions repaired after main community integration: 136 models / 89 migrations. Existing fixed historical 81 and 79/21 scopes, checksums and rejection assertions remain intact; community presence checks added. Product code did not change after review. Current test correction commit `87654487e816ad9321d0d51d2fd165e03f3563d7`, source `sha256:3fca9acdb103ea64721a96675555ee5504df69639788eb76baa6d66cebb6d991`.
- Current unit, TypeScript, strict-index, lint and complete TAP 1067/1067 PASS, zero skip. 89 migrations / 61 DB / 1 merchant browser PASS before test-only correction. Full coverage running. Latest three test corrections are not claimed independently reviewed; canonical acceptance and exact-head CI pending. Not delivered.

### PWA integration with delivered community 2026-10-08

Root resolved the current a5964d83 main integration without losing locale or community behavior: structural AST comparison after removing locale-only additions was identical for community component, community page and course page. Main guard-capable browser runner retained. Earlier PWA 88-migration/9-DB/3-browser PASS predates this integration and does not prove the new candidate. Sixth readonly final review explicitly approved by owner; fresh complete validation and exact-head CI still required. Community PR373 is delivered with accepted/merged tree equality. Goal IN_PROGRESS.

### F2 withholding current delivered-main integration 20261008

Preserved both documents and forward schema capabilities while integrating delivered community/PWA `e573a101`. Current 140 models / 94 migrations / 94 protected pages, vendorManager 55. Exact inventory assertions updated; historical migration windows/checksums and safety assertions retained. Previous fifth review applies to head `23b25045`; latest integrated candidate requires new current evidence, acceptance and review. Not delivered.


### 2026-10-07 F2 post-purchase 第 3 次獨立審查與來源證據修正

- ID：f2-post-purchase-commerce；精確候選 base head：e110d25ea46cf7667be94f336a90c1bd7d08e3e1；owner：root 唯一 writer。
- 第 3/4 次 Critical 唯讀審查：49 檔前後 hash 一致；resolved Astra high，observed model/effort unknown。原 task 的 BLOCKED_SENSITIVE_INPUT 只記 task-local cli_failure，未宣稱 Claude 模型不可用。
- 最新 findings：docs/remaining-capabilities-f2-post-purchase-review-3-20261007.json。MAJOR issued PayUni failed/expired 原單恢復仍缺權威 provider observation/recovery 契約；不可用 demo/mock、not-found、換交易或釋放 source credit 替代。
- MINOR 已實作待完整驗證：保留原 files、unit 與全部 migration 清單，新增實際 edit/new merchant entry、product-action-state、reporter 與 mirror 建置設定；使用同一明確來源清單做前後 fingerprint 與 receipt。
- 新增 4 項 meaningful fingerprint 回歸 PASS：edit/page.tsx 與 next.config.ts 修改會改 hash 並拒絕 source-changed；宣告排序/重複穩定；敏感或越界路徑拒絕。scoped lint PASS。
- 新完整 disposable PG/browser runner session 49757 RUNNING；尚未取得終態，舊成功不能支持這份新 receipt。獨立複審剩餘 1/4 次。
- 驗收：付款/order/credit identity、金額、權益、退款、CAS/CSRF、tenant、併發/冪等及 issued provider recovery 全部必要範圍保留。canonical NOT_READY，未建立 PR、未交付，Goal ACTIVE。

- 上述 session 49757 終態 PASS：86 migrations、48 DB、177 unit、1 actual browser，零 skip/flaky、cleanup PASS；新 source sha256:2559270d48cdf6f42ce9b06cc64d0213e9e20392d679208c3d12be8ad42e3773。另 4 fingerprint tests PASS。證據 docs/remaining-capabilities-f2-post-purchase-source-complete-browser-20261007.json；MAJOR 外部 PayUni 恢復仍 OPEN，NOT_READY 未交付。


F2 post-purchase main integration `7e547a998c0091d5cd9c6cb38a0cb9cec55fbe88` includes main `a10728f4147ce84ad6d33524ed0e412660602283`: 127 models / 88 migrations, fresh 48 DB + 177 unit + 1 browser PASS; supplemental 135 callback/subscription/auth tests PASS on fresh 88-migration DB; TS/lint PASS. Pre-integration e003 CI 37606402273 SUCCESS does not prove merged candidate. New receipt: `remaining-capabilities-f2-post-purchase-q2-integrated-browser-20261007.json`. Original task review3/4; issued external PayUni recovery MAJOR OPEN. NOT READY / NOT DELIVERED; full scope retained.

### F2 post-purchase authoritative provider contract evidence 20261008

Original task `f2-post-purchase-commerce`, root sole writer, review3/4 unchanged. Public official PAYUNi query v2.0 and UPP v2.0 were successfully read through the documented public frontend endpoints, with response/content hashes retained. Failed/cancelled/expired/awaiting states and the 10-minute merchant-order duplicate window are documented; permission to resume the same issued TradeNo is not proven. No new checkout, replacement trade, source-credit release or mock provider success was introduced. Q1 prerequisite refund observation correction `448359dd` is locally verified at #371 but not delivered. Evidence `remaining-capabilities-f2-post-purchase-provider-contract-evidence-20261008.json`; current product head `7eea9fcdfbf1b73c6cf5cabae3b2f8f1495bbae5` unchanged, MAJOR recovery finding remains OPEN, full recovery scope retained, NOT READY / NOT DELIVERED.


### F2 post-purchase latest main integrated validation 20261008

Root-owned original task integrates main aba65b4e, preserving credit and commission snapshot contracts. 142 models / 96 migrations; exact source sha256:e384408012faa06cee5d5d1a6ceecce24d86ce73c82b162a2f0fd30bffad776e passed 48 DB, 177 unit, 1 actual synthetic browser, zero skip/flaky and cleanup PASS. TypeScript, strict-index, scoped lint and inventory unit PASS; fresh 1067 Node TAP PASS zero skip. Evidence `remaining-capabilities-f2-post-purchase-main-integrated-20261008.json`. Review remains 3/4 with current-source review not executed; issued PayUni recovery MAJOR remains OPEN, no external recovery success claimed. Canonical NOT READY, NOT DELIVERED; full scope retained.
