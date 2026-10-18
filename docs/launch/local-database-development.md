# 本機資料庫與測試啟動

`npm run db:check` 是唯讀的本機 schema 檢查，用來確認本機資料庫是否落後於 `prisma/migrations`。請由已核准的工作階段環境注入本機 `DATABASE_URL` 後再執行；此檢查不載入 `.env*`，避免工具間載入順序不同而檢查錯誤的資料庫。只放在 `.env` 的設定會得到明確的注入提示。不要把正式連線交給這個命令。

允許 loopback 的 `celebratedeal_dev`、`celebratedeal_test`、`celebratedeal_e2e`、`celebratedeal_ci` 及既有 WP CI 名稱；不接受遠端主機。檢查只讀取 migration metadata，不自動 migrate 或 seed。

若缺 migration、校驗碼不符、出現其他版本或套用未完成，請使用本 revision 的全新 disposable DB 建立基線（`prisma migrate deploy`）；不要對已有殘留資料的 dev/test DB 自動套用。Migration 數量以當前原始碼 inventory 為準，不固定數字。

`npm run db:seed`（`prisma/seed.ts`）只寫入合成資料，且拒絕非 loopback 資料庫；可在剛 `migrate deploy` 的全新資料庫上直接執行。

測試命令：

- `npm test`：完整 Vitest 測試集合（不會自動執行 `db:check`）。
- `npm run test:unit`：排除檔名為 `.db.test.ts` 的資料庫測試；不代表完整驗收。
- `npm run test:db`：先執行 `db:check --test`，再跑 `.db.test.` 測試。
- `npm run test:db:concurrency`：既有獨立 race tests，仍須另外執行。
- `npm run test:contracts`：既有 Node TAP contracts，仍須另外執行。

`db:check --test` 與 Vitest 共用相同 URL 解析器。未注入 test URL 或沿用舊 `file:` 值時使用既有 loopback test 預設。有注入 `DATABASE_URL` 時，測試會沿用該設定；從開發切換到測試前，必須注入專用 disposable test URL，不能沿用互動開發資料庫。所有測試與 coverage assertions 維持原有強度。任何單層成功都不能代替完整 CI 或 WP 驗收。
