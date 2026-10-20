# PR #452 第三輪複審：commit e1eb71bc（改為依 schema 判斷）

- 範圍：`git diff e66045e6..HEAD`（HEAD = `e1eb71bc`），共 5 個檔案，+78／−33
- 對照：`33-pr452-rls-review.md`、`33-pr452-rls-rereview.md`（BLOCKER-N1）
- 日期：2026-10-20；審查者：reviewer（Opus），只讀

## 驗證證據

| 項目 | 結果 |
|---|---|
| e66045e6 的 CI（run 39395365160） | `Unit tests and coverage thresholds` 成功，代表 migrate 前建立 role 的 fixture 在 combined coverage 中可用，MINOR-1 確認關閉。`PostgreSQL concurrency tests` 失敗，原因與上一輪預測一致：`wp18-main` 兩個新測試查 `public` 得到空結果（`expected {} …`、`expected [] …`）。 |
| e1eb71bc 的 CI（pull_request run 39397046939） | `Migration name order`、`Prisma schema drift against migrations`、`Unit tests and coverage thresholds`、**`PostgreSQL concurrency tests` 都成功**。審查結束時，之後的 browser 與 build 步驟仍在執行，整體 `quality` 的最終結果我沒有看到。 |

## 指定確認點

1. **Supabase staging／production 上的 `current_schema()` 是 `public`**
   - Prisma 會依連線 URL 的 `?schema=`（沒有時預設 `public`）設定 `search_path`。CI 的 `wp17_ci`／`wp18_ci` 一直能把沒有 schema 前綴的 DDL 建到指定 schema，正說明 migrate 時 `search_path` 確實被設成該 schema。因此 Supabase 上帶 `?schema=public` 時，`current_schema()` = `public`，目標與前一版寫死 `public` 時完全相同。
   - 就算有人在 Supabase SQL editor 手動執行（`search_path` 為 `"$user", public, extensions`），只要沒有名為 `postgres` 的 schema，結果仍是 `public`。
   - 如果 `search_path` 解析到不存在或不是本專案的 schema，就落入下面第 3 點的 RAISE 處理，屬於 fail closed。
2. **CI 的 `wp18_ci` 與 shadow 庫**
   - `wp18_ci`：migration 會對 `wp18_ci` 中所有未啟用 RLS 的表（含 `_prisma_migrations`）啟用 RLS。測試也以 Prisma Client 連線的 `current_schema()`（`wp18_ci`）作為目標。
   - `pg_get_indexdef` 一律會在表名前加 schema；opclass 與 enum 型別在 `search_path` 內可見時則不加前綴。CI 中 `pg_trgm` 裝在 `wp18_ci`，`search_path` 也是 `wp18_ci`，所以預期字串只需替換表的 schema。CI 實跑通過，與這個分析一致。
   - 在 `wp18_ci` 中，anon／authenticated 是 fallback 建立的，所以只能證明 RLS 與 PUBLIC 兩部分。真正的 Data API role 斷言由 combined coverage（`public` 加上 fixture）負責，兩條路徑分工清楚。
   - shadow 庫：drift check 的 shadow URL 是 `?schema=public`，重放到這條 migration 時，`Vendor` 早已由 baseline 建立，所以會正常執行，CI 的 drift 步驟也成功。`migrate dev` 的 shadow 庫同理。以 `Vendor` 取代 `_prisma_migrations` 作為判斷依據是正確的。
3. **「沒有 `Vendor` 就中止」用的是 `RAISE EXCEPTION`，不是靜默 return**
   - 程式在 `migration.sql` 的 DO 區塊開頭：`IF target_schema IS NULL OR NOT EXISTS (… relname = 'Vendor' …) THEN RAISE EXCEPTION … END IF;`。
   - 這樣 Prisma 會把 migration 記為 failed，不會出現「記為已套用但其實沒做事」的情況。發生時，依 runbook 的 `migrate resolve --rolled-back` 修正連線 schema 後重跑即可。
   - 正常部署不會誤觸：所有環境的 migration 歷史都從建立 `Vendor` 的 baseline 開始，`Vendor` 是核心租戶表，目前沒有任何 rename 或 drop。判斷時有限定 `relkind IN ('r','p')` 與目標 schema，不會被其他 schema 的同名物件誤導。
   - 唯一的長期風險：將來如果有 migration 把 `Vendor` 改名，用全新資料庫重放到這一條時仍然正確，因為改名發生在這一條之後。所以這個風險不存在。

## 原 findings 與 BLOCKER-N1 狀態

| # | 狀態 |
|---|---|
| BLOCKER-N1（concurrency 套件寫死 `public`） | **已修正**，CI 的 `PostgreSQL concurrency tests` 已通過。沒有用排除測試的方式處理，兩條路徑都有實際斷言，比我原本的建議更完整。 |
| MAJOR-1、MAJOR-2、MINOR-1、2、4、5、6、NIT-1、2、4 | 維持上一輪的「已修正」。MINOR-1 已有 CI 實跑證據。 |
| MINOR-3、NIT-3 | 維持延後，已列入 runbook §4。 |
| NIT-N2（`HEAD^1` 只檢查最後一個 commit） | 未處理，維持 NIT，不阻擋合併。 |

## 本輪新 findings

| # | 等級 | 位置 | 說明 | 建議 |
|---|---|---|---|---|
| NIT-R3-1 | NIT | `docs/operations/prisma-migration-guards-runbook.md` §1.1 的兩段前置查詢 | 查詢仍寫死 `schemaname = 'public'`。在 Supabase 上是正確的，但與 migration 改用 `current_schema()` 的寫法不一致。 | 可改為 `schemaname = current_schema()`，或加註「Supabase 為 public」。 |
| NIT-R3-2 | NIT | `migration.sql`（本 PR 三個 commit 都修改過內容） | 這條 migration 的 checksum 在三個 commit 之間都有變動。只要它從未套用到 staging 或任何共用環境就沒有影響（依先前資訊，目前尚未套用）。 | 合併前確認 staging 的 `_prisma_migrations` 中沒有 `20261020090000_enable_rls_all_tables`。 |

BLOCKER、MAJOR、MINOR：無。金流、租戶邊界與 auth 層級：無新的 finding。

## 判定

三個確認點都成立：Supabase 上的目標是 `public`；`wp18_ci` 與 shadow 庫行為正確；中止使用 `RAISE EXCEPTION`，不會靜默 return。BLOCKER-N1 已修正，CI 中與本 PR 相關的步驟全部通過。合併前請確認 `quality` 整體結果為綠燈，並完成 NIT-R3-2 的 staging 確認。

**結論：可合併。**
