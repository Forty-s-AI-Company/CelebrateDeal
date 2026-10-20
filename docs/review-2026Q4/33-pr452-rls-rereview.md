# PR #452 複審：修正 commit e66045e6

- 範圍：`git diff 431bbde6..HEAD`（HEAD = `e66045e6`），共 13 個檔案，+380／−107
- 對照：`docs/review-2026Q4/33-pr452-rls-review.md`
- 日期：2026-10-20；審查者：reviewer（Opus），只讀。所有實驗都在 scratchpad 的拋棄式 clone 中進行，沒有修改 repo。

## 我實際跑過的驗證

| 項目 | 結果 |
|---|---|
| `node --test scripts/migration-order-check.test.mjs scripts/prisma-drift-check.test.mjs` | 全數通過 |
| `npx vitest run scripts/run-combined-coverage.test.mjs` | 8/8 通過 |
| 以新版 `readHeadMigrations` 讀取含 `20990101000000_AddFoo`、`20990101000000-add-bar`、`2099_x` 的目錄 | 三者都列入 `added`，並以格式錯誤判定失敗，`ok: false` |
| 拋棄式 clone 模擬 squash merge：在 `bd85be87` 上 `merge --squash e66045e6` 後以 `MIGRATION_ORDER_BASE_REF=HEAD^1` 執行 | `ok: true`，`added = [20261020090000_enable_rls_all_tables]`，`latestBase = 20261019120000_user_policy_consent` |
| 同一 clone，把新 migration 改名為較早的 `20261001000000_…` 後再執行 | exit 1，訊息為「must sort after the newest base migration」 |
| 同一 clone，修改既有的 `20261019120000_user_policy_consent/migration.sql` | exit 1，訊息為「existing migration was edited」 |
| 同一 clone，新增 `20990101000000_AddFoo/migration.sql` | exit 1，判定格式錯誤 |
| 前一輪 CI（431bbde6，run 39392626476／39392618659） | **`PostgreSQL concurrency tests` 失敗**，見 BLOCKER-N1 |
| 本輪 CI（e66045e6，run 39395365160／39395359257） | `Migration name order`、`Prisma schema drift` 成功。`Unit tests and coverage thresholds` 在審查結束時仍在執行，`PostgreSQL concurrency tests` 尚未開始，**兩者結果我都沒有確認** |

## 指定確認點

1. **不合格式的目錄會判定失敗，不會被略過**：已確認。`readHeadMigrations` 與 `parseMigrationTree` 都不再依名稱過濾。ls-tree 只取 `tree` 項目，所以 `migration_lock.toml` 不會被當成 migration。如果是非 ASCII 名稱，git 會加引號輸出，與檔案系統上的名稱對不上，結果同樣是判定失敗。
2. **push 到 master 時以 `HEAD^1` 為 base**：squash merge 下的行為正確（上面三組實驗）。merge-base(HEAD, HEAD^1) 就是 HEAD^1，所以 squash commit 中新增的 migration 會落在 `added`，修改既有 migration 也會被 diff 抓到。只在 `push` 且 ref 為 `refs/heads/master` 時才使用 `HEAD^1`，PR 與一般分支仍然使用 `origin/master`。ref 白名單新增了 `^` 與 `~`，但 `spawnSync` 沒有使用 shell，不會有注入風險。
3. **owner 檢查在 staging 會通過，不符時整批中止**：
   - `pg_has_role(current_user, owner, 'USAGE')` 的語意，與 `ALTER TABLE` 實際的 owner 權限判斷（has_privs_of_role，包含 INHERIT 與 superuser）一致，選擇正確。
   - staging（依主對話的唯讀查證）：97 張表的 owner 是 postgres，52 張是 prisma，prisma 擁有的表都已啟用 RLS。因此待處理的表全部屬於 postgres。只要 migration 角色是 postgres，就是檢查自己，結果為 true，會通過。postgres 對 prisma 是否有 USAGE 在這次不影響結果。前提是 staging 的 `DIRECT_URL` 角色確實是 postgres，runbook §1.1 要求部署前以 migration 角色執行查詢確認，staging 與 production 都要做。
   - 不符時：`RAISE EXCEPTION` 發生在第一個 `ALTER` 之前。DO 區塊是單一語句，例外會讓整個交易回滾，不可能部分成功。預檢之後如果有新表併入，`FOR` 迴圈的 `ALTER` 失敗也會讓整個語句回滾，同樣不會部分成功。
4. **在 migrate 之前建立 role，讓斷言真正涵蓋 anon／authenticated**：在 combined coverage 這條路徑上，設計正確。runner 在 `migrate deploy` 之前，以 postgres 建立三個 NOLOGIN 角色，並設定 Supabase 預設的 `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … GRANT ALL`。之後 `20260724150000` 的 `REVOKE ALL ON ALL TABLES FROM anon…` 與 default privileges 的收回都會真正執行。因此：
   - 條件式 `GRANT … TO anon` 會被第 2 條抓到。
   - 條件式 `ALTER DEFAULT PRIVILEGES … GRANT … TO anon` 會被第 4 條（以 postgres 在 public 建立 probe 表）抓到。
   - 條件式 `CREATE POLICY … TO authenticated` 會被第 3 條抓到。

   這條路徑的實跑結果要等本輪 `Unit tests and coverage thresholds` 完成才能確認，我沒有看到結果。另外，同一個測試檔在 `PostgreSQL concurrency tests` 中會失敗，見 BLOCKER-N1。

## 原 findings 狀態

| # | 原等級 | 狀態 | 說明 |
|---|---|---|---|
| MAJOR-1 順序檢查遇到不合規目錄會放行 | MAJOR | **已修正** | 已實測，見上。新增的測試經過 `readHeadMigrations`，也經過真實 git repo。 |
| MAJOR-2 migration 角色的 owner 前置條件 | MAJOR | **已修正** | migration 內建預檢並以 `RAISE EXCEPTION` 列出所有不符的表；runbook §1.1 提供 migration 角色的查詢、staging 現況，以及 MEMBER 與 USAGE 的差別說明。 |
| MINOR-1 rls 測試的 role 在 migrate 之後才建立 | MINOR | **已修正（CI 尚待確認）** | `SUPABASE_DATA_API_ROLE_FIXTURE_SQL` 在 migrate 之前執行。本機在沒有 fixture 的資料庫上，測試會改用 fallback，這個限制已寫在測試與 runbook。 |
| MINOR-2 partial index 只比對名稱 | MINOR | **已修正** | 改為比對完整的 `pg_get_indexdef`，並加上 `indisvalid`。 |
| MINOR-3 11 個租戶 FK 只以名稱守門 | MINOR | **延後（接受）** | runbook §4 已列為後續項目。protected 類別的 stale 訊息已改成「不要刪條目」。 |
| MINOR-4 鎖累積與 deadlock 說明 | MINOR | **已修正** | `lock_timeout` 改為 2s；runbook §1.2 改寫成實際行為，並要求在低流量時段部署。 |
| MINOR-5 改名或修改已套用的 migration | MINOR | **已修正** | runbook 補上「已套用到共用環境就不可改名」；新增既有 migration 內容修改的檢查（已實測）。 |
| MINOR-6 drift check 的盲區 | MINOR | **已修正（文件）** | runbook §3.1 與 allowlist 說明已列出盲區；CHECK constraint 的守門列為後續項目。 |
| NIT-1 push 到 master 時必定通過 | NIT | **已修正** | 改以 `HEAD^1` 為 base，已用 squash 模擬實測。 |
| NIT-2 cluster 層級的 role | NIT | **已修正（文件）** | |
| NIT-3 workflow `permissions:` | NIT | **延後（接受）** | runbook §4 已記錄。 |
| NIT-4 `_prisma_migrations` 的 RLS | NIT | **已修正（文件）** | |

## 新 findings

| # | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| BLOCKER-N1 | BLOCKER | `src/lib/rls-catalog.db.test.ts:40-52`；`src/lib/prisma-unmanaged-indexes.db.test.ts`（`nspname = 'public'`）；`vitest.synthetic-db-coverage.config.ts:93-100`；`.github/workflows/ci.yml:188-208` | `PostgreSQL concurrency tests` 的 `wp18-main` project 會以預設 include 執行**所有**測試檔，資料庫是 `celebratedeal_wp18_ci`，schema 是 `wp18_ci`，migration 也套用在 `wp18_ci`。兩個新測試寫死查 `public`，查到的結果是 `[]`，所以會失敗。前一輪 CI 的 log 已經證實：`× enables row level security on every public table`（`expected [] to deeply equal ArrayContaining`）、`× keeps every partial unique index`（`expected [] …`），`quality` 整體失敗。e66045e6 沒有修改這兩處查詢，也沒有修改 synthetic config，所以本輪幾乎一定會以同樣原因失敗。`quality` 是 master 的必要檢查，不通過就無法合併。另外，RLS migration 本身也只處理 `public`，所以 `wp18_ci` 的表本來就不會被啟用 RLS。 | 建議做法：在 `vitest.synthetic-db-coverage.config.ts` 的 `wp18-main` 排除這兩個檔案，並加註「這兩個是 public schema 的 catalog 閘門，由 combined coverage 執行」。它們在 combined coverage 中照常執行，所以這不算降低覆蓋。另一個做法是把測試與 migration 都改用 `current_schema()`，但 `pg_get_indexdef` 會因 schema 前綴（`wp18_ci."…"`、`wp18_ci.gin_trgm_ops`）而需要正規化，改動比較大，不建議。修正後請確認本輪兩個測試步驟都通過。 |
| NIT-N2 | NIT | `.github/workflows/ci.yml:97` | push 到 master 時以 `HEAD^1` 為 base，只會檢查最後一個 commit。如果一次 push 多個 commit（目前禁止直推，所以影響很小），較早的 commit 不會被檢查。 | 改用 `github.event.before`（不是全零時）為 base。 |

金流、租戶邊界與 auth 層級：本次修正沒有新增相關程式，沒有新的 finding。

## 判定

原本兩項 MAJOR 與所有 MINOR、NIT 都已修正，或以合理理由延後，指定的四個確認點邏輯也都正確。但新發現的 BLOCKER-N1 讓必要檢查 `quality` 在 `PostgreSQL concurrency tests` 失敗。修正後需要確認本輪 `Unit tests and coverage thresholds` 與 `PostgreSQL concurrency tests` 都通過；複審只需看 synthetic config 的排除與 CI 結果。

**結論：需修正後再審。**
