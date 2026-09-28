# CelebrateDeal 固定 staging 現況

更新：2026-09-28（Asia/Taipei）。只把對應部署來源的受保護收據標為 PASS。指定站點：[固定 staging](https://celebrate-deal-staging.carry-digital-nomad.in.net)。

## 來源

本次核對的 master：`5f250e41d619c704514ef8939b0b0cac6a1c565a`（#344）。#338–#344 均已經受保護 PR 合入。#344 的 CI 36378202130、36378222859 完整通過；CI 通過不能替代固定站驗收。

固定站 Preview 分支 `codex/staging-release-20260926` 的来源仍為 `29ba9f6a6f389227df85e3fd46b693e6fe523331`，immutable host：`celebrate-deal-staging-3cen4xz0d-a25814740s-projects.vercel.app`，GitHub Deployment `6701426702`。#342／#343 修改 runner 與文件，未改部署中的應用程式；受保護 runner 已用新版 master 對上述固定來源診斷。

staging Functions 已由 iad1 調整至 hnd1，與 staging Supabase Tokyo（ap-northeast-1）同區。新版瀏覽器完整通過，支持跨區延遲是先前 Dashboard 逾時的重要因素；不代表所有路徑效能都已驗證。未部署 Production。

## 驗收表

| 範圍 | 狀態 | 證據與界線 |
| --- | --- | --- |
| 固定 alias／部署來源 | **PASS：來源綁定** | 下列最新診斷核對 `29ba9f6a`，lineage／alias 均 VERIFIED |
| Dashboard、商品、方案核心瀏覽器旅程 | **PASS：目前來源** | [36371696707](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371696707)：desktop/mobile 各五頁、導覽及 hydration 互動通過。Dashboard KPI 與明細可見、明細 GET 2xx 完成，0 頁面錯誤／同站 5xx／關鍵資源失敗／不安全請求，session 已撤銷 |
| Funnel 核心旅程 | **BLOCKED：公開頁 404、合成專案草稿** | [36375771768](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36375771768) 建立、模板、編輯、儲存與 Funnel 發布成功。最新[唯讀診斷 36377871155](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36377871155) 為 publicSurface=NOT_FOUND、syntheticProjectStatus=DRAFT；HTTP 200 是串流回應，不能當內容成功。公開頁要求所屬專案 published。此次未建立／修改 Funnel，付款／退款／寄信均 0，session 已撤銷；mobile 尚未驗證 |
| R2 staging 上傳及公開讀取 | **PASS：目前來源** | [36371701629](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371701629)：預簽、PUT、完成回報與公開 GET 各一次，bucket／r2.dev VERIFIED，0 錯誤／不安全請求。公開 bucket 限合成測試資料 |
| Stream 非正式資源範圍 | **未驗證** | [36218278700](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36218278700) 僅證明唯讀連線可用，nonProductionScope=unverified。R2 PASS 不涵蓋 Stream |
| PayUni 新版 Sandbox 訂單閉環 | **BLOCKED：舊交易結果不明** | 原提交 [36217020374](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36217020374)。[唯讀 36260940732](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36260940732)：本地 PENDING、provider UNKNOWN、callback NOT_OBSERVED、PROVIDER_MISSING、queryAttempts=0。官方 Sandbox 已登入並以精確合成訂單查詢，回報尚無資料；仍待 authenticated API 觀察；未重送或退款，也未開始新付款 |
| 付款方式綁定能力 | **程式缺口；即時資料未驗證** | master 的 PayUni adapter 沒有 createPaymentMethodSetupSession／verifyPaymentMethodSetupSignature／normalizePaymentMethodSetupPayload；綁定 action 會判定 provider_setup_unsupported。專案發布要求有效 verified PaymentMethodReference。9 月 28 日 staging 唯讀 SQL 已確認合成 vendor 有效 verified reference 為 0；必須補足 provider 真實能力，不能偽造 verified reference 或移除驗證 |
| 舊 PR #210／#211 功能 | **尚未整合** | 學員入口、LINE 圖文選單、聯盟入口等依[整合清單](integration-inventory-20260924.md)分批處理，不直接覆蓋 master |
| Production | **未評定** | 未執行正式部署、正式付款／退款或正式資料操作 |

## 完成條件

9 月 28 日登入後新證據：官方 Sandbox 精確訂單查詢仍「尚無資料」，staging 原合成交易仍 pending 且無 provider reference；未重送或退款。Funnel 草稿專案的有效商品連結、active 表單、直播／諮詢、有效 verified payment method 都為 0。這些為[唯讀後台／SQL 觀察](sandbox-readonly-reconciliation-20260928.md)，不是新的受保護煙測 PASS。唯讀查單程式修復仍待合入、部署與外部驗證。

`CORE_STAGING_READY` 尚未成立。完整固定站核心旅程、Funnel 公開 desktop/mobile、新版 Sandbox 成功付款→callback→持久化訂單→重複 callback 冪等性，以及 provider 非正式資源範圍均需實際證據。文件更新或 CI 綠燈不能代替驗收。下一步見 [NEXT-CYCLE.md](NEXT-CYCLE.md)。
