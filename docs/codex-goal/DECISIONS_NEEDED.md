# CelebrateDeal Decisions Needed

最後更新：2026-07-25 22:05（Asia/Taipei）

下列決策不阻擋其他自動化審查，但在結論確認前，對應分數不可標示 100。

## D-001 — 公開 analytics 的可信度模型

- 現況：public analytics endpoint 已有 same-origin、client marker、rate limit、strict schema 與 vendor/live 關係驗證；visitor ID 與 event type 仍由 browser 提供。
- 風險：同源惡意腳本或自動化工具可製造虛假 page view/click，污染 funnel 指標。
- 選項 A（建議）：由 server 發放短效、vendor-scoped、HttpOnly 簽章 session；event 必須帶可驗證 nonce，並對相同 event/window 去重。
- 選項 B：維持 best-effort anonymous analytics，明確標示報表是趨勢資料，不作財務、佣金或風控依據。
- 影響：A 的可信度較高，但需新增 cookie/session、去重與 browser regression；B 成本低，但報表不能作正式對帳證據。
- 目前判定：Needs Decision；現有 payment/commission 不依賴此事件，因此不是付款 P0。

## D-002 — 公開 referral link 的證明強度

- 現況：首次 click 允許合法 query/legacy referral code；source page 會參考 same-origin Referer，後續 checkout 則要求 server-issued signed attribution cookie。
- 風險：使用者可自行開啟合法推薦連結製造 click；這可能是聯盟行銷的預期語意，也可能與產品期待的「可信來源頁造訪」不同。
- 選項 A（建議）：保留公開推薦連結語意，但只有 signed attribution cookie 能影響 lead/payment；click 報表標示為 best-effort。
- 選項 B：landing page 先發短效 nonce，再允許建立 attribution click；提高可信度但會增加 redirect 與 cookie 複雜度。
- 目前判定：Needs Decision；不得僅依 Referer 把 click 當成財務級證據。

## D-003 — 公開夥伴聯絡 Email

- 現況：公開夥伴頁直接使用帳號 Email 作為聯絡資訊。
- 風險：帳號用途與公開聯絡用途可能不同，並可能遭到 harvesting。
- 選項 A（建議）：新增獨立 `publicContactEmail` 與明確 opt-in；未設定時使用站內聯絡表單或不顯示。
- 選項 B：遮罩 Email 並透過站內 relay/contact form 聯繫。
- 選項 C：保留現況，但 onboarding 必須取得明確公開同意並允許隨時撤回。
- 目前判定：Needs Decision；在決策前不擅自移除既有 UI。

## D-004 — 商家 finance role 強制 MFA 的時程

- 現況：platform admin 進 `/admin/**` 已強制 MFA；owner/admin/accountant 可自行啟用，但 vendor routes 尚未強制。
- 規格差異：`CELEBRATEDEAL_PLAN.md` 寫「平台與財務權限強制 MFA」；`admin-mfa-hardening-plan.md` 的 MVP Phase B 只強制 platform admin，並把商家強制 MFA 放在 100 個付費商家後。
- 選項 A：正式收費前即對 vendor billing 與 owner security actions 強制 step-up MFA。
- 選項 B（符合既有 MVP 文件）：目前只強制 platform admin；在到達商家門檻前建立 rollout 日期、提醒與 recovery 支援。
- 目前判定：Needs Decision；未確認前不把所有 vendor 使用者直接鎖出系統。

## D-005 — Payment order number 的唯一命名空間

- 現況：checkout 由伺服器產生 order number；已驗簽 webhook 在沒有 vendor identifier 時，會以 `provider + orderNumber` 反查唯一交易。Schema 目前只有 `vendorId + orderNumber` index，沒有 unique constraint。
- 風險：相同 provider/order 若出現兩筆，無 vendor identifier 的 callback 只能 fail closed；若不同 provider 或 BYO merchant 可合法重用 order number，錯誤的全域 unique 又會拒絕有效交易。
- 選項 A（platform merchant 建議）：`providerName + orderNumber` 為全平台唯一，checkout 對碰撞做 bounded retry；符合 callback fallback 的實際查找語意。
- 選項 B（BYO merchant）：新增 provider account／merchant binding，唯一鍵改為 `providerAccount + orderNumber`；callback 必須先可靠解析 account scope，不能只靠 vendor/order。
- 目前判定：Needs Decision；在 merchant namespace 未定義前，不把 DB-I01 直接改成可能錯誤的 unique key。

## D-006 — Refund provider event identity

- 現況：RefundRecord 的 `providerEventId` 同時承載 webhook event ID、後台 refund request ID，以及 provider response 缺少 close/refund number 時的 trade number fallback。
- 風險：直接加入 `(paymentTransactionId, providerEventId)` unique 可阻止重複事件，但 provider 若在多次合法 partial refund 重用 trade number，也會造成 false conflict。
- 選項 A（建議）：拆分 `idempotencyKey`、`providerRefundId` 與 `providerEventId`，並對每個來源建立明確、可證明的 unique constraint。
- 選項 B：保留單欄位，但先取得 PayUni partial-refund identifier 的正式唯一性保證，再加入 nullable compound unique。
- 目前判定：Needs Decision；既有 SERIALIZABLE ledger 與 WebhookEvent `(provider,eventId)` unique 維持補償控制。

## D-007 — 商家層級的全站停權模型

- 現況：`User`、`VendorMember`、商品、報名表與直播都有個別 lifecycle；`Vendor` 本身沒有 status／suspended 欄位。公開直播已 fail closed 至 scheduled/live/replay-enabled ended，並排除停用商品與停用表單，但目前不存在可一次封鎖整個商家的正式狀態。
- 風險：若需要因合規、詐欺、欠款或營運事故立即停止某商家，逐筆停用商品／直播容易遺漏；直接以 owner 或 subscription 狀態代替，又可能錯誤封鎖仍有其他有效管理者的商家。
- 選項 A（建議）：新增明確 `Vendor.status` 與停權原因／時間，公開內容、checkout 與新 side effect 統一 fail closed；既有 payment callback／refund/reconciliation 仍允許完成帳務收斂。
- 選項 B：由 subscription 狀態驅動銷售資格，但需明確定義 trial、past_due、cancelled 與平台人工停權的優先序。
- 目前判定：Needs Decision；本輪不新增 schema 或自行推定 owner/subscription 等於商家停權。

## 待 Phase 5 分類

以下項目先收集證據，之後分成「客觀缺陷」、「已核准設計」或「需要產品決策」：

- 直播建立流程是否需要常駐 mobile/live preview。
- 是否提供可直接上線的直播模板與場控時間軸。
- 首次 onboarding 是否必須支援 template/import 快速路徑。

在取得使用者 journey、現有規格與 browser QA 證據前，不自行改變產品方向。
