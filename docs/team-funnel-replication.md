# 團隊展業漏斗複製：架構與權限基線

> 狀態：規劃基線（2026-07-17）。本文件依目前已追蹤的程式、文件、Prisma schema、測試與 CI 整理；它不是功能完成宣告，也不改變現有行為。除非另有標示，A/B 是本 Epic 要落實的目標權限模型，而不是現行系統已提供的角色。

## 範圍與判讀原則

- **現況**只描述已存在於程式碼的行為，並附上實際路徑。
- **目標**描述團隊展業 Epic 所需的責任、權限及同步契約；尚未實作的項目一律標示為「未完成／待實作」。
- 本文件中的「歸屬」是指展業成員、名單、轉換與佣金的業務歸因，不等同目前 `Vendor` 的資料庫外鍵。

## 已完成：現有架構與可重用能力

### 租戶、登入與既有成員

| 能力 | 現況與證據 | 可重用範圍 |
| --- | --- | --- |
| 租戶邊界 | `Vendor` 是資料擁有者；直播、商品、表單、分析、聯盟、金流與稽核紀錄均以 `vendorId` 關聯。見 `prisma/schema.prisma`。 | 團隊資料必須保持在單一 `Vendor` 邊界內，所有讀寫都以該邊界過濾。 |
| 使用者與成員 | `User` 可透過 `VendorMember` 加入商家；唯一鍵為 `[vendorId, userId]`，有 `role`、`status`、`deactivatedAt`。見 `prisma/schema.prisma`。 | 可作為登入身分、停用狀態與團隊成員帳號的基底。 |
| 工作階段與選取租戶 | `UserSession` 保留 `userId`、可選 `vendorId`、撤銷與 MFA 驗證時間；`getCurrentAuth()` 只挑選 active membership。見 `src/lib/auth.ts`。 | 可沿用於每次 A/B 請求解析 actor、選定租戶與拒絕 inactive 成員。 |
| 成員生命週期 | `createVendorMemberAction` 僅限 owner；`deactivateVendorMemberAction` 會停用 membership、撤銷該租戶 session，且保留至少一名 active owner。見 `src/app/actions.ts`；管理頁見 `src/app/(app)/settings/security/page.tsx`。 | 可用於 A/B 的邀請、啟用、停用流程，但尚不能表達 A→B 隸屬關係。 |
| 既有角色 | 可輸入的商家角色只有 `owner`、`admin`、`accountant`；平台角色為 `platform_admin`。見 `src/app/actions.ts`、`src/lib/auth.ts`。 | 可作為 A/B 新角色設計的外層治理角色，不能直接當成 A/B。 |
| 高風險操作門檻 | 財務操作使用 `requireFinanceAdmin()`，接受 owner/admin/accountant 或 platform_admin，並對該範圍要求 MFA；成員管理使用 `requireVendorOwner()`。見 `src/lib/auth.ts`。 | A/B 若觸及佣金、調整或結算，應沿用「明確 guard + MFA + 稽核」模式。 |
| CSRF、同源與限流 | Server Action 先執行 `assertServerActionSecurity()`；公開 POST API 使用同源檢查與 async rate limit。見 `src/lib/csrf.ts`、`src/lib/api-security.ts`、`src/lib/rate-limit.ts`。 | 團隊邀請、歸屬調整、佣金核准及同步寫入可重用這些防線。 |
| 稽核 | `AuditLog` 記錄 actor、動作、目標、前後快照、IP 與 user agent；成員與財務動作已呼叫 `writeAuditLog()`。見 `prisma/schema.prisma`、`src/lib/audit.ts`、`src/app/actions.ts`。 | 可作為 A/B 權限變更、歸屬轉移、覆寫與同步失敗的不可否認紀錄。 |

### 展業漏斗、歸因與營運資料

| 漏斗環節 | 現況與證據 | 可重用範圍與限制 |
| --- | --- | --- |
| 公開直播與內容 | `Live` 綁定商品、表單、訊息模板與互動腳本；公開頁在 `src/app/live/[slug]/page.tsx`，後台頁在 `src/app/(app)/lives/`。 | B 的分享入口可沿用公開直播與既有 `ref` 參數，但現有 `Live` 沒有 team/member owner。 |
| 名單收集 | `POST /api/form-submissions` 建立 `FormSubmission`，會驗證 form/live 的 vendor 關係、檢查 blacklist；有 live 時另寫 `lead_submit` 分析事件。見 `src/app/api/form-submissions/route.ts`。 | 可承接「B 帶入名單」的來源事件；目前沒有保存 B、team 或歸屬決策。 |
| 行為分析 | `POST /api/analytics` 寫入 `AnalyticsEvent`，以 vendor/live 驗證關聯；`src/lib/analytics-funnel.ts` 已計算觀看、商品點擊、CTA 與名單漏斗。 | 可作為團隊／個人儀表板的原始事件來源；目前事件 payload 非固定的團隊歸屬 schema。 |
| 聯盟推廣碼 | `Affiliate` 屬於 vendor，擁有唯一 `code`、來源、啟用狀態與佣金比；`AffiliateClick` 保存 referral code、visitor、landing path、live 及 convertedAt。見 `prisma/schema.prisma`、`src/app/(app)/affiliates/`。 | 可作為 B 對外分享碼與點擊記錄的基礎；Affiliate 不是 User/VendorMember，沒有登入、A 屬主或階層。 |
| 點擊與表單歸因 | `POST /api/affiliate-clicks` 以有效 vendor/live/code 寫入 click；表單 API 若收到 referral code，會將同 vendor、同 code、未轉換的 click 全部標記 converted。見 `src/app/api/affiliate-clicks/route.ts`、`src/app/api/form-submissions/route.ts`。 | 已有 referral → lead 的訊號，**不是**單一 lead 的決定性歸因，也沒有 A/B 歸屬快照。 |
| 成交與佣金 | payment webhook 處理 referral code 時會建立 `AffiliateCommission`；佣金、payout 與結算模型已存在。見 `src/lib/payment-webhooks.ts`、`prisma/schema.prisma`、`src/lib/payment-webhooks.test.ts`。 | 可重用為「已付款成交」的下游事件；目前佣金只指向 Affiliate，沒有分給 A/B 的規則或凍結的歸屬快照。 |
| 成效呈現 | 聯盟列表顯示點擊、轉換率與佣金；直播分析頁顯示 affiliate clicks。見 `src/app/(app)/affiliates/page.tsx`、`src/app/(app)/affiliates/[id]/page.tsx`、`src/app/(app)/lives/[id]/analytics/page.tsx`。 | 可作為團隊儀表板的視覺與查詢雛形；尚無 A 看全隊、B 看自身的資料列級過濾。 |

## 現況所有權與歸屬

### 已存在的所有權

1. `Vendor` 擁有商務資料；目前所有後台頁透過 `requireVendor()` 取得選定租戶，再以 `vendorId` 查詢。例如 `src/app/(app)/affiliates/page.tsx` 與 `src/app/(app)/lives/[id]/analytics/page.tsx`。
2. `User` 是登入主體，`VendorMember` 是該租戶內的工作權限主體；停用 membership 後不再能被 `getCurrentAuth()` 選為有效租戶。
3. `Affiliate` 是 vendor 的推廣合作對象，不是登入帳號，也不具現有的成員角色或資料可見範圍。
4. `FormSubmission` 只歸屬 form（及可選 live）；`AnalyticsEvent` 只歸屬 vendor/live；`AffiliateCommission` 只歸屬 vendor/affiliate。這些模型都沒有 A、B、team 或 owner membership 欄位。

### 未完成：團隊歸屬契約

以下是 Epic 所需、但目前程式碼沒有的歸屬規則，應在實作前成為可測試的產品契約：

- 一個 B 必須在單一 `Vendor` 中有明確的 A 歸屬及有效期間；同一時間是否可有多個 A，必須由產品決策明定。
- 名單、click、成交、佣金必須記錄「歸屬決策當下」的 A/B/team 快照與來源事件，不能只依目前成員關係回推，避免轉組後改寫歷史成效。
- 一筆資料的可見性由其 snapshot 與 actor 的有效 membership 決定；跨 `Vendor` 一律不可讀寫或查詢聚合。
- 被停用的 B 不應再取得新名單或發出新分享連結；歷史資料是否仍計入 A 的報表、是否可改派，必須有明確 policy 與 audit event。

## A/B 權限基線

### 既有實作的授權事實

| 範圍 | 已實作的判斷 | 重要限制 |
| --- | --- | --- |
| 一般商家後台 | 多數內容與 affiliate Server Action 只使用 `requireVendor()`。見 `src/app/actions.ts`。 | owner/admin/accountant 目前沒有按功能分級；它們都可能在選定 vendor 範圍操作一般內容。 |
| 商家成員管理 | 只允許 `requireVendorOwner()`。 | 這是唯一明確的 owner-only 成員管理。 |
| 財務、結算、payout、退款與 webhook 操作 | `requireFinanceAdmin()`；角色為 owner/admin/accountant 或 platform_admin，並強制 MFA。 | 這不是 A/B 模型；accountant 的財務權限現有範圍很高。 |
| 平台後台 | `User.platformRole === "platform_admin"`。 | 與商家 membership 分離，且不得加入商家成員清單。 |

### 目標 A/B 權限矩陣（待實作）

本矩陣將 A 定義為「團隊主管／展業帶領者」、B 定義為「受 A 歸屬管理的展業成員」。這是為了使 Epic 可落實的基線命名；它不是現有 `owner`、`admin`、`accountant` 的同義詞。

| 能力 | A（團隊主管） | B（展業成員） | 現況 |
| --- | --- | --- | --- |
| 查看個人漏斗、名單、分享碼與佣金 | 可查看自己及有效 B 的聚合與明細，依資料遮罩 policy | 只可查看自己的資料 | 未實作資料列級過濾。 |
| 建立／停用 B 與設定 A→B 歸屬 | 可在 vendor policy 授權範圍操作；每次變更需稽核 | 不可 | 現有只有 owner 能管理 `VendorMember`，也沒有 A→B 關係。 |
| 建立或更新個人分享碼 | 可管理自己及受管 B 的碼，且不可越過 vendor | 只能管理自己的碼 | 現有 Affiliate 由任一 `requireVendor()` actor 可建立或更新。 |
| 讀取與處理名單 | 只讀有效 B 的授權範圍；轉派需明確權限與稽核 | 只讀／處理自己被歸屬的名單 | `FormSubmission` 尚無 A/B 歸屬、指派或資料遮罩。 |
| 內容、商品、直播與品牌設定 | 依另行定義的 vendor 內容角色；不由 A/B 自動取得 | 預設不得修改共享商家資產 | 目前一般內容僅有 vendor guard，尚未分級。 |
| 佣金規則、結算、付款與調整 | 不因 A 身分自動取得；必須再通過現有 finance/MFA policy | 不可 | 現有 finance roles 與 A/B 未連結。 |
| 跨團隊／跨租戶資料 | 不可 | 不可 | vendor scope 已存在，但團隊 scope 未實作。 |

### 權限實作不變量（待實作）

- 每個 A/B 受保護端點先解析 session、active membership、vendor scope，再判斷 A/B 關係與資料 snapshot；不可只信任 client 傳來的 team、member 或 referral code。
- 寫入端點要以資料庫查詢條件同時約束資源 id、`vendorId` 與授權歸屬；清單、明細、下載與統計都使用相同 scope helper。
- 降權、停用、轉組、歸屬覆寫與佣金調整要保留 before/after、actor、原因與時間；高風險財務操作繼續採用 MFA。
- A/B 名稱、預設資料範圍、名單可見欄位與轉派權限須經產品確認後固定為 enum/政策，不以任意字串或 UI 隱藏作為授權。

## 同步與歸因規則

### 已完成：目前事件鏈

```text
公開直播 ?ref=CODE
  -> /api/affiliate-clicks -> AffiliateClick
  -> /api/form-submissions -> FormSubmission + AnalyticsEvent(lead_submit)
                             + matching AffiliateClick.convertedAt
付款 provider webhook
  -> PaymentTransaction + AffiliateCommission(referralCode)
```

此鏈路可驗證 vendor/live/code 是否存在、為公開 POST 施加同源與限流，並對 webhook 以 provider event id 去重（見 `src/app/api/affiliate-clicks/route.ts`、`src/app/api/form-submissions/route.ts`、`src/lib/payment-webhooks.ts`、`prisma/schema.prisma`）。

### 未完成：A/B 同步契約

| 規則 | 目標行為 | 現況缺口 |
| --- | --- | --- |
| 唯一事件 | 每個 click、lead、paid/refund 事件有可重送的唯一來源識別；重送不重複計數、佣金或通知。 | click 與 form 沒有可供去重的來源 id；webhook 只有 provider event id 去重。 |
| 歸屬快照 | 首次符合歸因 policy 時寫入 A/B/team、分享碼、來源與時間；後續事件沿用該 snapshot。 | 現有表只有 referralCode 或 Affiliate 關聯。 |
| 來源優先序 | 明定 referral、既有 lead owner、手動覆寫、直接流量的優先序與有效期；衝突時輸出可稽核結果。 | 沒有 owner、有效期或衝突處理。 |
| 同步方向 | 將 click → lead → paid/refund 視為 append-only 領域事件；讀模型（A 全隊、B 個人、營運）從同一來源聚合。 | 現有資料為各表直接寫入，沒有團隊事件或 read model。 |
| 失敗處理 | 外部付款事件可安全重送；內部處理失敗可觀測、可重試且不跨 vendor。 | webhook 有 retry；表單／點擊／團隊同步尚無同類機制。 |
| 更正與轉派 | 只能由具權限者提出具原因的覆寫；歷史與新事件的影響範圍需明確，且寫 audit。 | 未實作。 |

## 分階段實作基線

| 階段 | 交付目標 | 完成判定 |
| --- | --- | --- |
| 0：契約確認 | 確認 A/B 定義、同時多歸屬、歸因優先序／有效期、轉派、佣金分配、資料遮罩與保留期。 | 每一項有單一產品決策、例外處理與驗收案例；本文件更新為已核准契約。 |
| 1：授權邊界 | 建立可重用的 actor/vendor/A-B scope 判斷，並把團隊資源路由納入同一 guard。 | A 無法讀取未受管 B；B 無法讀取同儕或 A 的私有資料；跨 vendor 全數拒絕。 |
| 2：歸屬與事件 | 讓分享、lead、成交、退款使用一致的歸屬 snapshot、去重與 audit 語意。 | 重送不改變計數；轉組不改寫歷史；衝突有可查原因。 |
| 3：漏斗與工作台 | 提供 A 全隊／B 個人資料視圖、名單處理與必要的遮罩，並保留既有直播、聯盟與分析頁能力。 | 各角色只看被授權資料，數字可回溯至事件與 snapshot。 |
| 4：營運控制 | 對例外歸因、停用、權限覆寫、佣金與同步失敗提供稽核、告警與受控處理。 | 關鍵操作都有 actor/reason/before-after；高風險財務繼續符合 MFA policy。 |

本次只建立文件基線；上述任何程式、資料層或外部系統工作均**未完成**。

## 測試策略

### 已存在的保護與回歸

- `src/lib/analytics-funnel.test.ts` 驗證漏斗百分比與零觀看行為。
- `src/lib/affiliate-performance.test.ts` 驗證聯盟轉換率。
- `src/app/api/form-submissions/route.test.ts` 驗證公開表單的同源 redirect 安全性。
- `src/app/api/analytics/route.test.ts`、`src/lib/api-security.test.ts`、`src/lib/csrf.test.ts` 驗證公開 API 與 Server Action 的安全邊界。
- `src/lib/payment-webhooks.test.ts` 驗證付款事件去重、退款去重、推薦碼佣金與 retry；該測試檔會建立並清除資料庫 fixtures。
- `.github/workflows/ci.yml` 於 CI 執行 Prisma client 產生、lint、typecheck、Vitest、Playwright smoke、build 與 preflight；CI 另有隔離的 PostgreSQL service。

### 待新增的 A/B 驗收案例

| 類型 | 必測案例 |
| --- | --- |
| 權限單元測試 | A 可讀有效 B、不能讀非受管 B；B 只讀自身；inactive membership、降權、跨 vendor 與 client 偽造 scope 都被拒絕。 |
| 歸因單元測試 | referral、既有 owner、直接流量與手動覆寫依已核准優先序得出唯一歸屬；歸屬快照不被轉組回寫。 |
| 事件／整合測試 | 同一 click、lead、paid、refund 重送後無重複資料或佣金；付款 webhook 與團隊 read model 對同一 vendor 一致。 |
| 資料隔離測試 | 列表、明細、統計、匯出與錯誤回應都不得洩露另一 A、B 或 vendor 的資料。 |
| 工作流測試 | A 建立／停用 B、B 分享→lead→成交、A 查閱團隊漏斗、權限覆寫與 audit 的端對端路徑。 |
| 回歸測試 | 維持現有公開直播、表單、analytics、affiliate click、付款 webhook、CSRF、rate limit 及 MFA/finance 流程。 |

## 未完成項目總覽

- 團隊實體、A→B 隸屬、有效期間與歸屬 snapshot。
- A/B 角色的伺服端資料列級授權與 UI 對應。
- lead、click、成交、退款的唯一事件識別、統一歸因 policy 與可重放同步。
- A 全隊／B 個人漏斗、名單工作台、資料遮罩及轉派流程。
- A/B 佣金分配、覆寫、結算關係與完整稽核／可觀測性。
- 上述團隊行為的自動化測試與 CI 驗收。

## 證據索引

- 專案與驗證邊界：`README.md`、`package.json`、`.github/workflows/ci.yml`。
- 資料模型：`prisma/schema.prisma`。
- 認證與授權：`src/lib/auth.ts`、`src/app/actions.ts`、`src/app/(app)/settings/security/page.tsx`。
- 公開漏斗與歸因：`src/app/api/affiliate-clicks/route.ts`、`src/app/api/form-submissions/route.ts`、`src/app/api/analytics/route.ts`、`src/lib/payment-webhooks.ts`。
- 現有營運畫面：`src/app/(app)/affiliates/`、`src/app/(app)/lives/[id]/analytics/page.tsx`。
- 現有測試：`src/lib/analytics-funnel.test.ts`、`src/lib/affiliate-performance.test.ts`、`src/app/api/form-submissions/route.test.ts`、`src/lib/payment-webhooks.test.ts`。

## Policy Blockers

- 本工作流程禁止 migration、seed、部署、資料刪除、真實付款與祕密操作；本次沒有執行這些動作。
- `npm run test` 包含 `src/lib/payment-webhooks.test.ts` 的 fixture 清除，因此在本次「資料刪除禁止」約束下不執行。
