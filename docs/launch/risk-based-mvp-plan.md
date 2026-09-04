# CelebrateDeal 全站 Risk-Based MVP Goal

## 1. 目標與已確認範圍

完成「可小規模上線、等待 Production 核准」的版本，不以所有歷史 WP 或 evidence 文件完成為終點。

本次核心：

- 商家人工邀請、登入、MFA、商品／直播建立。
- 買家報名、觀看、下單、付款、交付、查單、退款與客服。
- CelebrateDeal 向商家收取固定 SaaS 方案費用。
- 商家結算、平台費、退款帳務與租戶隔離。

首發不啟用：

- 用量帳單收費：額度用完阻擋新增用量、提示升級；查單、退款與客服仍可用。
- 聯盟推廣與團隊佣金：停用入口及新增佣金機制，保留既有資料，不刪帳、不隱藏既有負債。
- 新金流、新行銷平台、通用工作流引擎及非核心功能重設計。

Production 部署、正式交易及正式環境操作不在本次自動執行範圍。

## 2. 版本基準與全站重新盤點

以使用者選定的 `codex/one-stop-webinar-flow` 為基準。目前查核：

- HEAD：`54d52b62616b70ec40e7f11ca0a265f9e46ce691`，工作樹乾淨。
- 最新 CI `33850245516`：失敗於 Production dependency audit。
- Remote `master`：`431e4f53df36bcf54f5fdc911175e9e10354f5f3`。
- 兩邊存在產品、安全與測試差異；不能直接套用另一 worktree 的通過紀錄。
- Goal API 回傳 `null`。執行階段先重新確認；存在 Goal 就延續，不存在才建立本計畫的唯一 Goal。

先建立一份精簡功能矩陣，逐段檢查：

```text
商家邀請 → 登入／MFA → 建立商品／直播
→ 買家報名／觀看 → checkout → 付款回呼
→ 訂單／交付／通知 → 退款／對帳／客服／商家結算

商家選方案 → pending subscription → 付款回呼
→ 啟用方案／額度 → 到期／退款／降級與超限處理
```

每項記錄實際測試或操作證據、缺口、風險、下一步，使用 `PASS／FAIL／PARTIAL／NOT_PROVEN／PENDING_EXTERNAL／PENDING_HUMAN`。程式、測試名稱及舊報告存在不等於 PASS。

比較工作分支與 master 時，只移植確實修復核心風險的變更；不整批覆蓋、不自動恢復所有歷史 WP4 工具。

## 3. 執行順序與最小修正

### P0：修復發布基準

- 定位目前 dependency audit 的實際套件與依賴路徑，不預設仍為 `fast-uri`。
- 做最小安全更新，不忽略 High／Critical、不放寬門檻。
- 重新驗證認證、金流、webhook、配額及 runner 差異；補回必要修正與回歸測試。
- 確保 push／merge 不會自動觸發 Production deployment。

### P1：完成兩條商業主流程

- 修正阻斷商家建立內容、買家購買及購後交付的實際問題。
- 固定 SaaS 方案只能由可信付款結果啟用；退款、到期、重複 callback 不得錯增額度。
- 用量收費與佣金停用必須由伺服器執行，不能只藏 UI；直接 URL、API、排程與 webhook 都要遵守。
- 不預設新增公開 API 或資料庫 schema；优先沿用既有介面。若必要變更涉及 migration，另列風險與核准點。

### P2：關閉 PayUni 付款、退款與對帳

- 先取得固定、去敏的錯誤分類，區分回應解析失敗、provider 尚未確認、訂單映射或本地退款保留狀態問題。
- 未取得官方語意與可驗證回應前，不將 `RefundStatus=8` 等未知值直接判成退款成功。
- 優先使用既有 Sandbox 交易查核與恢復；不得重送退款來掩蓋不明結果。
- 透過 protected default branch 的固定 secure task 執行；不新增通用 runner／validator 層。
- 商品與 SaaS 各完成可信 payment → callback → paid state → refund → reconciliation。
- 每輪先記錄固定操作上限；超時或結果不明即停止該交易的付款／退款重送，改查詢診斷。

### P3：最小營運與復原準備

- 核心直播／內容交付需要 Cloudflare、必要通知需要 Resend；僅驗證首發實際使用能力。
- 驗證 health、Sentry 錯誤告警、durable rate limit、備份／隔離還原與部署復原路徑。
- 舊證據依程式、schema、設定影響評估可重用性；不因 SHA 改變就重跑所有 provider，但必須註明證據適用範圍。
- 完成商家款項／平台費結算操作、買家與 SaaS 退款規則、隱私／保留政策及客服責任確認；人工決策不能由代理代簽。
- Production 設定與部署列成獨立 launch checklist，未驗證的正式環境項目明確保留。

## 4. AI Team 與驗收

主代理直接規劃、修正、驗證與整合；代理只負責可並行的明確範圍：

- 產品線：商家、買家、SaaS 操作流程。
- 安全線：付款退款、tenant、Auth／MFA、Secret 與環境隔離。
- 驗證線：核心 Browser、CI 與必要復原證據。

一般修改不強制多代理複審；金流、安全與 migration 依核准的審查降級鏈處理，工具不可用就如實記錄。

必要驗收：

- dependency audit、lint、typecheck、strict index、build 與既有必要 CI gate 通過。
- 核心付款退款、帳務、tenant、Auth／MFA 測試通過，不降低 assertion、不 skip。
- 核心 Browser 涵蓋桌機／行動版登入、商家建商品、直播購買、付款結果、交付、客服及 SaaS 方案。
- 驗證重複／亂序 callback、金額不符、跨 tenant、退款不明、重複及超額退款拒絕。
- 驗證停用收費／佣金不可被直接呼叫繞過，超限不影響購後服務。
- Sandbox 實際結果與站內狀態一致；local／mock 不取代 provider 證據。

## 5. 完成定義與進度管理

交付一份功能矩陣、一份核心 blocker 清單及一份發布摘要，不新增多層治理文件。

完成條件：

- 本次首發範圍的核心功能與安全硬阻擋為零。
- Exact RC CI 與核心測試通過。
- 商品及 SaaS Sandbox 付款／退款／對帳通過。
- 必要交付、監控、復原與營運責任準備完成。
- Production 待核准／待驗證事項逐項列清楚。

符合後標記 `MVP_RELEASE_CANDIDATE_READY=true`；不把 staging 通過誤報成 `PRODUCTION_READY=true`。實際正式環境未核准及驗證前，正式販售仍為 `NO_GO`。

後續改善另列 `POST_LAUNCH_HARDENING_PENDING`，不得只因治理文件不完整阻擋本次交付。

每個 checkpoint 回報完成項、剩餘核心 blocker、實際驗證與下一步。同一失敗沒有新證據就更換診斷方式，不反覆重跑。先完成基準盤點再估算剩餘時間，不再承諾未經查核的三小時完工期限。
