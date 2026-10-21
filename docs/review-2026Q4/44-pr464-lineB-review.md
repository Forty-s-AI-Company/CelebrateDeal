# PR #464 輕審：兩租戶夾具與 action 矩陣、CI push 限 master 與 concurrency（第六批 B）

- 分支：`codex/beta-l1e-lineB-tests`（3 個 commit：73b038fe、5f76c49a、70e8d839）
- 範圍：`git diff origin/master..HEAD`（已先 `git fetch origin master`）
- 變更檔：`.github/workflows/ci.yml`、`src/test/two-tenant-fixture.ts`、`src/app/actions/two-tenant-actions.db.test.ts`
- 審查者：reviewer（唯讀，未改程式）

## 驗證紀錄

- 本機執行 `npx vitest run src/app/actions/two-tenant-actions.db.test.ts`：本機沒有可連的 PostgreSQL（`localhost:54329` 連不上），37 個案例都在建立夾具時失敗，**未能在本機驗證通過**。
- PR CI：審查時 `quality` 仍在跑（run 39630073155），這次推送只觸發 `pull_request` 事件、沒有重複的 `push` run，符合 F-147 的預期。
- 金流、權限與 migration 沒有改到正式程式碼；這次只新增測試、夾具，並調整 CI 觸發條件。

## 重點 (1)：負向案例是否真的斷言「被拒且 A、B 兩邊資料不變」

結論：**有**，而且不只是確認有拋錯。

- `outcome()`（test 107-120）只把 `redirect:`、`not_found` 和回傳的 state 轉成字串；**其他例外會原樣再拋出，讓案例失敗**。所以「拋任何錯就算過」的情況不會發生。每一列也用 `expected` 檢查拒絕原因的子字串。
- 每個 foreign row 在執行前後各對 A、B 做一次 `snapshot()`，並用 `toBe` 比對 JSON 字串（test 481-490）。snapshot 涵蓋 vendorMember、invitation、salesTeam、teamMembership、relationship、payout、commission、ledger、automationRule、payout policy、form、submission、userSession 和 auditLog 筆數。因為包含 `updatedAt`，只要資料被碰過就會顯示差異。
- 唯一例外是 `createVendorMemberAction`（邀請 B 的 email），A 端會刻意新增邀請，所以跳過 A 的比對。B 端仍有比對，另外也有獨立案例斷言「只記在 A、B 沒有邀請、A 沒有替 B 的使用者建立 membership」（test 494-502）。這樣處理合理。
- 偽造情境的案例（B 的 owner 或 accountant 帶著 A 的 vendor context）有打到 DB 層的實際檢查：`setMerchantAffiliatePayoutPolicy` 在交易內用 `vendorId + userId + role` 重新查詢 manager；`recordAffiliatePayoutOutcomeAction` 在寫入前用 `findFirst({ id, vendorId })` 加上 `assertAffiliatePayoutFinanceActor`。所以 auth mock 不會讓這些案例變成空轉。
- own rows 也有比對 B 的 snapshot，並用 `verify` 實際讀 DB 確認 A 端確實寫入。整個矩陣是正、負雙向。

## 重點 (2)：`ci.yml`

結論：**正確**。

- `push: branches: [master]` 加上沒有過濾條件的 `pull_request`：PR 由 `pull_request` 產生 `quality`；squash 合併後由 master 的 push 產生 `quality`。job 名稱沒有變，受保護分支要求的 required check `quality` 在兩邊都會出現。
- concurrency group：
  - PR 的 `github.ref` 是 `refs/pull/<N>/merge`，所以 group 是 `ci-refs/pull/<N>/merge`，加上 `cancel-in-progress: true`。同一個 PR 有新的推送時會取消舊 run，不同 PR 之間互不影響。
  - master 的 group 是 `ci-refs/heads/master-<sha>`，`cancel-in-progress` 為 false。每個 commit 自成一個 group，既不會取消執行中的 run，也不會發生「同 group 的 pending run 被較新的 pending 取代」。這正是 group 必須含 sha 的原因，寫法正確。
  - `cond && format(...) || ''` 在 cond 為真時，`format` 一定回傳非空字串，所以不會掉到 `''`。
- `permissions`：diff 沒有任何 permissions 的增減（`git diff ... | grep permissions` 計數為 0）。
- 附帶影響：只推 `codex/*` 分支、還沒開 PR 時不再跑 CI；推 tag 也不再觸發 CI。兩者都符合這次的目的。repo 沒有使用 `merge_group`，所以不受影響。

## Findings

| 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|
| MINOR | `src/test/two-tenant-fixture.ts:9-10, 164-175, 224-237` | 兩個租戶都會建立 `AffiliateCommissionLedgerEntry`。這張表的 FK 是 `ON DELETE RESTRICT`，還有拒絕 DELETE 的 trigger，所以 `vendor.deleteMany` **每次都**以 P2003 失敗後提早 return，users 永遠不會刪除，第 236 行等於死碼。結果是每個案例都會留下 2 個 vendor、8 個 user，以及約 30 筆關聯資料，其中包含刪不掉的 ledger。CI 的 wp18_ci 與 coverage 容器用完即丟，沒有問題；但 `npm test`、`npm run test:db` 走的是本機會長期保存的 `celebratedeal_test` public schema，每跑一次就多累積約 74 個 vendor。目前其他 DB 測試對這些表沒有做全域 count，**還不會**讓其他測試失敗，但檔頭的說明「Everything ... removed with the vendor」與實際行為不符。 | 二選一：(a) 如果矩陣不需要 ledger（void payout 的路徑看起來不讀 ledger），就拿掉 ledger 列，讓 cleanup 真的能刪乾淨；(b) 如果需要保留，就修正檔頭說明，並讓 cleanup 在已知會殘留時直接略過刪除與 user 刪除的嘗試，在註解寫明殘留量。 |
| MINOR | `src/test/two-tenant-fixture.ts:52-58` | `assertDisposableSchema` 只在有設定 `WP18_DISPOSABLE_SCHEMA` 時才比對；沒設定時一律通過。這樣它不算 schema-aware 的防線，連到哪個 DB 完全由 `vitest.config.ts` 的 `assertLocalTestDatabase` 決定（loopback 加 `celebratedeal_test`）。資料庫本身是安全的，但第 230-232 行的註解宣稱「disposable schema is the cleanup boundary」，在預設設定下並不成立。 | 會留下不可刪的資料時就 fail closed：只有在 `WP18_DISPOSABLE_SCHEMA` 符合 `^wp18_` 或 `RT01_D2_DISPOSABLE_DB === "true"` 時才建立 ledger；或比照 `actions.payout-db.test.ts`，把這支測試只放在 `test:db:concurrency` 跑。 |
| MINOR | `src/test/two-tenant-fixture.ts:233` | 只吞掉 P2003。依 `src/lib/landing-page-archive.db.test.ts:140` 的註解，PostgreSQL 18 回報 RESTRICT 的 SQLSTATE 是 23001，Prisma 不一定會對應成 P2003。開發者如果用 PG18 跑，cleanup 會丟錯，導致 afterEach 讓全部 37 個案例失敗。CI 固定用 PG16，不受影響。 | 處理方式同上一列的 (a)，或改用和 landing-page-archive 一樣的寬鬆判斷（P2003、23503、23001、restrict）。 |
| MINOR | `src/app/actions/two-tenant-actions.db.test.ts:101, 350-358` | snapshot 有包含 `userSession`，但夾具沒有建立任何 session，所以這個維度永遠是空集合，比對沒有意義。`deactivateVendorMemberAction` 會依 `userId + vendorId` 撤銷 session：own row 沒有驗證撤銷是否發生，foreign row 也偵測不到誤撤 B 的 session。 | 夾具替每個 actor 建一筆 `UserSession`，`vendorId` 設成該租戶；在 own deactivate 的 `verify` 斷言 A support 的 session 已撤銷，B 的不受影響。 |
| NIT | `src/app/actions/two-tenant-actions.db.test.ts:307-314, 110-113` | foreign 的 form search 案例只比對 status 和 message，`outcome()` 會丟掉 `result`。如果將來回傳 error 但 `result` 仍帶著 B 的資料，這個案例偵測不到。 | 這一列改寫成自訂的 `run`，加上斷言 `state.result` 為 null，且 `JSON.stringify(state)` 不含 `lead-b@example.test`。 |
| NIT | `src/app/actions/two-tenant-actions.db.test.ts:86-104` | snapshot 沒有涵蓋 `affiliate`、`landingPage`、`live`、`product`、`commerceOrder`、`salesProject`。目前這 6 組 action 都不會寫這些表，所以不影響結論；但之後往矩陣加新 action 時容易漏掉。 | 先把夾具已經建立的這幾張表加進 snapshot。 |
| NIT | `.github/workflows/ci.yml`（整檔） | 整個檔案沒有 `permissions` 區塊，`GITHUB_TOKEN` 使用 repo 預設權限。這次沒有改動 permissions，屬於既有狀況，不算這個 PR 的問題。 | 另開 follow-up，加上 `permissions: contents: read`。 |

各等級總結：

- **BLOCKER**：無。
- **MAJOR**：無。
- **MINOR**：4 項，都是測試夾具的清理、防線與覆蓋度問題，不影響正式程式碼，也不影響 CI 的正確性。
- **NIT**：3 項。

金額、租戶邊界、auth、migration 四類，在正式程式碼都沒有變更，也沒有發現問題。

結論：可合併（前提是 PR #464 的 `quality` 轉綠；4 項 MINOR 可以另開 follow-up）。
