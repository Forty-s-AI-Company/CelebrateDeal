# G7-07 Email／通知販售閉環證據（2026-08-08）

- 驗證時間：2026-08-08T13:12:06Z
- 工作模式：PRELAUNCH_DEV_AUTONOMOUS
- current source digest：`a11a0e2e309f56aeb8b90486b6cd8a0cc7b37beb5d176ef3730123651fcda22f`
- source manifest：`docs/ai-team/evidence/g7-07-source-manifest-20260808.txt`
- source manifest SHA-256：`a11a0e2e309f56aeb8b90486b6cd8a0cc7b37beb5d176ef3730123651fcda22f`
- canonical baseline：73.5；本 WP 尚未執行 release reconciliation，因此 canonical delta 維持 0
- Production／正式寄信／正式資料：未操作

## 產品閉環

本 WP 將既有「只有即時 Resend 呼叫與範本」補成可營運的 Email delivery 閉環：

- MessageTemplate 僅開放已接通的 Email；SMS／LINE 清楚停用，避免假成功。
- registration confirmation 先寫入 durable outbox，再由 job route claim／send／finalize。
- delivery 具 idempotency key、stale claim recovery、bounded retry、exhaustion、provider message id 與錯誤代碼。
- provider request 使用 Resend `Idempotency-Key`；官方文件說明 24 小時 dedupe 行為：[Resend Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)。
- unsubscribe 採確認頁 + POST mutation；suppression 以 vendor + recipient hash 隔離。
- 商家可查看 delivery history，但只取得 masked recipient 與必要狀態 DTO。
- 寄送 payload（收件地址、rendered subject、rendered body）使用 AES-GCM envelope 加密保存；資料庫不保存上述 plaintext snapshot。
- Live → MessageTemplate 加入 vendor composite binding；migration preflight 遇到 missing／cross-tenant reference 會 fail closed。
- template subject 單行化，未知、未閉合或格式錯誤的 placeholder 會被拒絕。
- provider send、durable status finalization、audit 與 monitoring 分離；audit／monitoring 故障不會把已送達狀態反轉。
- 導覽與操作頁包含範本管理、寄送紀錄、unsubscribe 狀態與明確錯誤回饋。

## Fresh deterministic evidence

### Core regression

命令：

`npx vitest run <13 個 G7-07 deterministic test files>`

結果：

- Test Files：13 passed
- Tests：263 passed
- failed／skipped：0
- exit code：0

涵蓋 template validation、UI channel gating、outbox、retry／claim、suppression、unsubscribe、job authorization、delivery history DTO、form submission integration、actions 與 live-share commerce regression。

### Prisma／TypeScript／ESLint

在不含任何 `.env*` 的暫存 mirror 執行：

- `prisma validate`：PASS（明確 synthetic loopback DATABASE_URL／DIRECT_URL）
- `prisma generate`：PASS
- `npx tsc --noEmit`：PASS
- scoped `npx eslint ...`：PASS
- old field search：`protectEmailRecipient|revealEmailRecipient|recipientEncryptedEnvelope|subjectSnapshot|bodySnapshot` = 0
- `git diff --check`：exit 0；僅既有 Windows LF→CRLF warnings

第一次未提供 `DIRECT_URL` 的 Prisma validate 正確 fail closed，沒有讀取 `.env*`，不列為 PASS。

### Disposable PostgreSQL

資源：

- PostgreSQL 16 loopback：`127.0.0.1:54329`
- 唯一 schema：`g707_email_1786194270249_822267`
- 正式資料庫：未接觸

結果：

- 38 migrations applied：PASS
- `prisma migrate status`：schema up to date
- DB test files：2 passed
- DB tests：2 passed
- concurrent form submission exactly-once：PASS
- delivery idempotency + tenant suppression：PASS
- schema cleanup：PASS

第一次 DB runner 因 PowerShell／psql quoting 在 CREATE SCHEMA 前失敗；沒有 schema、migration 或測試結果，明確記為 NOT_PASS。第二次改用 SQL argument binding 後通過。

### No-dotenv production build

最終有效路徑：

- 新實體暫存 mirror，不含 `.env*`
- 實體 `node_modules`，避免 junction 越出 filesystem root
- synthetic loopback PostgreSQL schema：`g707_pbuild_1786194612217_139a827`
- `npm run build`：exit 0
- Next.js 16.2.11 Turbopack compile：PASS
- build 內建 TypeScript：PASS
- static pages：98/98
- route manifest 包含：
  - `/api/email/unsubscribe`
  - `/api/jobs/email-deliveries`
  - `/messages/deliveries`
  - `/unsubscribe`
- build schema cleanup：PASS

無效／阻擋路徑未冒充成功：

- junction mirror Turbopack：`Symlink [project]/node_modules ... points out of filesystem root`，TOOL_BLOCKED_NOT_PASS，schema 已清除。
- junction mirror Webpack：process 在產生 BUILD_ID 前非正常中止，TOOL_BLOCKED_NOT_PASS，遺留 schema 已人工精確清除。
- 實體 mirror 是不同隔離路徑，最終取得 exit 0 與完整 route manifest。

本輪所有 disposable PostgreSQL schema 均已清除。兩個不含 `.env*` 的 OS temp source mirrors 嘗試清理時，`Remove-Item` 被工具安全層拒絕；未改用跨 shell 或繞過安全層的刪除方式，因此暫存副本仍在本機 `%TEMP%`，狀態為 `LOCAL_TEMP_CLEANUP_TOOL_BLOCKED`。副本不含憑證、正式資料或外部資料，但尚未宣稱 filesystem cleanup PASS。

## Review finding reconciliation

唯讀 reviewer 在重構中途發現 P0：Prisma／helper 已改為 `payloadEncryptedEnvelope`，但 service／fixture 一度仍引用舊 recipient/snapshot 欄位。

處理結果：

- 視為真實 finding，沒有降級或忽略。
- service、fixture、unit／DB tests 全部改為完整 payload envelope。
- old field search = 0。
- 263 deterministic tests、2 DB tests、TypeScript、ESLint、38 migrations 與 production build 重新執行後通過。

## Browser／外部 provider 狀態

- Chrome／Bombmy Browser binding：TOOL_BLOCKED_NOT_RUN。既有 Chrome extension／native host 診斷完成，但 browser client 無法建立通訊；沒有開啟或修改 Bombmy 頁面，沒有提交表單。
- 依「人工事項先跳過」規則，不重跑同一失敗 Chrome 路徑。
- Resend 真實 staging／sandbox 寄送：NOT_RUN。
- 沒有寄送 Email、沒有讀取 Resend key、沒有取得真實 provider delivery receipt。
- 後續人工／外部 evidence：允許開啟新的 Chrome window 後做 desktop/mobile 操作矩陣；使用受限測試收件地址執行 staging Resend smoke，保存 provider message id、UTC、masked recipient 與 delivery status。

## 計分判斷

- G7-07 本機產品實作候選：至少 7/10。
- 理由：核心 delivery、錯誤復原、tenant／PII 安全、商家紀錄與 fresh deterministic／DB／build evidence 均成立。
- 不足：Browser UX 與真實 Resend provider receipt 尚未建立。
- canonical total：仍為 73.5，delta 0；只有 release reconciliation 且外部證據足夠後才可正式調整。

## Ownership／回滾

- 工作樹原本已有大量使用者與前序 WP dirty changes；本 WP 只在 source manifest 所列 G7-07 scope 上延續修改。
- 沒有 reset、clean、stash、restore、checkout 或 rebase。
- 沒有 stage、commit、push、merge 或 deploy。
- 回滾範圍：移除 G7-07 migration、新增的 Email delivery／suppression service、routes、pages、tests 與導覽入口，並還原 manifest 中共享檔案的 G7-07 hunks；不得覆蓋其他 ownership。
- migration 尚未套用至正式或 staging DB；目前不需要外部 rollback。

## 下一個最高產品價值工作

G7-08 Live Studio sellable closure：統一 create/edit 五步、逐步草稿、refresh recovery、optimistic conflict、preview／publish 分離，以及每個 async 操作的 pending／success／failure／accessibility feedback。Chrome 阻擋保持獨立，不卡住本地產品工作。
