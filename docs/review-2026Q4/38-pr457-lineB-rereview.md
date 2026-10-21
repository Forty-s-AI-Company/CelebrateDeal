# PR #457 複審：Line B 資料／migration 修正

- 分支：`codex/beta-l1c-lineB-data`，複審範圍 `git diff ce7c833c..HEAD`（8 個 commit，HEAD `cb3e03fc`）
- 對照：`docs/review-2026Q4/38-pr457-lineB-review.md`
- 審查者：reviewer（Opus），2026-10-21；只回報 findings，沒有修改程式

## 實際執行的驗證

| 項目 | 結果 |
|---|---|
| 一次性 loopback PG 18.4：先在空的 `celebratedeal_dev` 套用 master 的 migration，插入 3 筆 PaymentAccount（含連字號的明文帳號、`vault:` 字串、已經遮罩過的帳號），再套用本 PR 的 4 個 migration | 全部成功。兩筆明文被遮罩成 `****9012`、`****ankx`，戶名改成 `王＊＊`。只有這兩筆各寫入一列 `payment_account_legacy_plaintext_masked` audit（`requiresMerchantReentry: true`）。原本就遮罩過的那筆沒有被動到。三個 constraint 的 `convalidated` 都是 `t` |
| 本 PR 的 DB 與 unit 測試，加上 `src/app/actions.test.ts`（11 檔，使用 CI 的 `CSRF_SECRET`／`JOB_SECRET`） | 470/470 通過。N2 修正後，PG18 也通過 |
| `production-migrate`、`staging-migrate`、`scheduled-jobs-runner`、`migration-order-check` 的 node 測試 | 43/43；`migration-order-check.mjs` ok，新增 4 個 migration |
| contract registry、prisma invariant inventory | 2/2 |
| `npm run typecheck`、對變更檔跑 eslint | 通過 |
| 行尾 | `seed.ts`、`actions.payout-db.test.ts`、backfill、`payout-account.ts`、`page.tsx` 的 HEAD blob 都沒有 `\r` 了 |
| CI `quality` | 審查時兩個 run（39503041742、39503045927）都還是 pending，還不能算通過 |

## 原 findings 狀態

| # | 狀態 | 依據 |
|---|---|---|
| M1 | **已修正** | `actions.ts` 的檢查順序是 CSRF → owner 財務 → `mfaFactor` 必須存在 → 限流（`payout-account-step-up:<userId>`，5 次／15 分）→ 當下用 `verifyTotpCode` 驗 TOTP。`verifyTotpCode` 只接受 6 位數字，所以 recovery code 本來就不可能通過；失敗會寫 audit。限流在驗碼之前執行。每次儲存都會把帳號設成 `pending_verification`，`payoutEligibleAt = now + 24h`，`now` 由伺服器的 `new Date()` 決定，action 不接受外部傳入的時間。`selectPayoutAccount` 把 `pending_verification` 也算進候選，而且必須剛好只有一筆，帳號又是原地更新，所以冷卻期間只會擋下撥款，不會退回舊帳號（`payout-account.test.ts:90` 有測）。`verified` 不會再自動升成 `active`。通知信寄給所有 active owner，只包含商家名稱（有做 HTML escape）、末四碼和兩個時間。寄送失敗時變更仍保留，並顯示 `saved_notification_failed`。限流的實際效果見 R1 |
| m1 | **已修正** | `20261021140100`、`20261021140300` 是兩個只做 `VALIDATE` 的獨立 migration。前一個檔案只做 catalog-only 操作（ADD COLUMN 不帶 default、`NOT VALID`、DROP/ADD CONSTRAINT）。兩份 runbook 與 migration 註解的鎖說明也都改正了 |
| m2 | **已修正（附條件，見 R2）** | 改成不會 RAISE：先依明文列寫 audit，再遮罩，接著 `NOT VALID` 加 CHECK，最後另一個檔案 VALIDATE。archive migration 移到最前面（`140000`），runbook 也寫明「先 migrate 成功，才 promote app」。可追溯性方面，audit 列記錄 `vendorId`、`targetId`、`hasEncryptedAccount`、`requiresMerchantReentry`，可以當作「需要商家重填」的清單。原始帳號只存在於部署前的備份（production workflow 規定 24 小時內必須有備份）。沒有 envelope 的帳號會繼續是 `active`，但已不符合撥款資格，批次會 fail closed（`invalid_payout_account`）。owner 不需要手動補 envelope：唯一的補救方式是請商家在 `/billing/payouts` 重填，這條路會經過 TOTP 與 24 小時冷卻 |
| m3 | **已修正** | route 先檢查 `DATA_RETENTION_ENABLED === "true"`，沒開時回 `skipped`，完全不寫資料；`failed`、`needs_manual_reconciliation` 也加進保護清單 |
| m4 | **已修正** | `APPROVED_ANONYMIZE_WORKFLOWS = {}`。遠端目標一律拋 `remote-outside-workflow`；`Object.hasOwn` 也擋住了 `__proto__` 這類 key。`--execute` 必須同時有 `ANONYMIZE_CUSTOMER_CONFIRM=ANONYMIZE_CUSTOMER_PII`。驗證過的 URL 會固定寫進 `PrismaClient({ datasourceUrl })`，註解也老實寫明「這是防誤用，不是存取控制」 |
| m5 | **已修正** | 舊訂單改為在記憶體中解密 buyer envelope 後比對 hash，解不開的計入 `legacyOrdersUnreadable`。Blacklist 會覆寫 identifier 與 notes。posts／replies／notes 只計算內容還沒被覆寫的列，所以重跑後會變成 0。runbook 的說法也修正了 |
| m6 | **已修正** | workflow 路徑改成寫死在程式裡的 `.github/workflows/production-backup.yml`，不再讀 repo 變數。另外會檢查 `repository` 與 `head_repository` 都是本 repo、`head_branch=master`、event 只能是 `workflow_dispatch` 或 `schedule`、`completed/success`、24 小時內完成，並用第二次 API 呼叫確認有 `production-database-backup-<runId>` artifact、未過期且大小大於 0。邏輯正確，測試涵蓋了各個失敗代碼 |
| N1 | 已修正 | 行尾已恢復成 LF |
| N2 | 已修正 | 斷言同時接受 23503 與 23001，PG18 實測通過 |
| N3 | 未處理 | CHECK 仍然是 `LIKE '****%'`，可以之後另開 migration 處理 |
| N4、N5 | 接受 | 和原報告的結論相同 |

## 新發現

| # | 等級 | 位置 | 失敗情境 | 建議修正 |
|---|---|---|---|---|
| R1 | MINOR | `src/app/(app)/billing/payouts/actions.ts:57-63`；`src/lib/rate-limit.ts:43-47,91,115,151-154` | 限流的 bucket key 是 `<key>:<clientIp>`，實際上是「每個使用者、每個 IP」各 5 次，不是每個使用者 5 次。`RATE_LIMIT_PROVIDER=cloudflare_waf` 時 app 層直接放行；`memory` 在 serverless 環境只在單一 instance 內計數。TOTP ±1 視窗同時有 3 組有效碼，持有被偷 session 的攻擊者如果能換 IP，或部署剛好沒有對應的 WAF 規則，就有機會暴力試碼。登入的 MFA 也用同一個 limiter，所以這是既有的安全水準，並沒有因為本 PR 變差。 | 改用不依賴 provider 的硬限制：在驗碼前計算 `AuditLog` 裡同一 user 最近 15 分鐘 `vendor_payout_account_step_up_failed` 的筆數，達到 5 就拒絕。這些 audit 列本來就已經在寫。可以在開放正式撥款前補上。 |
| R2 | MINOR | `docs/operations/prisma-migration-guards-runbook.md` §6；`prisma/migrations/20261021140200_payment_account_payout_verification/migration.sql` | 以前遇到明文會 RAISE，現在改成靜默遮罩。backfill 只要遇到一筆 incomplete 或 unrecoverable 的資料，就會整批拒絕執行。這時如果有人仍然照常 deploy，原本可以順利加密的其他明文帳號也會一起被遮罩，只能從備份還原，或請商家重填。runbook 只說「先查、先 backfill」，沒有明說 `plaintext_rows > 0` 時不能 deploy。另外，部署後的清單查詢沒有篩選 `requiresMerchantReentry`。 | runbook 補一條硬性規則：「`plaintext_rows > 0` 且 backfill 尚未完成時不得 deploy，除非 owner 書面接受這些帳號需要商家重填」。清單查詢加上 `AND "after"->>'requiresMerchantReentry' = 'true'`。可另外在 `production-migrate.mjs` 的 deploy 前輸出唯讀筆數。 |
| R3 | MINOR | `scripts/production-migrate.mjs`（`PRODUCTION_BACKUP_ARTIFACT_PREFIX`）；`docs/production-database-runbook.md:141` | repo 是公開的。規定「備份 run 必須上傳 artifact」之後，未來寫 `production-backup.yml` 的人很可能直接把 dump 當 artifact 上傳；公開 repo 的 artifact 任何登入的 GitHub 使用者都能下載，等於外洩正式資料。staging 的做法是 age 加密，再另外上傳一份已清理的 receipt。 | runbook 第 3 點寫明：artifact 只能是 age 加密後的密文，或不含資料的 receipt（checksum、restore point），禁止上傳明文 dump。 |
| R4 | NIT | `src/lib/payout-account.ts`（`payoutStatusAllows`） | `active` 狀態不檢查 `payoutEligibleAt`。帳號在 `suspended` 期間被商家改了資料，之後平台手動把它設回 `active`，新帳號會立刻可以撥款，跳過冷卻（不過 owner 當時已經收過通知信）。 | 只要 `payoutEligibleAt` 有值，不論狀態都要求 `<= now`。 |
| R5 | NIT | `scripts/anonymize-customer.ts`（Blacklist） | 覆寫 identifier 等於解除對這個人的封鎖。這是政策選擇，runbook 應告知商家。 | 在 runbook 補一句。 |
| R6 | NIT | `actions.db.test.ts` | 沒有明確測「輸入 recovery code 會被拒」；從格式上已經不可能通過，但少了回歸保護。驗碼也沒有防重放（和 `/mfa/verify` 一樣，是既有行為）。 | 補一個測試案例即可。 |

## 結論

M1 與 m1 到 m6 都已實際修正，並經過測試或在一次性資料庫上實測驗證。剩下的 R1 到 R3 是 MINOR，都不影響資料正確性，也不會造成金流錯付，可以在開放正式撥款或建立正式備份 workflow 前補上。合併前提是 CI `quality` 的 PR run 轉綠：審查時兩個 run 都還是 pending，沒有轉綠就不能合併。

可合併
