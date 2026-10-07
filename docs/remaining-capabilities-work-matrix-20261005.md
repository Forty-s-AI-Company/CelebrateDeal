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

### F2.2 current main integration 2026-10-07

Same task f2-commission-policy, root sole writer. Original dirty checkpoint worktree preserved; clean isolated integration includes main c72b5089. Complete 133 model / 88 migration inventory; 61 DB refund/commission regressions + 1 actual merchant browser + 142 unit + 5 inventory Vitest + 12 migration TAP, TypeScript/lint PASS; zero skip/flaky, cleanup PASS. Evidence: `remaining-capabilities-f2.2-main-integrated-browser-20261007.json`. Latest independent review and exact new-head CI pending; canonical NOT_READY, no delivery. Dispatch count is unchanged.
### F1.2 current main integration 2026-10-07

Root integrated c72b5089 into existing community branch; 129 models / 88 migrations, 9 DB + 1 actual browser + 22 unit/API + 5 inventory Vitest + 12 migration TAP PASS; TypeScript/lint PASS, zero skip/flaky, cleanup PASS. Fresh proof: `remaining-capabilities-f1.2-current-main-browser-20261007.json`. Original task dispatch4/4; extra independent review pending authorization. Canonical NOT_READY; exact new-head CI pending; no protected merge yet. All historical evidence retained.

F1.2 current-head CI37616047757 failed at WP-88 exact inventory after main integration: actual91 pages/52 manager vs old90/51. Full inventory corrected without deleting assertions/cases. New isolated complete WP-88 guard matrix browser + 88 migrations/9 DB PASS, zero skip/flaky, cleanup PASS; lint PASS. Receipt `remaining-capabilities-f1.2-main-guard-browser-pass-20261007.json`; new exact head CI and independent review still required.

Commission integration with delivered community a5964d83: 136 models and 89 canonical forward migrations. Both community and immutable merchant-affiliate snapshot migrations retained. Updated exact inventory assertions without exclusions or reduced checks; fresh validation pending.
