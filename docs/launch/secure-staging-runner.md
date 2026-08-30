# CelebrateDeal Secure Staging Runner

## 目的

此 runner 讓受保護的 GitHub Actions job 使用 staging database credential，完成
WP2 的唯讀 migration status 與隔離 backup/restore。Secret 不會交給 Codex、寫入
repository、command arguments、log、receipt 或 artifact。

它不授權 Production、付款、退款、migration write、deployment、alias mutation、
資料刪除或任意 command。

## 信任邊界

Workflow 只有在以下條件全部成立時才會執行：

1. `.github/workflows/secure-staging-validation.yml` 已合併至受保護的預設分支
   `master`。
2. GitHub 回報該分支受保護（`github.ref_protected == true`）。
3. Job 綁定 GitHub Environment `Preview – celebrate-deal-staging`。
4. GitHub deployment receipt 唯一對應輸入的完整 source SHA、Preview hostname、
   成功狀態與 non-Production environment。
5. `STAGING_DATABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_URL` 對應同一個 Supabase
   project identity。
6. 固定 task 為 `wp2-readonly-restore`。

Feature branch 無法透過修改 workflow 或 runner 取得 Secret。Trusted runner
只會從 exact source commit 讀取 migration SQL inventory，不會執行該 commit 的
產品程式或任意 script。

## GitHub Environment 設定

在 `Preview – celebrate-deal-staging` 設定：

- Secret：`STAGING_DATABASE_URL`
- Variable：`NEXT_PUBLIC_SUPABASE_URL`

Lineage 使用 workflow 的短效、唯讀 `GITHUB_TOKEN`，不需要 Vercel Token。

## 執行與網路邊界

依賴安裝、contract tests 與 PostgreSQL image pull 都在注入 Secret 前完成。
Secret-aware step 只允許連線：

- GitHub Deployments API（TCP 443）
- exact Vercel Preview hostname（TCP 443）
- staging Supabase database hostname 與指定 port

Runner 的 OUTPUT policy 在 child process 執行期間為 fail-closed；來源 database
工具使用 host network，隔離 restore container 使用 `--network none`、tmpfs 與
一次性 ownership label。

來源 database 的第一個 transaction 是 `BEGIN READ ONLY`，且 `PGOPTIONS` 強制
`default_transaction_read_only=on`。允許的 staging 操作只有 SELECT 與 `pg_dump`；
所有 restore writes 只發生在 disposable PostgreSQL。

## Receipt

唯一可上傳檔案為：

`$RUNNER_TEMP/celebratedeal-secure-receipts/wp2-readonly-restore-receipt.json`

Canonical validator 會拒絕 symlink、Runner temp 外路徑、額外 schema 欄位、URL、
credential、raw rows、raw dump、staging database writes 與超出 budget 的 side
effects。Artifact 保留七天。

## 啟用順序

1. 透過 PR 將 workflow、runner、tests 與本文件合併到 `master`。
2. 啟用 `master` branch protection，禁止未經 review 的直接推送。
3. 將 GitHub Environment 限制為 protected branches；方案允許時加入 required
   reviewer。
4. 由真人在 GitHub Settings 設定上述一個 Secret 與一個 Variable，值不得貼入
   task。
5. 從 `master` 執行 `Secure staging validation`，輸入固定 task、完整 source SHA
   與 exact Preview deployment hostname。
6. 只檢視 sanitized receipt artifact。

步驟 1～4 尚未完成前，workflow 會故意保持不可執行，不得視為 release evidence。

## 無 Secret 的本機驗證

```powershell
npm run secure:staging:contract
npm run secret:scan
```

`npm run secure:staging:wp2` 只保留給核准的 GitHub Environment runner，不得透過
`.env*`、`vercel env pull` 或 `vercel env run` 執行。
