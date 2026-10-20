# PR #448 審查報告：工作線 A（admin MFA、QA TOTP、PayUni TradeStatus、註冊同意）

- 分支：`codex/beta-lineA-auth-payments`（worktree `CelebrateDeal-wt-lineA`）
- 範圍：`git diff 78621ca3..HEAD`，4 個 commit：`fbd090fb`（A2 admin MFA）、`29705acc`（A1 QA TOTP）、`84f22d38`（A3 PayUni TradeStatus）、`82f09e08`（A4 註冊同意）
- 審查者：reviewer（Opus），2026-10-19；只回報 findings，沒有修改程式

## 實際執行的驗證

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 通過 |
| `npx eslint`（本 PR 變更的 .ts/.tsx/.mjs） | 通過 |
| vitest：`payuni.test.ts`、`webhooks/payments/route.test.ts`、`auth.test.ts`、`staging-qa-finance-bootstrap.test.ts`、`registration-actions.test.ts`、`payment-methods/route.test.ts`、`payuni-current-source-refund-qa.test.mjs`、`payuni-sandbox-pending-refund-consumer.test.mjs` | 8 個檔案通過（387 tests） |
| `node --test scripts/qa-finance-totp.test.mjs` | 6/6 通過（含 RFC 6238 向量） |
| `payment-webhooks.test.ts` | **未有效執行**：本機 PostgreSQL（localhost:54329）沒有啟動，48 個需要 DB 的 case 連線失敗。這不是本 PR 造成的失敗，但也不能算通過 |
| `wp4-buyer-ops.db.test.ts`、`registration-actions.db.test.ts`（新增的 DB 斷言） | **未執行**（沒有 DB） |
| Playwright（smoke、accessibility、wp88、registration-onboarding） | **未執行** |

合併前，主對話或 CI 需要補跑 `npm run test:db`（至少上面兩個 DB 檔與 `payment-webhooks.test.ts`）以及 `quality` CI 的 e2e。

## Findings

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議修法 |
|---|---|---|---|---|
| R448-01 | MAJOR | `src/app/api/webhooks/payments/route.ts:213-225`；`src/lib/payment-providers/payuni.ts:103-108` | 已驗簽、`TradeStatus=1` 但 `PaymentType≠1`（例如 `Credit=1` 沒有真的關掉其他付款工具，或 Apple／Google Pay 回報的 PaymentType 不是 1），或內層 SUCCESS 但外層 Status 缺漏，都會變成 `not_actionable`。這時 PayUni 端已經收款，我方卻：(a) 不建立 WebhookEvent；(b) audit 只記 `providerId`、`bodyBytes`、`reason`，**沒有 MerTradeNo／TradeNo／TradeStatus／PaymentType**；(c) 主動查詢路徑（`payuni.ts:307-310`）同樣拒絕 PaymentType≠1，所以 recovery runner 也救不回來。交易會一直 pending 到過期、釋放庫存，買家付了錢卻沒有訂單，營運端也查不到是哪一筆。另外回 400 給 Notify：如果 PayUni 對非 2xx 會重送，`trade_pending`（0／8）會反覆打進來，每次都多一筆 audit。 | 1）錯誤物件帶出有界識別碼（MerTradeNo、TradeNo、TradeStatus、PaymentType 已在 `PAYUNI_WEBHOOK_AUDIT_KEYS` 白名單內），寫進 `payment_webhook_not_actionable` audit 的 `after`。2）`payment_type_not_allowed` 與 `provider_status_not_success`（TradeStatus=1）另外寫一筆可篩選的營運告警（或建立 `status="ignored"` 的 WebhookEvent），讓 admin 能人工對帳或退款。3）來源是 `notify` 時，已驗簽但刻意忽略的事件改回 200 ack（Return 維持 303 unverified），避免重送風暴；PayUni 的重送規則列入 Sandbox 驗證。 |
| R448-02 | MAJOR | `src/lib/webhook-retry.ts:102-126`（重送用的是已儲存的 `normalized`）；`src/app/actions.ts:2455-2466`（admin 手動重送）；`/api/jobs/webhook-retry` | 部署邊界：舊程式把任何 `Status=SUCCESS` 都正規化成 `eventType:"paid"`，連 TradeStatus 0／2／3 也一樣（B03-01）。舊格式事件（eventId 為 `TradeNo`、沒有 `:`）如果停在 `failed`／`retrying`，之後被 admin 手動重送、job 或 `wp4-buyer-callback-retry` 重跑時，會直接拿舊的 `paid` 決策呼叫 `processPaymentWebhook`，完全繞過新的 `payUniUppEventType`。舊事件的 raw snapshot 也沒有保存 TradeStatus（舊白名單沒有這個欄位），事後無法判斷當初那個 paid 是否正確。PayUni 重送同一筆舊 Notify 時，則會用新 eventId `TradeNo:1` 建立第二個事件；paid-on-paid 的冪等性靠佣金與訂單層的既有防護，DB 測試沒有直接覆蓋這條路徑。 | 擇一：(a) 在 `retryWebhookEvent` 拒絕重送 `provider="payuni"` 且 eventId 不符合 `^.+:\d{1,2}$` 的 payment 事件（標記 exhausted 並寫 audit）；或 (b) 部署前在 staging 與 production 跑唯讀查詢：`WebhookEvent` where `provider='payuni'`、status 不是 `processed`、`eventId` 不含 `:`。結果必須是 0，否則逐筆人工處置，並把這個步驟寫進 runbook。建議兩者都做。 |
| R448-03 | MINOR | `src/lib/payment-providers/payuni.ts:1050-1051, 1063` | B03-13 未處理：UPP paid 路徑仍從已簽章 payload 讀 `VendorId`／`VendorSlug`／`ReferralCode`。真實 UPP 應該不會回傳這些欄位，而且需要商店金鑰才簽得出來，所以在封測（Sandbox）下風險低，可以接受。但未知訂單仍能憑 payload 指定 vendor 或 referral 建立權威付款與佣金，正式收款前必須關掉。 | `isUppCallback` 為真時不讀這三個欄位；`payment-webhooks.ts` 對正式 provider 只接受既有 checkout 交易。列為正式上線前的必要項目。 |
| R448-04 | MINOR | `src/lib/payment-providers/payuni.ts:81, 92-100` | TradeStatus 4／9 判為 failed 是依審查報告推定，UPP 表格沒有這兩個值。failed 會觸發釋放庫存與 `releasePostPurchaseCreditForTerminalPayment`。如果 Sandbox 證實「同一個 MerTradeNo 在 TradeStatus 2 之後還能重試並變成 1」，這條路徑在新設計下才會真的發生（舊版會被 eventId 去重吞掉）：資料庫 trigger 會撤銷升級折抵的交付，形成「已付款但交付被撤」。 | 用 Sandbox 確認卡片失敗後 UPP 頁能不能用同一個 MerTradeNo 重試，以及 4／9 是否真的會出現。如果能重試，failed 先不要釋放升級折抵（或改成 pending），等查詢確認再處理。 |
| R448-05 | MINOR | `src/lib/payment-providers/payuni.ts:101-105`；`payuni.test.ts`「outer status missing」 | paid 必須同時有內層與外層 `Status=SUCCESS`。如果 PayUni 的 Notify（伺服器對伺服器）其實沒有帶外層 Status，所有真實付款都會被判成 `provider_status_not_success`。這和 R448-01 疊加後，就是「全部付款被丟掉、沒有識別碼」。綁卡路徑（#444）也有同樣假設，但 Sandbox 綁卡收據仍是外部 gate，所以還沒有證據。 | 第一筆 Sandbox 付款前，先用去識別化樣本確認 Notify 與 Return 都有外層 Status。在確認之前，至少完成 R448-01 的識別碼記錄。 |
| R448-06 | MINOR | `src/lib/staging-qa-finance-bootstrap.ts:105-107`；`.github/workflows/staging-qa-finance-bootstrap.yml:54-57` | bootstrap 用 GitHub secret 的 `CSRF_SECRET` 加密 factor，再用同一把鑰匙驗證既有 factor，所以 GitHub secret 和 Vercel staging 的 `CSRF_SECRET` 不一致（或 staging 其實靠 `JOB_SECRET` fallback）時，bootstrap 偵測不到。runner 會在 `/mfa/verify` 失敗，bootstrap 重跑會回 `VERIFIED`，也不會覆寫 factor，只能手動刪 DB 列。 | owner 待辦：確認兩邊的 `CSRF_SECRET` 位元組相同，且 staging 有設定 `CSRF_SECRET`。可選：在 wp4-preflight 回傳 MFA 金鑰的 HMAC 指紋（不含金鑰本身），讓 bootstrap 比對。 |
| R448-07 | MINOR | `src/lib/payment-webhooks.ts:991-999`（下游）；`payuni.ts:66-71` | B03-04 只修了一半：`netAmountCents` 缺漏時回 undefined，`??` 會落到 checkout 寫入的 `netAmountCents = gross`（`checkout/route.ts:896`），不會再變成 0，這部分正確。但 `gatewayFeeCents` 透過 zod `default(0)` 仍然是 0，金流手續費還是由平台全額吸收、月結不扣。這是已知的 owner 決策項。 | 維持 owner 待辦（費率由誰負擔、怎麼算）；在 STATE 標成「部分完成」，不要標「完成」。 |
| R448-08 | NIT | `src/lib/payment-providers/payuni.ts:66-71` | `optionalCents` 用 `parseFloat`，會接受前綴字串（例如 `"12abc"`→1200），和嚴格的 `queryAmountCents` 不一致。因為只有已簽章 payload 才會走到這裡，影響很小。 | 改用與 `queryAmountCents` 相同的完整 token 檢查。 |
| R448-09 | NIT | `scripts/qa-finance-totp.mjs:94-95` | runner 的 `waitAfterMfa` 會等到離開 `/mfa/`，所以 TOTP 錯誤時會先 Playwright timeout，`NOT_COMPLETED` 這個封閉分類實際上幾乎走不到；receipt 只會顯示 stage `platform-mfa`，沒有 `mfaFailure`。 | 改成等 URL 變化或出現 `error=` 參數，再分類成 `NOT_COMPLETED`。 |
| R448-10 | NIT | `src/app/register/page.tsx:11`；`src/lib/public-policy-content.ts:56, 109` | 勾選文字寫「服務條款」「隱私權政策」，但政策頁標題是「使用條款」「隱私通知」。同意紀錄的法律文字最好和文件名稱一致。 | 統一名稱。 |
| R448-11 | NIT | `src/app/api/webhooks/payments/route.ts:224` | `not_actionable` 的 Return 一律導向 `/checkout/result?payment=unverified`，平台方案付款不會回 `/billing/plans`。 | 可以用 MerTradeNo 查交易用途後再決定導向（只讀伺服器紀錄）。 |
| R448-12 | NIT | `src/lib/wp4-buyer-ops.db.test.ts:220` | audit 斷言只檢查 `count > 0` 與 `createdAt >= payment.createdAt`，沒有鎖定 `reason`。 | 斷言 `after.reason` 等於預期值（修好 R448-01 後再加上識別碼）。 |

各嚴重度數量：BLOCKER 0、MAJOR 2、MINOR 5、NIT 5。

本次沒有發現 BLOCKER。

## 各重點的審查結論

### A3 PayUni 付款判斷（`84f22d38`）
- **判斷矩陣**：只有在以下條件全部成立時才判為 paid：已簽章 `TradeStatus=1`、內層 `Status=SUCCESS`、外層 `Status=SUCCESS`、`PaymentType=1`。2／3／4／9 判為 failed；0／8 回 `not_actionable`；空值或未列出的值 fail closed；帶 `EventType` 的 UPP payload 一律拒絕；沒有 TradeStatus 的舊式 payload 不可能產生 paid（`payuni.ts:1020-1025`）。外層 Status 只能否決、不能促成 paid，方向正確。
- **Return 與 Notify 一致**：兩條路徑都走同一個 `normalizePayload`，eventId 相同，`(provider,eventId)` 唯一鍵與 `claimWebhookEvent` 會讓兩者收斂成同一個事件。DB 測試證實 failed→paid 是兩個事件、只付款一次，Return 重複送達不會再建事件。
- **取號→付款不互吞**：eventId 改成 `TradeNo:TradeStatus` 達到目的；`resolvePaymentStatus` 讓 paid 之後的 failed 被忽略，failed／expired 之後的 paid 可以升級。部署邊界風險見 R448-02。
- **`not_actionable` 回 400**：不會讓真實付款「靜默變成已付款」，但會讓已收款的非卡片付款無法追蹤（R448-01）。PayUni 會不會無限重送要等 Sandbox 確認。
- **NetAmount**：缺漏時回 undefined，下游的 `??` 會落到既存 `netAmountCents`（= gross），不會寫成 0；手續費仍是 0（R448-07）。
- **`Credit=1`**：和既有綁卡 session（`payuni.ts:971`）使用的參數名一致；是否能真正關掉商店預設的其他付款工具，要等 Sandbox 確認。
- **金額**：paid 必須有已簽章的完整金額；`validatePaymentWebhookInvariants` 仍拿 gross 和既存交易比對；`grossAmountCents` 以伺服器紀錄優先。金額沒有改從 client 來。
- **簽章**：`verifyPayUniSignature` 沒有更動；MerID 內外比對與 HashInfo 驗證都還在。
- **B03-13 未做**：封測（Sandbox）下可以接受，正式收款前必修（R448-03）。
- **測試**：新增的 `payuni.test.ts` F-037 區塊在舊程式下會失敗（舊版 TradeStatus 2／3／0 都判為 paid），屬於有效的紅燈→綠燈測試；fixture 已去掉自創欄位。route 測試涵蓋三種 reason 與 Return 導向。

### A2 admin MFA（`fbd090fb`）
- 和 #436（`8861ed19`、`f59cf33e`）逐行比對（忽略 CRLF）：src 與 tests 的增減行**完全一致**。
- `requireFinanceAdmin` 的 21 個入口（/admin layout、各 admin 頁面、`actions.ts` 8 個 action、affiliate／course／platform-referral payout、support case、stream reconciliation、payout CSV、webhook reconciliation route）全部改成必須有 factor。`/api/admin/ops/*` 用 `JOB_SECRET`，不走 session，不受影響。
- 不會 loop：`/mfa/setup` 用 `requireAuth({nextPath})`，`/mfa/verify` 與登記 action 用 `requireAuth`；守門順序是「先檢查 platform admin（非 platform 使用者導回 /dashboard），再檢查 factor」，有單元測試鎖定。
- route handler 裡呼叫 `redirect()` 會回 307，符合預期。
- session 內舊的 `mfaVerifiedAt`：沒有 factor 時一律導向 setup，有測試覆蓋。
- bootstrap 管理員第一次登記仍然是 first-come（B11 已知殘餘）；和之前「完全不需要 MFA」相比是嚴格變好，沒有變差。

### A1 QA TOTP（`29705acc`）
- seed 只從 `PAYUNI_QA_FINANCE_TOTP_SECRET` 讀取；repo 裡只有 RFC 6238 公開向量 `GEZDGNBV…`，以及常見範例 `JBSWY3DP…`（測試用的「不同 seed」）。
- factor 在同一個 transaction 內建立；加密方式和 app 相同（`encryptMfaSecret`，CSRF_SECRET 衍生金鑰）；recovery codes 只存 `hmac-sha256-v1` 雜湊，明碼丟棄。既有 factor 解出的 seed 不同或解不開時，回 `MFA_FACTOR_MISMATCH`，不會覆寫。缺 `CSRF_SECRET` 時拒絕，理由合理（見 R448-06 的殘餘風險）。
- workflow 只增加 env 注入；`fail()` 只印固定說明；receipt 只多出封閉的 `mfa`／`mfaFailure` 欄位；沒有印出 seed 或驗證碼。bootstrap job 有 egress 防火牆，限制只能連到 DB、GitHub 與 staging 主機。
- TOTP 計算：HMAC-SHA1、6 位數、30 秒週期，和 `mfa.ts` 一致（app 容許前後各 1 個時間窗）；有測試比對 `qaFinanceTotpCode` 與 `totpCodeForTimestamp`。runner 遇到 `/mfa/setup` 會明確失敗，不會自行登記。

### A4 migration 與註冊（`82f09e08`）
- `20261019120000_user_policy_consent`：手寫、forward-only、純新增，不動既有列；CHECK（context 封閉集合、版本 token 格式）與 FK 方向正確（`userId` CASCADE、`vendorId` SET NULL），和 schema 的 `onDelete` 一致；有啟用 RLS；索引名稱和 Prisma 預設相同。`PRISMA_INVARIANTS.md` 已登記（9 個 identity models、149 models／109 migrations）。目前版本 `2026.10.18` 符合 CHECK。
- 註冊 action：在 CSRF 之後、rate limit 之前，必須 `acceptPolicies === "on"`，且回傳的版本必須等於伺服器的 `consentVersion`。實際寫入的版本永遠來自伺服器 metadata，client 無法偽造。同意紀錄和 User／Vendor／Member／audit 在同一個 transaction。登入路徑沒有更動，既有使用者不受影響（沒有回填；邀請成員等其他建帳路徑不記錄同意，F-114 範圍外）。

### 測試與 Playwright
- smoke、accessibility、wp88 的修改都只是把預期落點改成 `/mfa/setup?next=…`，並**新增**「財務總覽 heading 數量為 0」的斷言；wp88 的 `enableSyntheticMfa` 會同時寫入 factor 與 session `mfaVerifiedAt`，之後仍然驗證能進入 dashboard（200 且 heading 可見）。沒有刪除任何斷言。registration-onboarding 新增「未勾選無法送出」與 DB 同意筆數的斷言。

## 待 Sandbox 樣本驗證

1. Notify 與 Return 是否都帶外層 `Status`（R448-05）；內外層的值是否一致。
2. TradeStatus 4／9 是否會出現在 UPP 回呼，以及代表的意義（R448-04）。
3. 卡片授權失敗（TradeStatus 2）後，同一個 MerTradeNo 能不能在 UPP 頁重試並變成 1（R448-04）。
4. TradeStatus 8 之後，PayUni 會不會再送一次最終狀態的 Notify，還是必須主動查詢。
5. `Credit=1` 是否真的讓 UPP 頁只顯示信用卡；Apple Pay／Google Pay／Samsung Pay 是否仍會出現，回報的 `PaymentType` 是什麼（R448-01）。
6. PayUni 對 NotifyURL 回非 2xx（400）時的重送次數與間隔（R448-01）。
7. 真實回呼有沒有 `NetAmount`、`GatewayFee`、`VendorId`、`ReferralCode` 等欄位（R448-03、R448-07）。
8. GitHub environment 與 Vercel staging 的 `CSRF_SECRET` 是否一致；bootstrap → runner 的 `/mfa/verify` 能否實際走通（R448-06）。

## 結論

A2、A1、A4 都沒有發現阻擋合併的問題。A3 的付款判斷方向正確，簽章與金額來源也沒有被削弱，但還有兩個 MAJOR：R448-01（已收款但被忽略的回呼沒有識別碼，也追不回來）與 R448-02（部署邊界上，舊 paid 事件被重送時會繞過新的判斷）。兩者的修法都很小，R448-02 也可以改用「部署前唯讀查詢為 0 並寫進 runbook」處理。另外 DB 測試與 e2e 還沒跑過。

需修正後再審
