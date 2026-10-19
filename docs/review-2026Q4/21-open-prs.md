# 21 開啟中 PR 審查（B-11）

- 審查日期：2026-10-19（Asia/Taipei）
- 基線：`origin/master` = `78621ca3`（`git fetch` 後確認）
- 方式：唯讀。`gh pr list／view／diff`、`git merge-tree --write-tree`（只在物件庫產生暫時 tree，不動任何 ref、索引或工作樹）。沒有 merge、rebase、push 或任何 PR 寫入。

## 0. 結論

- **目前只剩 1 個開啟中的 PR：#436**（`gh pr list --state open` 只回傳它）。審查計畫提到的 #423、#426～#429 已全部合併，#384、#420 已關閉且確認被取代。
- **#436 建議：rebase，不要 close，也不要現在就 merge。** 程式本身正確（沒有 redirect loop），衝突是 `wp88` 規格檔的換行字元造成的假衝突加 2 行標題字串；真正阻擋合併的是 staging 的 PayUni 退款 QA 流程，會在 `/mfa/setup` 停住。
- 近 25 個已合併 PR 中，明確標「needs owner sign-off」的只有 #435；另有 3 個 PR 的內文留有未結的 owner 事項（見第 3 節）。

## 1. #436 審查（WP-10 後台財務 MFA）

PR：`fix(auth): require an enrolled MFA factor before platform finance access (WP-10)`，分支 `codex/audit-wp10-admin-mfa`，head `78564ddc`，6 個檔案、+53／−20。`quality` CI 在該 head 為 SUCCESS，但該 head 落後 master 11 個提交（merge-base = `e9d98995`，即 #431）。尚無任何 review。

### 1.1 變更內容

`requireFinanceAdmin()`（`src/lib/auth.ts`）在確認為 platform admin 之後多一道檢查：沒有 `mfaFactor` 就 `redirect("/mfa/setup?next=%2Fadmin%2Fbilling%2Fdashboard")`。其餘為 `loginAction` 的註解更新、單元測試 2 組、3 個 e2e 規格改為預期被導向設定頁。

### 1.2 正確性檢查

| 檢查項 | 結論 | 依據 |
|---|---|---|
| redirect loop | **無**。`/mfa/setup` 頁面與其 action 使用 `requireAuth`（不是 `requireFinanceAdmin`），所以沒有因子的 admin 可以進入設定頁 | `src/app/mfa/setup/page.tsx` 的 `requireAuth({ nextPath })`；`mfa-enrollment.ts` |
| 檢查順序 | 正確。`requireAuth` 先執行：有因子但 session 未驗證 → `/mfa/verify`；非 platform admin → `/dashboard`；最後才檢查因子。單元測試鎖定了「非 platform 用戶被送 `/dashboard` 而不是 `/mfa/setup`」 | `auth.ts:239-330`；PR 測試 `auth.test.ts` |
| 「有因子」的定義 | 正確。`getCurrentAuth` 的註解與程式表明 `mfaFactor` 只在 TOTP 確認後才存在，pending 設定放在另一個 cookie，不會誤判 | `auth.ts:211-217` |
| 啟用後的導向 | 正確。`enrollMfa` 流程呼叫 `markCurrentSessionMfaVerified()`，當前 session 立即視為已驗證，之後回到 `next`，不會再被送去 `/mfa/verify` | `mfa-enrollment.ts:80-86` |
| 涵蓋範圍 | `/admin/**` layout、退款、結算、出款、webhook 重送、Cloudflare 影片頁、`csv/route.ts`、`reconciliation/route.ts`，共 21 個非測試檔案呼叫 `requireFinanceAdmin`（不含定義處 `auth.ts`），一次生效 | `rg requireFinanceAdmin` |
| API 回應 307 | 屬實。兩個 admin route handler（出款 CSV、webhook reconciliation）用 `redirect()`，沒有因子的 admin 會收到 307 到 HTML 設定頁，與先前「未驗證」情境相同，非新行為。呼叫端若是 `fetch` 會看到 HTML；目前這兩個是瀏覽器下載／導向，影響小 | 兩個 route 檔 |
| `/api/admin/ops/*` | **不受影響**。它們用 `JOB_SECRET`／ops 授權，不經 session | 檢查 `cloudflare/live-input` 等 |
| bootstrap admin | **受影響且符合預期**。`scripts/bootstrap-platform-admin.ts` 建立的第一個 admin 沒有因子，首次登入會被導到設定頁，須先設定 TOTP 才能看到任何 `/admin` 頁 | PR 內文已說明 |
| 登入流程 | 沒有因子的 admin 登入後 `loginAction` 仍導向 `/admin/billing/dashboard`，由 layout 再轉到 `/mfa/setup`（多一次轉址，體驗上可接受） | `auth-security-actions.ts:128` |
| 商家角色 | 不受影響。非 platform admin 仍先被導回 `/dashboard` | 單元測試 |
| 測試 | 單元與 e2e 都改為預期新行為，且 e2e 加上「財務總覽標題不得出現」的斷言，確保沒有因子時看不到財務頁 | PR diff |

### 1.3 衝突

`git merge-tree --write-tree origin/master origin/codex/audit-wp10-admin-mfa`：只有 **1 個檔案**衝突，`tests/e2e/wp88-direct-url-guard-matrix.spec.ts`。`smoke.spec.ts`、`accessibility.spec.ts`、`auth.ts`、`auth.test.ts`、`auth-security-actions.ts` 都能自動合併。

衝突原因不是內容，而是**換行字元**：merge-base 與 PR 分支的這個檔案是 CRLF（182／187 行都是 `\r\n`），master 上同檔已被轉成 LF（0 行 CRLF，這是由 #439 轉換；`git log` 顯示它是 #431 之後唯一改過此檔的提交）。Git 把整個檔案視為改動，所以呈現為整檔衝突。用 `--ignore-cr-at-eol` 比對，master 實際只改了 2 行標題字串（`Dashboard` → `營運總覽`、`團隊展業` → `團隊模板`），與 PR 的 3 個 hunk 沒有重疊。

處理方式：rebase 到 master，衝突時直接採用 master 的 LF 版本，再把 PR 的 3 個 hunk 套回去（`login()` 加 `expectedUrl` 參數、`signedInPage` 預設值、platform session 改預期 `/mfa/setup`），存成 LF。預估 15～30 分鐘。repo 沒有 `.gitattributes`，同類換行衝突之後還會發生（B11-05）。

### 1.4 Findings

| ID | 嚴重度 | 位置 | 問題 | 影響 | 建議 | 估工 | owner | 封測 |
|---|---|---|---|---|---|---|---|---|
| B11-01 | MAJOR | `scripts/q1-original-refund-runner.mjs:77`、`scripts/payuni-sandbox-pending-refund-consumer.mjs:190`、`scripts/payuni-issued-recovery-runner.mjs:232`、`scripts/payuni-current-source-refund-qa.mjs:218`；`src/lib/staging-qa-finance-bootstrap.ts` | staging 的財務 QA 帳號沒有 MFA 因子，而這 4 個 runner 只處理 `/mfa/verify`，不處理 `/mfa/setup` | #436 合併後，所有 staging PayUni 退款／復原 runner 停在 `/mfa/setup`（fail-closed，不會誤動金流，但整條 Sandbox QA 鏈中斷）。PR 作者已在留言列為 merge hold | 在 bootstrap 為 QA 帳號建立因子並把 TOTP seed 放入 staging secret，runner 以 seed 算出驗證碼；或 runner 補上登記流程。須在 #436 合併前完成，或同一個 PR 內完成 | 0.5～1 天 | 否 | 是（阻擋 staging Sandbox 驗證） |
| B11-02 | MAJOR | `tests/e2e/wp88-direct-url-guard-matrix.spec.ts` | 與 master 衝突（CRLF vs LF，見 1.3） | PR 目前 CONFLICTING，無法合併；`quality` 綠燈是舊 head 的結果，rebase 後須重跑 | rebase；採 master 的 LF 版本再套回 3 個 hunk；push 後等新 head 的 `quality` | 0.5 小時 | 否 | 是 |
| B11-03 | MAJOR | `src/lib/mfa-enrollment.ts`、`/mfa/setup`（既有，PR 內文已列為殘餘風險） | 沒有因子的 admin 帳號，**誰先用密碼登入，誰就能第一個登記 TOTP**；session 的 `mfaVerifiedAt` 也沒有與因子的 `enabledAt` 綁定 | 若 bootstrap admin 的初始密碼外洩，攻擊者可先登記自己的 TOTP，等於鎖死真正的 owner 並取得財務後台。#436 把風險從「可直接進後台」縮小為「可先搶登記」，但沒有消除 | 上線前：bootstrap 腳本改為產生一次性登記連結或直接輸出 TOTP 登記資訊給 owner（不經過密碼）；或登記前要求 email OTP／重新輸入密碼；並讓 `mfaVerifiedAt` 必須晚於因子 `enabledAt`。另開 PR，不併入 #436 | 1～2 天 | 是 | 是 |
| B11-04 | MINOR | `requireFinanceAdmin()` 呼叫面 | 沒有單元測試保證「新增的 platform 頁面一定經過 `requireFinanceAdmin`」；現有的 wp88 規格靠字串比對 guard 名稱 | 日後新增 admin 頁若直接用 `requireAuth`，會繞過這個新檢查而不被發現 | 在 wp88 規格或 lint 規則中，要求 `/admin/**` 下所有 page／route 必須呼叫 `requireFinanceAdmin`（目前規格已涵蓋 page，route handler 未涵蓋） | 2 小時 | 否 | 否 |
| B11-05 | MINOR | repo 根目錄（無 `.gitattributes`） | 換行字元沒有統一，PR 與 master 混用 CRLF／LF | 每次 rebase 都可能出現整檔假衝突；diff 雜訊大 | 新增 `.gitattributes`：`* text=auto eol=lf`，並做一次獨立的 renormalize PR（先確認不影響 Windows 作業流程） | 1 小時 | 是 | 否 |
| B11-06 | NIT | `auth-security-actions.ts:128` | 沒有因子的 admin 登入後多一次轉址（先 `/admin/billing/dashboard` 再 `/mfa/setup`） | 無功能影響 | 可在 `loginAction` 直接導向設定頁；非必要 | 15 分鐘 | 否 | 否 |
| B11-07 | NIT | `csv/route.ts`、`reconciliation/route.ts` | route handler 以 307 轉址回 HTML | 若未來被 `fetch` 呼叫，會拿到 HTML 而非 401 | 日後可改回傳 JSON 403／401；不在本 PR 範圍 | 1 小時 | 否 | 否 |

### 1.5 建議（merge／rebase／close）

**Rebase，然後在 B11-01 解決後合併。** 理由：

1. 邏輯與測試覆蓋合理，沒有發現會造成 loop 或權限降級的問題，不需要 close 重做。
2. 現在直接 merge 會中斷 staging Sandbox QA 鏈（B11-01），而 PR 作者已把「在 staging PayUni Sandbox 驗證之後再合併」寫進 merge hold；我同意這個順序。
3. 依 `AGENTS.md`，auth／權限變更合併前需要一次獨立審查。本文件是 B-11 審查，不等同於 `reviewer` agent 的正式審查；rebase 之後請派 `reviewer` 對最終 diff 做一次，再由 owner 說可以合併。
4. 在封閉測試前這個變更應該要進 master（沒有 MFA 的財務後台管理員，是不能接受的狀態），所以不要拖到封測之後。B11-03 的首次登記風險要在同一個時間窗內處理。

建議順序：(a) 派 `engineer-hard` 做 rebase 與 B11-01；(b) `reviewer` 審；(c) owner 確認 staging QA 帳號已有因子後合併；(d) 另開 B11-03 的 PR。

## 2. #384、#420 的狀態

`gh pr view` 結果：

| PR | 標題 | 狀態 | 關閉時間 | 被取代於 | 備註 |
|---|---|---|---|---|---|
| #384 | feat(tracking): authoritative four-event Meta outbox and isolated delivery | CLOSED（未合併） | 2026-10-17 16:18Z | **#424**（`feat(tracking): ... synced with master (supersedes #384)`，2026-10-17 09:18Z 合併；squash `de991b2b`）；review 後續修補為 **#429**（已合併） | 原分支 head `831a2bf2` 保存在 tag `archive/branch/codex/server-tracking-webhooks-20261007`（遠端 tag 存在，已用 `git ls-remote --tags` 確認） |
| #420 | feat(notifications): 四渠道學員通知與現行主線整合 | CLOSED（未合併） | 2026-10-18 06:30Z | **#431**（`... supersedes #420`，2026-10-18 06:27Z 合併；squash `e9d98995`） | 原分支 head `c1b694ce` 保存在 tag `archive/branch/codex/notifications-main-20261011`（已確認存在） |

兩者都已關閉，且關閉前都留有說明留言。審查計畫列為開啟中的 #423（post-purchase credit）、#426／#427（CI 與 migration 測試）、#428（Claude agents 取代 Codex）、#429 也都已合併，目前沒有需要審查的其他 PR。

提醒：#431 的 PR 內文自述 SMS、WhatsApp、Web Push 三個渠道未用真實 provider 測試過，須視為 UNVERIFIED，直到有 provider 測試帳號與收據。

## 3. master 近 25 個已合併 PR 中帶「owner sign-off」或類似字樣者

掃描範圍：`gh pr list --state merged --limit 25`（#418～#444）。先比對標題，再抽讀 #428～#444 的內文。

| PR | 合併 | 字樣 | 未結事項 | 風險 |
|---|---|---|---|---|
| **#435** `feat(policies): formal public terms, privacy and refund policies (WP-03) — needs owner sign-off` | 2026-10-18 19:12Z（合併者 `a25814740`，即 owner 帳號） | 標題與內文「Needs owner sign-off before merge」 | (1) 條款、隱私、退款政策內容（版本 2026.10.16，預定 2026-11-01 生效；生效前頁面顯示「本版本尚未生效」）要由 owner 審閱；(2) `/support` 公開的客服 email 要確認。**PR 內文無 owner 核可紀錄**，合併者是 owner 帳號，可推定是 owner 自己合併，但內文與留言沒有明確確認這兩項 | 法律文字與公開客服信箱已在 master。生效日為 2026-11-01，在此之前頁面會標明未生效；須在生效日前由 owner 正式確認，否則封測使用者會看到未經審閱的條款 |
| #442 `feat(funnel): six course-sales templates (WP-09)` | 2026-10-18 | 內文「Content rules (owner decision)」 | Codex 原本卡在「內容核可」，PR 記錄 owner 已授權決定，內容規則（無圖片、無見證、無價格保證、無 LINE／SMS 承諾）已套用 | 低；已有授權紀錄 |
| #431 `feat(notifications): learner notifications on four channels` | 2026-10-18 | 內文「Treat those channels as unverified」 | SMS、WhatsApp、Web Push 需 provider 測試帳號才能驗證 | 中；功能已在 master，但三個渠道未驗證，不可對外宣稱 |
| #430 `ci: add a guarded workflow to migrate the staging database` | 2026-10-18 | 「Plan after merge」 | 合併後要先跑 `status`、確認待套用的 7 個 migration，再 `deploy` | 低；staging 專用，`staging-migrate` 已有保護（見 19 號文件） |
| #440 `feat(funnel): real 404/503 ... (WP-01)` | 2026-10-18 | 內文「Decisions」 | 每個 `/lp` 請求多一次小型 DB 查詢（成本已在內文列出） | 低；成本項，非簽核 |

另外 #444、#443、#441、#439、#438、#437、#434、#433、#432、#429、#428 的內文未發現 owner 簽核字樣。

## 4. 彙整

| 項目 | 結論 |
|---|---|
| 開啟中 PR | 僅 #436 |
| #436 建議 | rebase（假衝突，採 master 的 LF 版本）；補 staging QA 帳號的 MFA 因子；`reviewer` 正式審查；owner 說可以再合併 |
| #384／#420 | 均已關閉並被 #424／#431 取代，原分支以 tag 保存 |
| 待 owner 補確認 | #435 的法律文字與客服信箱（2026-11-01 生效前）；#431 三個渠道的 provider 驗證 |
| 封測前必修 | B11-01、B11-02、B11-03 |
