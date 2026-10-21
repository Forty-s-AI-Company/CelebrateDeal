# PR #466 輕審：Line C 表單欄位錯誤、草稿衝突、文件更正

- 分支：`codex/beta-l1e-lineC-forms`（7 個 commit，worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineC`）
- 範圍：`git diff origin/master...HEAD`（已 `git fetch origin master`）
- 審查日期：2026-10-22
- 審查者：reviewer（唯讀，未改程式）

## 範圍說明

`git diff origin/master..HEAD`（兩點）會顯示刪除 `src/app/actions/two-tenant-actions.db.test.ts`、`src/test/two-tenant-fixture.ts` 與 `.github/workflows/ci.yml` 的 9 行。這些不是本 PR 的變更，而是分支建立後 master 合入了 #464（`39eed51c`）。三點 diff（merge-base 起算）沒有這些刪除；`git merge-tree` 確認與目前 master 合併不會衝突。

## 驗證

| 指令 | 結果 |
|---|---|
| `npx vitest run` product-actions、drafts route、use-live-studio-draft、live-studio-draft-client、ui-field-errors、products/upsert route（6 檔） | 6 檔 90 個測試通過 |
| `npm run typecheck` | 通過 |
| `npx eslint`（10 個變更的原始碼檔） | 無錯誤 |
| e2e `tests/e2e/commerce-orders.spec.ts` | **未執行**（需要瀏覽器與資料庫），只做了靜態審閱 |

## 重點檢查結論

1. **商品 `fieldErrors` 不洩漏內部訊息**：通過。`productFieldErrors`、`parseCoursePolicy` 與 `deliveryFieldErrors` 只回傳寫死的中文字串；`ProductDeliveryValidationError.message` 只拿來比對 regex，不會回傳給前端。`/api/products/upsert` 只多加了可選的 `fieldErrors` 鍵，`error` 欄位與 HTTP status 對照不變，所以既有 client 不受影響。client 端 `safeFieldErrors` 只接受 300 字內的字串，渲染時由 React 跳脫。驗證規則與原本 `return null` 的條件一一對應，仍然會擋下的情況包括售價為 0 的上架商品、非整數元售價、原價低於售價、不支援的幣別，回傳的仍是 `invalid_product`。
2. **B07-20 `overwrite`**：通過。`route.ts:87` 只拿掉 `revision` 條件，`vendorId`、`liveId`、`consumedAt: null`、`expiresAt > now` 都還在 `updateManyAndReturn` 的 where 裡（新增的測試有斷言）。沒有 `draftId` 的建立／復活路徑會忽略 `overwrite`。前端的 `keepMine` 只會在 `conflictLocked` 時生效，而且只帶一次旗標（測試確認之後的 flush 不會再帶）。伺服器本身無法驗證「明確使用者操作」，但呼叫者必須是同一個 vendor、通過 `requireMerchantApiActor` 的成員；這個成員本來就能重新整理頁面後覆蓋，所以沒有提升權限，也沒有跨租戶的影響，見 NIT-1。
3. **`&field=` 參數**：通過。伺服器端 `liveInvalidFieldName` 只接受 zod issue path 第一段、符合 `^[A-Za-z][A-Za-z0-9]{0,63}$` 的值，並經過 `encodeURIComponent`。client 端 `useServerInvalidField` 會再驗一次同一個 regex，之後只拿來做 `form.elements.namedItem()` 的 DOM 查詢，不會插入 HTML 或 URL。值重複時（`?field=a&field=b`），陣列轉成字串後不符合 regex，會被忽略。這是格式檢查，不是已知欄位清單；但只能指向表單中已存在的控制項，最多只會讓某個欄位被標成 invalid 並取得焦點，沒有注入面。
4. **PRODUCT.md／README／runbook**：通過。我逐一核對了以下宣稱：repo 已不追蹤 `dev.db`；`prisma/seed.ts:8` 在任何模式判斷前就呼叫 `assertLocalTestDatabase`，所以 `production-bootstrap` 確實無法對 production 執行，刪掉那段 PowerShell 指令是正確的；`src` 裡沒有 Turnstile；R2 用於 `api/media/images/*`；`sensitive-data.ts:7` 用 `CSRF_SECRET || JOB_SECRET` 衍生金鑰；CI 的 PostgreSQL 版本是 `postgres:16-alpine`。仍有效的規則都保留了：demo seed 禁止用於 production、platform admin 另行 bootstrap、備份與 restore drill。另外新增了加密金鑰隨備份管理的規則，以及 billing plans 的替代建立途徑。
5. **e2e 斷言**：保留了原意。原本的完整訊息從 `toHaveText` 改成 `toContainText`（摘要現在多了欄位清單），原字串完整保留；另外新增欄位訊息、`aria-invalid` 與焦點的斷言，也保留原本的輸入值保留與 DB 計數斷言。整體上斷言變得更嚴格。

## Findings

| 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|
| BLOCKER | — | 無 | — |
| MAJOR | — | 無 | — |
| MINOR-1 | `src/components/live-stepper-form.tsx:1058`（`useServerInvalidField`） | 用 `control.labels[0].textContent` 取欄位名稱。stepper 裡很多 `<select>` 是直接包在 `<label>` 裡（例如 `affiliateMode`、`defaultAffiliateCode`、`videoId`，約 :556–:570、:858–:870），`textContent` 會把所有 `<option>` 的文字也串進去。例如提示會變成「請先修正「預設推廣碼不指定王小明 · ABC…」欄位。」，而且可能把同租戶的推廣者名稱整串列出。 | 只取 label 的直接文字節點（例如過濾 `childNodes` 中的 `TEXT_NODE`），或在控制項上加 `data-field-label`，或改用欄位名稱到中文標籤的對照表。 |
| MINOR-2 | `src/components/use-live-studio-draft.ts:121` + `src/app/api/live-studio/drafts/route.ts:98` | 草稿已被消耗（另一個分頁已送出直播）或已過期時，server 一樣回 `DRAFT_CONFLICT`。使用者按「以我的覆蓋」後仍是 409，畫面回到同一個衝突狀態，按鈕會一直失敗，文案卻說可以覆蓋。 | server 對 consumed／expired 回傳不同的 code（例如 `DRAFT_CLOSED`），client 對這種狀態只顯示「載入最新」；或者在 keepMine 失敗後，把文案改成只能重新整理。 |
| NIT-1 | `src/lib/live-studio-draft.ts:84` | `overwrite` 完全由 client 宣告，server 無法區分是使用者明確操作還是 client 直接帶入。目前沒有權限或租戶風險，但沒有比對使用者看到的那一版，所以衝突之後第三人的修改也會被覆蓋。 | 可選的強化做法：409 回傳目前的 revision，keepMine 以該 revision 做一般的 CAS，就能拿掉 `overwrite` 旗標，也只會覆蓋使用者看到的那一版。 |
| NIT-2 | `src/app/actions/product-actions.ts:210`（`deliveryFieldErrors` fallback） | `safeText` 的長度或控制字元錯誤，以及 binding／revision 錯誤，都會落到 `deliveryTitle`。如果實際問題在說明欄有控制字元，焦點會移到標題欄。 | fallback 改成不指定欄位（只顯示摘要），或讓 `safeText` 的錯誤訊息帶上欄位名稱。 |
| NIT-3 | `docs/production-infrastructure-plan.md:35` | README 與 PRODUCT.md 都寫 R2 負責物件儲存，但這份文件的 Object Storage 列仍寫「Supabase Storage 初期；大量檔案改 R2」，與實際程式（`api/media/images/*` 已使用 R2）不一致。 | 同步改成 R2 為現行方案。 |
| NIT-4 | 分支基底 | 分支落後 master #464。合併前若沒有先合入 master，PR 的 CI 不會跑 #464 新增的兩租戶 DB 測試矩陣。 | 合併前先 merge／rebase master（已確認沒有衝突），讓 `quality` CI 在最新的基底上跑一次。 |

## 結論

沒有 BLOCKER 或 MAJOR。金額、租戶綁定與權限路徑都沒有被放寬：`overwrite` 只拿掉 revision 條件，其餘條件都在；`fieldErrors` 只是固定文案，不會洩漏內部訊息；`field` 參數經過兩端的格式驗證。MINOR-1 和 MINOR-2 是 UX 問題，可以在後續 PR 修。e2e 我沒有執行，請確認 PR 的 CI 結果。

可合併
