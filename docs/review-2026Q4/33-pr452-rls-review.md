# PR #452 獨立審查：全表 RLS、migration 順序與 drift 檢查

- 分支：`codex/beta-l1-lineB-rls`，commit `431bbde6`，worktree `CelebrateDeal-wt-lineB`
- 範圍：`git diff origin/master..HEAD`（merge base = origin/master = `bd85be87`），11 個檔案，+1344 行
- 背景：`14-data-migration.md` B04-04、B04-08、B04-09；`12-tenant-auth.md` B02-03
- 審查日期：2026-10-20；審查者：reviewer（Opus），只讀，沒有修改程式

## 我實際跑過的驗證

| 項目 | 結果 |
|---|---|
| `node --test scripts/migration-order-check.test.mjs scripts/prisma-drift-check.test.mjs` | 15/15 通過 |
| `npx vitest run scripts/prisma-invariant-inventory.test.ts` | 1/1 通過（新 migration 已登記） |
| 目錄／model 數 | 110 個 migration 目錄、149 個 model，與 PRISMA_INVARIANTS 的記載一致 |
| 以 scratchpad 假目錄探測 `readHeadMigrations` | `20990101000000_AddFoo`、`20990101000000-add-bar`、`2099_x` 全部被過濾，`ok: true`（見 MAJOR-1） |
| CI push run 39392618659 | `Migration name order`、`Apply database migrations`、`Prisma schema drift against migrations` 皆 success（CI 是 PG16，allowlist 是在 PG17.10 產生的，沒有出現版本造成的假陽性） |
| CI pull_request run 39392626476 | 上述三步加 Lint、Typecheck 皆 success；**`Unit tests and coverage thresholds`（含 `rls-catalog.db.test.ts`、`prisma-unmanaged-indexes.db.test.ts`）在審查結束時仍在執行，我沒有確認它通過** |
| master branch protection | `required_status_checks.strict = true`，contexts = `quality` |

我沒有在本機 PostgreSQL 跑兩個 `.db.test.ts`，也沒有連 staging。

## 各層結論

1. **金流**：本 PR 沒有改金額、checkout、webhook、退款或佣金程式。這一層沒有發現問題。
2. **租戶邊界**：本 PR 是防禦縱深。migration 不建立 policy、不加 `FORCE`、不改 grant。repo 沒有使用 supabase-js 或 anon key，所以 Data API 角色在無 policy 下預設拒絕，不影響 app。這一層沒有 BLOCKER。11 個租戶 FK 的保護強度見 MINOR-3。
3. **Auth／權限**：沒有異動。沒有發現問題。
4. **資料／migration**：DO 區塊的邏輯正確。有一個部署前置條件沒有寫進 runbook（MAJOR-2）。
5. **正確性／測試**：順序檢查遇到不合規的目錄名稱時會直接放行（MAJOR-1）。另有數個測試強度不足的 MINOR。

## 重點題逐項回覆

**(1) `20261020090000_enable_rls_all_tables` 的 DO 區塊**
- 部分已啟用：只處理 `NOT relrowsecurity`，可重跑。全部已啟用時不做任何事。正確。
- 表數變動：迴圈執行時才查 catalog，沒有寫死表數。正確。
- 名稱含大寫或特殊字元：`format('ALTER TABLE public.%I …')` 會正確加引號（`"CommerceOrder"`），內含 `"` 也會跳脫。schema 固定是 `public`。正確。
- 不建立 policy、不改 grant、不用 FORCE：確認。
- `lock_timeout`：`set_config(..., true)` 只在交易內有效。Prisma 以單一 implicit transaction 執行腳本，設定不會外洩到 session。但「每張表最多等 5 秒」不代表其他請求不用排隊，見 MINOR-4。
- 擁有者：`ALTER TABLE … ENABLE RLS` 需要 owner 權限，BYPASSRLS 不夠。staging 的表分屬 postgres 與 prisma，見 MAJOR-2。

**(2) 兩個 db test 能否擋住回歸**
- `rls-catalog` 第 1 條（每張表 `relrowsecurity`）有效，還附帶防止空庫誤判通過的檢查。之後新增的表如果漏開 RLS，一定會失敗。
- 第 2～4 條在 CI 中幾乎只檢查 PUBLIC：anon 與 authenticated 是在 migrate **之後**才建立的，migration 中「角色存在才 GRANT／ALTER DEFAULT PRIVILEGES」這類條件式寫法在 CI 永遠不會觸發（MINOR-1）。
- `prisma-unmanaged-indexes` 只檢查名稱、unique 與 partial，沒有檢查欄位和 predicate（MINOR-2）。

**(3) `migration-order-check.mjs`**
- rebase 後改名：PR 自己新增、尚未進 master 的目錄可以改名，不會誤報。merge base 已有的目錄被改名或刪除時會擋下。已經套用到共用環境之後再改名的情況，見 MINOR-5。
- 同秒兩個 migration：排序鍵是「時間戳 + 名稱」。後到者的後綴字典序較大就通過，較小就失敗。這和 Prisma 依目錄名排序的套用順序一致，正確。
- master 沒有新 migration，或 PR 沒有 migration：`added = []`，通過，正確。
- 讀取 master：checkout 用 `fetch-depth: 0`，所以 `origin/master` 與 merge-base 都在。ref 不存在時 fail closed。pull_request 事件的 HEAD 是 merge ref，merge-base 等於 master tip，行為正確。master 開了 strict up-to-date，兩個 PR 交錯合併的競態已被擋住。
- 漏洞：不符合 pattern 的目錄會被直接忽略（MAJOR-1）。

**(4) `prisma-drift-check.mjs`**
- 比對方式是集合比對，與輸出順序無關；空白會正規化；`--` 註解行會切開語句。PG16 的 CI 實跑與 PG17 產生的 allowlist 完全吻合，名稱截斷是固定的 63 bytes。我沒有看到版本或排序造成的假陽性。
- 假陰性：Prisma 6 本來就不比對 CHECK、partial index、trigger、function、RLS、grant（MINOR-6）。11 個 FK 只用名稱比對（MINOR-3）。
- 11 個會被 drop 的 FK：**建議升級成獨立的後續項目**，但不阻擋本 PR。理由：本 PR 已讓「某個 migration 刪掉它們」在 CI 中以 stale 失敗，風險比 PR 前低。不過守門強度只到「名稱存在」，而且 stale 的錯誤訊息會引導開發者去刪 allowlist 條目，見 MINOR-3。

**(5) CI 的 permissions 與 secrets**：新步驟沒有使用任何 secrets。DSN 是 job env 中的 CI fixture 帳密（postgres:postgres，屬於 disposable 容器）。沒有 `set -x`，不會印出連線字串。shadow DB 有 loopback 與 DB 名稱白名單雙重限制，Prisma 的所有 URL 都被釘到 shadow。workflow 沒有頂層 `permissions:`，這是既有狀況，不是本 PR 造成的（NIT-3）。

**(6) 文件與 PRISMA_INVARIANTS**：新 migration、兩個 db test、allowlist 基準、模型與 migration 數量都已登記，inventory test 通過。缺漏的部分見 MAJOR-2、MINOR-4、MINOR-5、MINOR-6。

## Findings

| # | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| MAJOR-1 | MAJOR | `scripts/migration-order-check.mjs:22`、`:88-92`（`readHeadMigrations`）；測試 `scripts/migration-order-check.test.mjs:80` | HEAD 的目錄先用寬鬆的 `EXISTING_MIGRATION_PATTERN` 過濾，所以 `20261001000000_AddFoo`、`20261001000000-add-foo`、`2026100100_x` 這類名稱根本不會進入 `added`。`NEW_MIGRATION_PATTERN` 的格式檢查與順序檢查都不會執行，`ok: true`（已用假目錄實測）。Prisma 會套用任何含 `migration.sql` 的目錄，因此手寫 migration 只要用了 camelCase 或連字號，就能用比 master 更早的時間戳合併，正好重現 B04-09 的「staging 與全新環境 DDL 順序不同」。第 80 行的測試直接呼叫 `evaluateMigrationOrder`，沒有經過這層過濾，所以沒有發現這個漏洞。 | `readHeadMigrations` 改為回傳所有含 `migration.sql` 的目錄（不套 pattern），讓不合規名稱落進 `added` 後被 `NEW_MIGRATION_PATTERN` 擋下。`parseMigrationTree` 也同樣改成不過濾，只排除 `migration_lock.toml`。補一個用暫存目錄跑 `readHeadMigrations` 的測試。 |
| MAJOR-2 | MAJOR | `docs/operations/prisma-migration-guards-runbook.md:14-17`；`prisma/migrations/20261020090000_enable_rls_all_tables/migration.sql:47-51` | `ENABLE ROW LEVEL SECURITY` 要求執行者是表的 owner，或繼承 owner 角色；BYPASSRLS 不夠。staging 的表分屬 postgres 與 prisma 兩個 owner。如果 `migrate deploy` 使用的角色（DIRECT_URL）不是某張「尚未啟用 RLS」表的 owner，也沒有繼承該 owner，整個 DO 區塊會以 `must be owner of table` 失敗。這個失敗是原子的，不會留下部分狀態，但 `_prisma_migrations` 會留下 failed 紀錄，之後所有 deploy 都會卡住，直到有人手動 resolve。runbook 的前置檢查只確認「應用程式角色讀得到資料」，沒有確認「migration 角色改得了表」。 | runbook 增加一條前置唯讀查詢，**以 migration 角色執行**：`select c.relname, pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity and not pg_has_role(current_user, c.relowner, 'USAGE');`，預期 0 列。staging 與 production 都要列入部署 checklist 和 OWNER-ACTIONS，並寫下失敗後的 `migrate resolve --rolled-back` 步驟（目前只寫在 lock_timeout 情境下）。 |
| MINOR-1 | MINOR | `src/lib/rls-catalog.db.test.ts:20-35`、`:53-104`；`scripts/run-combined-coverage.mjs`；`.github/workflows/ci.yml:31-56` | CI 與 coverage runner 的 PG 是在沒有 anon／authenticated 的狀態下跑 migrate，測試之後才建立這兩個角色。新角色天生沒有權限，也沒有 default ACL，因此第 2～4 條在 CI 中只會抓到「授權給 PUBLIC」的回歸。如果某個 migration 寫的是「角色存在才 `GRANT … TO anon`」、「角色存在才 `CREATE POLICY … TO authenticated`」或 `ALTER DEFAULT PRIVILEGES … GRANT … TO anon`，在 CI 不會觸發，在 Supabase 會生效，測試依然通過。runbook 第 19 行說「會斷言四點」，這個說法過於樂觀。 | 在 CI 的 disposable PG 與 `run-combined-coverage.mjs` 中，於 **migrate 之前**建立 anon、authenticated、service_role，並模擬 Supabase 預設的 `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`。這樣 `20260724150000` 的收回才會真正被驗證，第 2～4 條也能抓到條件式授權。 |
| MINOR-2 | MINOR | `src/lib/prisma-unmanaged-indexes.db.test.ts:21-33`、`:35-46` | 只比對名稱、`indisunique` 與 `indpred IS NOT NULL`。如果有 migration 以同名重建索引，但改了欄位或 predicate（例如把 `ConsultationBooking_active_slot_key` 的 `status IN (...)` 條件改窄，或少一個欄位），業務唯一性保證就變了，測試仍然通過，drift check 也看不到。trgm 測試只檢查 `indclass[0]`，沒有檢查是哪個欄位。 | 改成比對 `pg_get_indexdef(indexrelid)` 的完整字串（以 migration 原文為準）。 |
| MINOR-3 | MINOR（建議另開後續項目） | `scripts/prisma-drift-allowlist.json`（`foreign_key_missing_in_schema` 11 條、`foreign_key_shape_mismatch` 3 條）；`scripts/prisma-drift-check.mjs:86-90`、`:142` | 11 個租戶綁定或複合 FK（`Live_vendorId_formId_fkey`、`PostPurchaseCredit_grant_fkey`、`SupportCaseEvent_buyer_case_order_fkey` 等）只以 `DROP CONSTRAINT "<name>"` 的名稱比對。① 如果 migration 以同名重建 FK，但改成單欄位、拿掉 `vendorId`，diff 仍然輸出同一句 DROP，check 通過，租戶綁定就消失了。② 刪除這些 FK 時，CI 錯誤訊息是 "update the allowlist deliberately"，開發者或代理很可能順手刪掉條目，審查一漏看就合併。這兩點都會削弱 DB 層的租戶第二道防線。 | 本 PR 不需要處理。建議另開 B02／B04 後續項目：新增 db test，斷言這 14 條 FK 的 `pg_get_constraintdef` 完整等於預期（做法比照 partial index）。stale 訊息對 `foreign_key_*`、`trgm_gin_index` 類別改成「這是租戶／業務不變式，不要刪條目，請修 migration」。allowlist 加 CODEOWNERS 或必經 reviewer。 |
| MINOR-4 | MINOR | `migration.sql:23-31`、`:36`；`runbook:10` | ACCESS EXCLUSIVE 會一路累積到 commit。如果第 N 張表被長交易卡住，migration 最多等 5 秒，期間前 N−1 張已鎖的表（字母序在前，例如 `AffiliateCommission`、`CommerceOrder`）的所有讀寫都要排隊。而且 app 交易可能已持有後面某張表的鎖，又來要前面那張表，形成 deadlock，`deadlock_timeout` 1s 時被中止的可能是 app 的付款交易。runbook 寫「不會讓後續請求排隊」，與實際行為不符。「concurrent runs cannot deadlock」這段在 Prisma advisory lock 下也沒有意義。 | runbook 改寫成實際行為，並要求在低流量時段部署。考慮把 `lock_timeout` 降到 1～2s。注明 staging 實際需要處理的表約 70～77 張，以及失敗時的重試步驟。 |
| MINOR-5 | MINOR | `runbook:23`；`scripts/migration-order-check.mjs` | 「rebase 後改名」的指引沒有涵蓋「改名前已經套用到 staging 或其他共用環境」的情況。改名後，staging 會留下舊名的 applied 紀錄，再套用新名一次，非冪等的 DDL 會失敗。另外，檢查只看目錄名稱，沒看內容：修改 merge base 已有的 `migration.sql`（checksum 改變）不會被擋，`migrate deploy` 也不會擋，staging 與全新環境的 schema 會悄悄分歧。 | runbook 增加：已經套用到共用環境的 migration 不可改名，必須新增一條 forward migration。order check 同時比對 merge base 與 HEAD 每個既有 `migration.sql` 的 blob hash，`git rev-parse <ref>:prisma/migrations/<dir>/migration.sql` 不一致時失敗。 |
| MINOR-6 | MINOR | `docs/operations/prisma-migration-guards-runbook.md:§3`；`PRISMA_INVARIANTS.md` 第 6 條 | drift check 的盲區沒有寫清楚：Prisma 6 不比對 CHECK constraint、trigger、function、RLS、grant。帳務 CHECK（B04-07）、金額相關的 CHECK 如果被 migration 刪除，drift check 不會發現。 | 在 runbook §3 明列盲區。帳務、金額 CHECK 改用 db test 斷言 `pg_get_constraintdef`，可與 MINOR-3 合併處理。 |
| NIT-1 | NIT | `ci.yml:90-93`；`migration-order-check.mjs:96` | push 到 master 的那次 run，HEAD 等於 `origin/master`，`added = []`，結果必定通過，事後偵測不到管理員 bypass 造成的亂序合併。目前 strict up-to-date 已經擋住一般情況。 | push 到 master 時，改用 `MIGRATION_ORDER_BASE_REF=HEAD^1`（squash 合併是單一 parent）。 |
| NIT-2 | NIT | `src/lib/rls-catalog.db.test.ts:20-30` | 測試會在 loopback cluster 層級建立 anon 與 authenticated，即使只跑一次測試，這兩個角色也會留在該 cluster 的其他資料庫。目前註解已說明。 | 在 runbook 或 local DB 文件補一句說明。 |
| NIT-3 | NIT | `.github/workflows/ci.yml:1-8` | workflow 沒有頂層 `permissions:`（既有狀況），GITHUB_TOKEN 權限取決於 repo 的預設值。本 PR 新增的步驟不需要 token。 | 另開 PR 加上 `permissions: { contents: read }`。 |
| NIT-4 | NIT | `migration.sql:41-46` | `_prisma_migrations` 也會被啟用 RLS。在 Supabase（owner 與 BYPASSRLS）沒有影響。日後如果換成既非 owner、也沒有 BYPASSRLS 的 migration 角色，`migrate` 會讀不到紀錄。 | runbook 加一句提醒即可。 |

BLOCKER：無。金流、auth 與權限層級：無 finding。

## 判定

MAJOR-1 是守門腳本 fail-open，修正約十行，另需補一個測試。MAJOR-2 是部署前置條件缺漏，只要補 runbook 與 checklist。這兩項修正並確認 CI 的 `Unit tests and coverage thresholds`（含兩個新的 db test）通過後，複審範圍只需涵蓋這兩處。MINOR-3 的 11 個租戶 FK 建議另開後續項目追蹤，不阻擋本 PR。

**結論：需修正後再審。**
