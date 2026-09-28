# CelebrateDeal 固定 staging 現況

更新：2026-09-29（Asia/Taipei）。只把對應部署來源的受保護收據標為 PASS。指定站點：[固定 staging](https://celebrate-deal-staging.carry-digital-nomad.in.net)。

## 來源

本次核對的 master：`14e23f8e483c021390f5df22ca519c8068ee9b6a`（#348）。#348 已受保護合入；應用來源未變。#347 的 CI 36413628758、36413633208 完整通過，新增不退款的新 Sandbox 訂單閉環 runner；#346 已新增切換前 immutable Preview 驗證。應用程式來源仍是 #345 的 `5d5b814681525427ae8f787a75b7ef27fa64ed29`；後續只改 runner、工作流程與文件。

固定站已切至新版 Preview：`codex/staging-release-20260928`，source `5d5b814681525427ae8f787a75b7ef27fa64ed29`，host `celebrate-deal-staging-g1b7eu9um-a25814740s-projects.vercel.app`，Vercel `dpl_HkdbLiibYXna3ewGGhGyPBbxYeCb`，GitHub Deployment `6707080026`（Preview／非 Production／READY）。切換前受保護 run 36409855420 的 immutable_preview 收據 PASS，桌面／手機各五頁、導覽、hydration、Dashboard KPI 與明細均通過，0 關鍵資源失敗。既有登入的 Vercel CLI 已成功指派指定 alias；固定網址 run 36410155519 亦已 PASS，lineage／alias VERIFIED，桌面／手機核心旅程、Dashboard 資料與互動正常，兩個 session 均已撤銷。

保留的舊版回復點：`codex/staging-release-20260926`，source `29ba9f6a6f389227df85e3fd46b693e6fe523331`，host `celebrate-deal-staging-3cen4xz0d-a25814740s-projects.vercel.app`，GitHub Deployment `6701426702`。舊版收據僅描述舊來源。

staging Functions 已由 iad1 調整至 hnd1，與 staging Supabase Tokyo（ap-northeast-1）同區。新版瀏覽器完整通過，支持跨區延遲是先前 Dashboard 逾時的重要因素；不代表所有路徑效能都已驗證。未部署 Production。

## 驗收表

| 範圍 | 狀態 | 證據與界線 |
| --- | --- | --- |
| 固定 alias／部署來源 | **PASS：新版來源綁定** | 指定 alias 已指向 `5d5b8146`；[36410155519](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36410155519) lineage／alias VERIFIED |
| Dashboard、商品、方案核心瀏覽器旅程 | **PASS：新版固定網址及 immutable Preview** | 固定網址[36410155519](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36410155519)與切換前[36409855420](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36409855420)：desktop/mobile 各五頁、導覽及 hydration 互動通過。Dashboard KPI 與明細可見、明細 GET 2xx 完成，0 頁面錯誤／同站 5xx／關鍵資源失敗／不安全請求，兩個 session 已撤銷 |
| Funnel 核心旅程 | **BLOCKED：公開頁 404、合成專案草稿** | [36375771768](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36375771768) 建立、模板、編輯、儲存與 Funnel 發布成功。最新[唯讀診斷 36377871155](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36377871155) 為 publicSurface=NOT_FOUND、syntheticProjectStatus=DRAFT；HTTP 200 是串流回應，不能當內容成功。公開頁要求所屬專案 published。此次未建立／修改 Funnel，付款／退款／寄信均 0，session 已撤銷；mobile 尚未驗證 |
| R2 staging 上傳及公開讀取 | **PASS：新版固定網址** | [36410321901](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36410321901)：source 5d5b8146、lineage／alias／bucket／r2.dev 均 VERIFIED；預簽、PUT、完成回報與公開 GET 各一次，0 瀏覽器錯誤／不安全請求，session 已撤銷。公開 bucket 限合成測試資料 |
| Stream 非正式資源範圍 | **未驗證** | [36218278700](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36218278700) 僅證明唯讀連線可用，nonProductionScope=unverified。R2 PASS 不涵蓋 Stream |
| PayUni 新版 Sandbox 訂單閉環 | **PASS：獨立新合成訂單** | [36416149015](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36416149015)：source 5d5b8146，單次付款、signed Return callback、paid transaction／order 持久化與一次重複 callback 冪等性均通過。browserPaymentSubmissions=1、payments=1、callbackReplays=1、orderProofPosts=2；退款／退款對帳皆 0。詳見[收據](sandbox-payment-receipt-20260928.md)。舊未明交易未重送、未退款；本次不代表綁卡能力通過 |
| 付款方式綁定能力 | **程式缺口；合成帳戶有效 reference 為 0** | master 的 PayUni adapter 沒有 createPaymentMethodSetupSession／verifyPaymentMethodSetupSignature／normalizePaymentMethodSetupPayload；綁定 action 會判定 provider_setup_unsupported。專案發布要求有效 verified PaymentMethodReference。9 月 28 日 staging 唯讀 SQL 已確認合成 vendor 有效 verified reference 為 0；必須補足 provider 真實能力，不能偽造 verified reference 或移除驗證 |
| 舊 PR #210／#211 功能 | **尚未整合** | 學員入口、LINE 圖文選單、聯盟入口等依[整合清單](integration-inventory-20260924.md)分批處理，不直接覆蓋 master |
| Production | **未評定** | 未執行正式部署、正式付款／退款或正式資料操作 |

## 9 月 29 日接續核對

Chrome 公開文件自動點選與 Git worktree 寫入已恢復。官方 UPP／Token 契約確認需要首次交易、持卡人同意、CreditHash 與功能／IP 核准；使用者確認核准狀態不確定／尚未申請。另發現現有 setup action 不支援 form_post，不能只補 adapter。[官方契約及申請待辦](payuni-token-contract-20260929.md)。Stream 單一合成資源 runner 為本機候選，未取得實際執行收據；帳戶／憑證隔離保持未驗證。

## 完成條件

9 月 28 日登入後新證據：官方 Sandbox 精確訂單查詢「尚無資料」，新版 authenticated API 亦查無該訂單；staging 原合成交易仍 pending 且無 provider reference，未重送或退款。Funnel 草稿專案的有效商品連結、active 表單、直播／諮詢、有效 verified payment method 都為 0。[唯讀後台／SQL 觀察](sandbox-readonly-reconciliation-20260928.md)與[新版受保護查單收據](sandbox-query-receipt-20260928.md)分開保存，均不能代替付款閉環 PASS。

`CORE_STAGING_READY` 尚未成立。新版固定站核心旅程、R2 與新版 Sandbox 成功付款→callback→持久化訂單→重複 callback 冪等性已有 PASS 收據；Funnel 公開 desktop/mobile 與 Stream 非正式資源範圍仍缺實際證據。文件更新或 CI 綠燈不能代替驗收。下一步見 [NEXT-CYCLE.md](NEXT-CYCLE.md)。
