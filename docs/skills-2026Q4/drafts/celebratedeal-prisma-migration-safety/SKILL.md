---
name: celebratedeal-prisma-migration-safety
description: 新增或修改 Prisma schema、migration SQL、索引、CHECK、RLS、資料回填，或要對資料庫執行 prisma migrate 時使用；規範前向手寫 migration、drift 防護、鎖與 NOT VALID 流程，以及 PRISMA_INVARIANTS 登記。
---

# CelebrateDeal Prisma Migration 安全

## 何時用
動到 `prisma/schema.prisma`、`prisma/migrations/**`、`prisma.config.ts`、DB 相關 script，或任何會連資料庫的 migrate／seed／backfill 指令時。

## 必讀文件
- `AGENTS.md`（Migration 只能往前；新增 model 或 migration 要同步登記）。
- `docs/codex-goal/PRISMA_INVARIANTS.md`（登記位置）。
- `docs/review-2026Q4/14-data-migration.md`（B04 發現）。
- `docs/production-database-runbook.md`、`docs/launch/staging-migration-apply.md`、`docs/launch/local-database-development.md`。

## 檢查清單
- [ ] 只新增前向 migration；不改已套用的舊 migration、不寫 down、不 `DROP TABLE`／`DROP COLUMN`／`TRUNCATE`。
- [ ] migration SQL 手寫並逐行審閱；**不提交 `prisma migrate dev` 的自動輸出**，因為 schema 與 DB 有漂移（B04-04），自動 diff 可能拔掉 DB 才有的物件。
- [ ] partial unique index 與 pg_trgm GIN 索引（schema 無法表達）要保留在 allowlist；schema 若無法宣告，就在 migration 與 INVARIANTS 註明，並確認 `migrate dev` 不會 drop 它們。
- [ ] 新增 CHECK 或 FK 到熱表：先 `ADD CONSTRAINT … NOT VALID`，另一個步驟再 `VALIDATE CONSTRAINT`；索引在熱表用 `CREATE INDEX CONCURRENTLY`（需獨立 migration、不可在交易內）；加 `lock_timeout`。
- [ ] 帳務表（金額、狀態、退款、結算）新增 CHECK：金額不為負、`refunded <= gross`、status 限定集合（B04-07）。
- [ ] 新表啟用 RLS 並說明政策；不假設只靠 revoke（B04-08）。
- [ ] `SET NOT NULL` 前先回填，或有 `RAISE EXCEPTION` 前置檢查；唯一索引前先跑重複資料 preflight。
- [ ] 外鍵對財務表用 `Restrict`／`NoAction`，不用對 Vendor 的 `CASCADE`（B04-02）。
- [ ] 新增 model 或 migration 目錄，同步登記到 `docs/codex-goal/PRISMA_INVARIANTS.md`，並跑 `scripts/prisma-invariant-inventory.test.ts`。
- [ ] migration 時間戳大於 master 上所有現存目錄（B04-09）。
- [ ] 擴充用 schema 限定寫法（`extensions.gin_trgm_ops`）。

## 禁止事項
- 對非 loopback、非 `celebratedeal_*` 的資料庫執行 `migrate dev`、`migrate reset`、seed 或 backfill；不讀 `.env*` 取得連線字串。
- 對 staging／Production 手動 `migrate deploy`；staging 只走受保護 workflow，Production 需 owner 另行授權。
- 手改 `_prisma_migrations` 表，或用 `migrate resolve` 掩蓋失敗而不留紀錄。

## 完成證據
可拋棄 loopback DB 上 `migrate deploy` 全鏈套用的輸出（migration 數、exit code）、`prisma migrate diff` 無預期外 drop、DB 測試結果、INVARIANTS 變更 diff。沒有可用 DB 時標 BLOCKED，不標 PASS。
