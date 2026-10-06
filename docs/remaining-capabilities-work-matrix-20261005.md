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

## 2026-10-07 接續狀態補記

歷史行與證據保留；以下是本次實際狀態。

| ID | 精確來源／相依 | owner 與缺口 | 驗收／新證據 | 狀態 |
|---|---|---|---|---|
| F1.1 | PR370，merge `728f0e591c0a5d4a83fe98d6a98146f9d7d0d842` | root；課程批次已交付 | 已驗收 tree 與 merge tree `8cbbcc07a75af21815d57ec9b276517293fe1486` 一致 | DELIVERED |
| F2.1 | PR374，merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73` | root；affiliate portal 已交付 | 已驗收／merge tree `4f63c92d6c24e6585484912863704b3ecffd1f43` 一致 | DELIVERED |
| F1 通知 | retained `e1f38be324e349969a657be376aa1602e804c2dd`；現行課程與權益 | root 唯一 writer；email/push/SMS/WhatsApp、六個 retained event 完整範圍保留。provider、push enrollment、event producer、UI/browser 尚未完成 | `remaining-capabilities-f1-notifications-outbox-20261007.json`：86 migrations、20 PG、14 unit、12 TAP、TS/lint PASS。內部驗證 token 為合成，未聲稱外部聯絡方式或送達成功 | IMPLEMENTED_BACKEND_PHASE_NOT_READY |
| Q2 | PR379；`f989dba69361b38d764b46cb1736203109315504` CI 的兩個 Playwright 檔案被 Vitest 誤載 | root；.browser.ts 配置修正正在獨立隔離 runner 驗證；新增 review 超過4/4，等待明確增額核准 | 前一配置87 migrations／67DB／2browser PASS；新配置尚待本次收據／精確 head CI | IN_PROGRESS |
| F1.2／F2.2／F3.2 | PR373／commission branch／PR372 | 最新候選 review 上限4/4已滿，額外1次仍待核准；不能以其他批次 review 取代 | 已存在測試不代替最新候選 review | REVIEW_AUTHORIZATION_PENDING |
| F1其餘／F2其餘／F3其餘／Q1／A1／E1 | 原 work matrix 與 future-work 精確來源 | 保留完整功能及相依；Q1精確sandbox注入仍阻塞外部旅程 | 本次補記沒有縮減或轉移範圍；整體 Goal 未完成 | IN_PROGRESS |

F1 通知補記：已接上 configured-only email／Web Push／Twilio SMS／WhatsApp template adapter，24 項 mocked unit 契約 PASS，連同既有 contract/API 共36項測試；最新21項實際PG回歸與86 migrations PASS，source fence一致。此批未執行外部送達，worker/event producer/UI/browser/approved provider驗證/獨立review/gate/CI仍未完成。精確證據 `remaining-capabilities-f1-notifications-providers-20261007.json`；不宣稱 F1 READY。

### F1 通知 worker checkpoint 2026-10-07

- ID：f1-learner-notifications；來源 e1f38be324e349969a657be376aa1602e804c2dd；owner root，dispatch 0/4。
- 已實作：既有 authenticated email job 接入限定租戶與已設定渠道的通知 worker；精確 claim、最終購買權益與同意鎖定；不明 provider 結果不重送。
- 驗證：86 migrations、26 PostgreSQL 回歸、19 job/route/registry unit、TypeScript、scoped lint PASS。Provider callback 僅合成測試，沒有實際外部寄送。
- 證據：docs/remaining-capabilities-f1-notifications-worker-20261007.json，revision sha256:46c5f7fbc1fcf7fc391fd6df50dc58e0f77ac1a9bf246fdeb45b052c06d9d6f0。
- 狀態：IMPLEMENTED_WORKER_PHASE_NOT_READY；仍缺 durable challenge delivery、全部六種 event producer、UI/browser、核准非 Production provider 驗證、Critical review、canonical acceptance、精確 head CI 與 PR 交付。整體 Goal 保持 IN_PROGRESS。

- F1 notifications proof API checkpoint：POST /notifications/verify 已接上 server session、CSRF、exact challenge/session/course、strict 4KiB body 與安全 response projection；8 API + 1 registry unit、26 PG/86 migrations、lint、TypeScript PASS。證據 remaining-capabilities-f1-notifications-proof-api-20261007.json。狀態 NOT_READY，驗證碼 durable delivery、六事件 producer、UI/browser、外部 provider、review/gate/CI/交付仍未完成。

### F1 durable contact proof checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch 0/4；exact source e1f38be324e349969a657be376aa1602e804c2dd。
- Enroll API 已接上購買權益、server session/CSRF、核准租戶/provider、HTTPS origin、CAS 與同收件人/渠道跨課程 60 秒 cooldown。驗證碼加密 durable queue，輪替/過期/退款拒絕 provider；單筆 provider attempt、不明結果或 commit failure 不自動重送；回應不包含 token/contact。沿用既有 job，沒有新排程。
- 87 migrations、32 DB、44 targeted unit、12 migration contract、scoped lint、TypeScript PASS；合成 callback，實際渠道/browser 尚未執行。
- 證據：docs/remaining-capabilities-f1-notifications-durable-proof-20261007.json；revision sha256:984c302d5b8b4baddb9efdd20c0a8239330b923c1558ef25ca5d304859875827。狀態 IMPLEMENTED_DURABLE_PROOF_DELIVERY_PHASE_NOT_READY。all six retained event producers；actual settings UI and browser journeys；approved nonproduction provider injection and validation；independent Critical review；canonical acceptance；exact-head CI/protected PR delivery 尚未完成。
- Q2 PR379 head 080692a970bcadb312825eda691be63f10d7e093：PR run 37511340335 與 push run 37511330840 SUCCESS；最新修正複審需第 5 次 readonly dispatch 授權，仍未合併/READY。

### F1 通知設定實際 UI checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch 0/4；原始來源 e1f38be324e349969a657be376aa1602e804c2dd。
- 課程頁已接入 Email/SMS/WhatsApp/push 登記與驗證、明確 opt-in/opt-out；只在使用者操作時申請 push 權限，沿用既有 PWA registration；無 service worker 時顯示原因。GET/enroll 共用 public capabilities，無背景輪詢或 browser 持久化 contact/token。
- 最新 46 targeted unit、lint、TypeScript PASS；87 migrations、1/1 Chromium actual session/API/DB withdrawal+reload+CSRF+foreign course refusal，0 skip/flaky、cleanup PASS。已驗證收件 fixture 僅合成資料，未證明真實渠道送達。
- CI37516281028 在 migration inventory 85/87 不一致失敗；已更新精確87與兩個新 migration presence checks，保留歷史81 adapter拒絕規則。新增同一 CI notification DB gate，現有 release gate 保留並自動執行新browser，沒有新 workflow/skip/exclude。新精確 head CI 待推送。
- 證據 docs/remaining-capabilities-f1-notifications-settings-ui-20261007.json；revision sha256:5db95ea9455a22c75b4bb791d81b64e0659b97e2a910ef1403bab6eb65db9a37；browser source sha256:0ad58e3929a060e5ed08604a6d10fa3f684c51208c95f45677f43a70c821207e。狀態 NOT_READY。未完成：six retained event producers and applicable product/recipient contracts；full enroll/verification browser journeys with approved nonproduction providers；PWA integration and native push browser proof；post-refund durable settings navigation；independent Critical review；canonical acceptance；exact-head CI/protected PR delivery。整體 Goal IN_PROGRESS。

### F1 退款後通知管理 checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch 0/4。學員中心新增通知管理入口；bounded cursor list21/visible20，限定 server vendor/customer；既有偏好可在退款/到期後讀取及撤回，不授予課程內容或新 opt-in，未登記者仍須目前權益。
- 27 targeted unit、32 DB、87 migrations、latest1/1 actual Chromium、0 skip/flaky、cleanup、lint、TypeScript PASS。Actual browser 用 canonical refund ledger 及既有合成驗證 fixture，證明退款後取消/重載與有效 CSRF re-enable404；不代表真實退款或實際渠道送達。
- 證據 docs/remaining-capabilities-f1-notifications-refunded-settings-20261007.json；revision sha256:3f59201892bdf5fa4f06156eb4637a249548061725802981dcf889fb58110346；browser source sha256:43c63ad4263144b8072f03cbfbd9283caa801c0189b91b2021f9fc54fb7c2252。NOT_READY；six retained event producers and applicable product/recipient contracts；full enroll/verification browser journeys with approved nonproduction providers；PWA integration and native push browser proof；independent Critical review；canonical acceptance；exact-head CI/protected PR delivery 仍須完成。

### F1 通知 domain source checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。實際發布與完課同交易寫入加密 source outbox；20 recipient cursor、revision CAS、目前權益及事件前 consent 檢查；其餘四類事件未完成。
- 88 migrations、38 DB、25 source/inventory unit、9 player unit、lint及 source kernel TS PASS。通知1/1 actual Chromium/0skip/0flaky PASS早於最新 hydration correction；latest完整課程 browser及TS RUNNING。
- CI37518666624/head383466dd 在 native-course-learning63/70 首次進度/續播失敗，retry flaky 擋 gate。保留 assertion及零 flaky門檻，修正 hydration同步待實測。
- 證據 docs/remaining-capabilities-f1-notifications-source-phase-20261007.json；NOT_READY。渠道完整流程、Critical review、canonical acceptance、exact CI與 protected delivery仍待完成。

### F1 課程付款通知 source checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。Exact canonical paid transaction內依order/vendor/product/buyer hash產生payment_success；legacy無buyer hash及已刪除product無學習資源不指定收件；course purchase範圍，未宣稱通用訂單渠道全部完成。
- 最新88 migrations/40 DB/43 targeted unit/lint PASS；新增source fault rollback與foreign/repeated paid回歸。40案例第一次全PASS但舊38數量gate exit1已保留，更新精確40及receipt一致性後整個runner exit0 PASS。TS待收齊。
- fd7394c5完整course7DB/1actualbrowser/0skip/0flaky PASS，早於payment source修改；CI37522734648仍RUNNING，不可支撐新candidate。
- 證據 docs/remaining-capabilities-f1-notifications-payment-source-20261007.json；NOT_READY；未完成項目保持Goal範圍。
