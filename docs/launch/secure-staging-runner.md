# CelebrateDeal Secure Staging Runner

## 目的

此 runner 讓受保護的 GitHub Actions job 使用 staging database credential，完成
目前 RC staging DB `public` schema 的唯讀 migration history 查核與隔離 backup/restore。Secret 不會交給 Codex、寫入
repository、command arguments、log、receipt 或 artifact。

它不授權 Production、付款、退款、migration write、deployment、alias mutation、
資料刪除或任意 command。

## 信任邊界

Workflow 只有在以下條件全部成立時才會執行：

1. `.github/workflows/secure-staging-validation.yml` 已合併至受保護的預設分支
   `master`。
2. GitHub 回報該分支受保護（`github.ref_protected == true`）。
3. Job 綁定 GitHub Environment `Preview – celebrate-deal-staging`。
4. GitHub deployment receipt 唯一對應固定 source SHA `9193326824b8b6bf774bdfa28e4783a1a1b8f304`、Preview hostname、
   成功狀態與 non-Production environment。
5. `STAGING_DATABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_URL` 對應同一個 Supabase
   project identity。
6. 固定 task 為 `wp2-readonly-restore`。

Feature branch 無法透過修改 workflow 或 runner 取得 Secret。Trusted runner
只會從上述 exact source commit 讀取 migration SQL inventory，不會執行該 commit 的
產品程式或任意 script。

Migration manifest 的數量、名稱與 checksum 由該 commit 的 `prisma/migrations`
逐一讀取並核對；不預設 staging 已套用數量。已套用的 migration 必須是此 manifest
的有效子集，且不得有未解決失敗或未知 checksum。當資料庫尚未追平 manifest 時，
receipt 的 migration status 為 `BACKUP_READY_MIGRATIONS_PENDING`。此時整體
`PASS` 僅證明目前資料庫的備份、隔離還原及查核成功，不能當作 migration 完成驗收。

## GitHub Environment 設定

在 `Preview – celebrate-deal-staging` 設定：

- Secret：`STAGING_DATABASE_URL`
- Variable：`NEXT_PUBLIC_SUPABASE_URL`
- Variable：`STAGING_BACKUP_AGE_RECIPIENT`，獨立 staging age 公鑰；不得使用 repo 的 Production recipient。

Lineage 使用 workflow 的短效、唯讀 `GITHUB_TOKEN`，不需要 Vercel Token。

## 執行與網路邊界

依賴安裝、contract tests 與 PostgreSQL image pull 都在注入 Secret 前完成。
Secret-aware step 只允許連線：

- GitHub Deployments API（TCP 443）
- exact Vercel Preview hostname（TCP 443）
- staging Supabase database hostname 與指定 port

Runner 的 IPv4/IPv6 OUTPUT policy 在 child process 執行期間為 fail-closed；來源 database
工具使用 host network，隔離 restore container 使用 `--network none`、tmpfs 與
一次性 ownership label。

來源 database 的第一個 transaction 是 `BEGIN READ ONLY`。允許的 staging 操作只有 SELECT 與 `pg_dump`；
所有 restore writes 只發生在 disposable PostgreSQL。

## Receipt

WP2 僅允許上傳這兩種固定檔案：

`$RUNNER_TEMP/celebratedeal-secure-receipts/wp2-readonly-restore-receipt.json`

`$RUNNER_TEMP/celebratedeal-secure-receipts/wp2-readonly-restore.dump.age`

Canonical validator 會拒絕 symlink、Runner temp 外路徑、額外 schema 欄位、URL、
credential、raw rows、raw dump、staging database writes 與超出 budget 的 side
effects。WP2 receipt 與加密 archive 的 artifact 都保留 30 天。

WP2 會在原始 dump 刪除前，以獨立 staging recipient 加密，驗證密文格式與
SHA-256，另將固定 `.dump.age` 檔上傳為 30 天的加密 artifact。密文上傳前會再次
核對固定路徑、receipt digest 與 age 格式；不會上傳原始 dump。receipt 的
`retention.recoverability` 固定為 `NOT_PROVEN`，`migrationAuthorization` 固定為
`BLOCKED`：公鑰加密與 artifact 上傳無法證明離線私鑰仍可解密。必須由授權持有者
下載密文、以對應私鑰離線解密並在隔離 PostgreSQL 實際還原、核對 checksum 和
資料摘要，另形成可審查的 recovery evidence，才可討論 staging migration。

原始 dump 只在這次 runner 的隔離暫存區存活，結束時會清除；PASS 證明當次
`public` schema 的邏輯備份可以還原到一次性 PostgreSQL，並留下加密備份。
真正套用 pending migration 前，仍須證明密文可由離線私鑰解密並重新還原，
不能只引用這份 receipt。

## 啟用順序

1. 透過 PR 將 workflow、runner、tests 與本文件合併到 `master`。
2. 沿用既有 `master` branch protection 與受保護 Preview Environment；既有
   staging DB／Supabase 綁定已由受保護 run 驗證，不要求重新提供。
3. 為此新 gate 確認有獨立的 `STAGING_BACKUP_AGE_RECIPIENT` 公鑰 Variable，
   且對應私鑰由授權持有者安全保管；不得把私鑰貼入 task 或 repository。
4. 確認可從既有受保護 Environment 注入上述 DB Secret 與公開 URL Variable，
   只記錄綁定檢查結果，不列舉或輸出值。
5. 從 `master` 執行 `Secure staging validation`，輸入固定 task、完整 source SHA
   與 exact Preview deployment hostname。
6. 檢視 sanitized receipt，核對加密 artifact 的 SHA-256；由授權持有者完成離線解密及還原證明。

新公鑰綁定未驗證或解密還原尚未實測時，保留備份 gate 不得成為 migration
授權。舊的隔離還原演練 [run 36059754159](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36059754159)
已通過，但當時會刪原始 dump，不能替代這份新密文的回復證據。

## 無 Secret 的本機驗證

```powershell
npm run secure:staging:contract
npm run secret:scan
```

`npm run secure:staging:wp2` 只保留給核准的 GitHub Environment runner，不得透過
`.env*`、`vercel env pull` 或 `vercel env run` 執行。
