# CelebrateDeal Production 自管備份／還原 Runbook

適用於 Supabase Free Plan 無 managed project backups 的期間。本方案使用加密邏輯備份，不取代正式收費後應評估的 provider-managed backups 或 PITR。

## 安全界線

- 僅可使用 Production 的 `DIRECT_URL`，並由 SecretManagement 或 Windows Credential Manager 在執行期注入。Credential Manager 使用時，完整連線字串僅放在 credential password 欄位。
- 禁止把連線字串、密碼、token、age 私鑰、備份檔或解密檔提交至 Git、寫入腳本或放入 log。
- 備份目的地必須是既有的 off-site、存取控制目的地；不可只保存在同一台執行 Windows 的電腦。
- Google Drive adapter 必須使用專用帳號或專用資料夾，並以 rclone `drive.file` scope 優先限制存取範圍。rclone OAuth config 與 remote path 只能由執行期 secret 注入。
- 還原演練只能對隔離目標進行，絕不可覆蓋 Production。

## 作業節奏

| 項目 | 目標 |
|---|---|
| 每日邏輯備份 | 每日一次，正式販售前至少連續 7 日成功 |
| 付款／migration 前備份 | 每次重大資料變更前 |
| RPO | 初始 24 小時；有常態付款後調整為 4–8 小時 |
| RTO | 初始 60 分鐘內完成隔離 restore 與驗證 |
| 保留 | 7 daily / 4 weekly / 3 monthly |
| 還原演練 | 每月一次，及每次備份工具重大變更後 |

## 驗收順序

1. 先跑 `ops/backup/tests/Test-BackupTooling.ps1`，確認工具只有 plan mode。
2. 管理者在受控終端機設定秘密與 public recipient，並確認 off-site 目的地 ACL。
3. 在明確核准後執行一次加密備份。
4. 離線執行 archive verification：checksum、解密與 `pg_restore --list`。
5. 對隔離 PostgreSQL／獨立 Supabase 專案執行 restore drill，記錄實測 RTO 與 aggregate 一致性。乾淨的本機 PostgreSQL 預設只還原應用程式擁有的 `public` schema；完整加密 archive 仍保留 Supabase 管理 schema，平台層完整還原需使用隔離 Supabase 專案另行演練。
6. 只有上述證據齊全，才可勾選 go-live checklist 的 backup restore gate。

## 保留與告警

- 在第一輪 restore drill 簽核前，只能人工檢視 retention，禁止自動刪除 archive。
- 簽核後才可由備份擁有者依 7 daily / 4 weekly / 3 monthly 規則刪除過期的**加密** archive。
- Task Scheduler 必須設定非零 exit code 的告警；可選 alert handler 僅接收 `Status`、`ArchiveId`、`ErrorCategory`，不可接收或回傳 secret。
- Google Drive adapter 上傳後必須以 rclone checksum check 驗證；驗證失敗不得標記備份成功。

## 何時升級 provider-managed backup

開始正式收費、RPO 低於 24 小時、需要 PITR、無法維護 Windows 排程與異地保存，或 restore drill 未能穩定達到 RTO 時，應改採含 backups 的 Supabase 方案或同等受管備份服務。
