# CelebrateDeal Staging 邏輯備份與還原演練紀錄

演練日期：2026-07-22  
範圍：CelebrateDeal Staging 與暫存本機 PostgreSQL 17 container

## 結果

演練通過。已從 Staging Session Pooler 建立加密邏輯備份，並還原到全新、隔離、記憶體暫存的 PostgreSQL 17 target。全程未操作 Production、付款、退款、Vercel Production 或正式 Supabase target project。

| 驗收項目 | 結果 |
| --- | --- |
| Staging 來源可讀性 | 通過 |
| roles、schema、public data 加密邏輯備份 | 通過 |
| SHA-256 manifest | 通過 |
| Prisma migration history | 通過，`public._prisma_migrations` 已包含於 public data dump |
| 還原到隔離 PostgreSQL 17 target | 通過 |
| `npm run db:migrate:status` | 通過 |
| 非敏感 aggregate 完整性比較 | 通過 |
| RTO | 8.51 秒，僅代表本機暫存 target |
| temporary target 清理 | 通過 |

## 安全處理

- 長期保留的檔案只有 repository 外的 GPG symmetric AES-256 加密 dump 與非敏感 manifest。
- 連線字串、密碼、token、SQL 原文與資料列內容沒有寫入 Git、報告或聊天紀錄。
- 加密金鑰只保留於本機忽略的環境檔；上線前必須放入受控的密碼管理工具，否則遺失金鑰後備份無法復原。
- 未加密 SQL 只存在於記憶體暫存區，驗證後已移除。temporary Docker target 已刪除，無法從該 target 復原資料。

## 驗收方法

1. 建立 roles、public schema 與 public data 三份邏輯 dump。
2. 使用檔案描述元傳入金鑰加密 dump，不將金鑰放入 command line 或 log。
3. 在全新 PostgreSQL 17 target 預先建立最低限度的 Supabase 相容 no-login roles，避免 schema 還原因 role dependency 中斷。
4. 還原後執行 Prisma migration status。
5. 以穩定資料表 key 正規化 aggregate 結果，驗證租戶、帳務、付款、退款、webhook、audit 與 Prisma history 的資料完整性。不同 database collation 的輸出排序不納入比較。

## 已知限制

這是 Staging 邏輯備份與 PostgreSQL SQL 還原證據，不是 Supabase 平台級 project restore 證據。Free organization 目前沒有可用的第三個隔離 Supabase project；本次依照不升級方案的限制，不建立新 project，也不變更方案。

Supabase Storage 實體物件與 Cloudflare Stream 影片不包含於 PostgreSQL logical dump，仍需依各自的外部服務復原策略盤點。
