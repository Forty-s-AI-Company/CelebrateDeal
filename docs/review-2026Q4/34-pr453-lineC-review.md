# PR #453 輕審：工作線 C UX（`codex/beta-l1-lineC-ux`）

- 審查日期：2026-10-20
- 範圍：`git diff origin/master..HEAD`（7 個 commit，ac69fbf4 為 HEAD），worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineC`
- 審查者：reviewer（Opus），只回報，不改程式

## 已執行的驗證

| 指令 | 結果 |
|---|---|
| `npx vitest run`：本次變更的 21 個測試檔（error boundary 掃描、status-labels、dashboard-order-summary、system-status-indicator、LINE form／actions、evergreen、dashboard、finance-route-states、checkout/billing/deliveries error） | 20 個檔案、54 個測試通過；`src/lib/dashboard-read-model.query-event.test.ts` 2 個測試失敗，原因是 `blocked/unsupported`：本機沒有可連的 PostgreSQL。這是環境問題，不是 assertion 失敗，因此**未驗證**，需以 CI `quality` 結果為準 |
| `npm run typecheck` | 通過 |
| `npx eslint <變更檔案>` | 通過，無輸出 |

## 重點檢查結論

1. **已付款 KPI**（`src/lib/dashboard-read-model.ts:274-296`）：只呼叫一次 `groupBy`，`where` 綁定 `vendorId`，沒有任何外部輸入 ID；只計 `status === "paid"` 且 `currency === "TWD"`；`refunded`、`partially_refunded` 與 `pending_payment` 都不計入；金額取自伺服器端的 `totalAmountCents`。租戶邊界與金額來源都正確，read operation 數仍是 6。時間區間的語意見 F2。
2. **health 輪詢**（`src/components/system-status-indicator.tsx`）：每 60 秒輪詢一次；分頁隱藏時 interval 仍會觸發，但 `run()` 會提早 return，不發請求；分頁回到前景時立即檢查一次；unmount 時清除 interval 與 listener。`/api/health` 是唯讀 GET（`SELECT 1`），沒有狀態變更，也不需要 CSRF token；回應只有 `ok`、`database` 與 `latencyMs`，不洩漏敏感資訊。AppShell 在 layout 層，換頁不會重新掛載，因此不會重複建立 interval。負載是每個開著的後台分頁每分鐘一次，可以接受。
3. **error boundary `retry`**：Next 16.3.8 runtime（`node_modules/next/dist/client/components/error-boundary.js:113-114`）傳入的是 `{ reset, retry }`。master 上有 3 個 boundary 使用 `unstable_retry`，在這版是 `undefined`，點按鈕會拋錯。本 PR 已修正這個問題。共 10 個 boundary 檔案：8 個在本 PR 修改，`p/[slug]/error.tsx` 原本就用 `retry`，加上 `global-error.tsx`。全部都使用 `retry`，與 `error.md` 一致。`global-error.tsx` 仍自帶 `<html lang="zh-Hant">` 與 `<body>`。新增的掃描測試會鎖住 prop 名稱。
4. **LINE `fields`**（`src/app/actions/line-actions.ts:88-90`）：內容是 `Object.keys(parsed.error.flatten().fieldErrors)`，只有 schema 的欄位 key，不含輸入值或 zod message。輸入物件由 5 個固定 key 組成，所以 key 集合有上限。表單端只把已知 key 對照成欄位標籤，未知 key 會被 `filter(Boolean)` 丟掉。沒有洩漏憑證內容。
5. **`status-labels.ts` 未知值**：遇到 `null`、`undefined` 或空字串回傳「—」，找不到對照時回傳「未知狀態」，不顯示原始值。對照表涵蓋了實際寫入的值：live 為 draft/scheduled/live/ended，streamMode 為 vod/live，vendorMember 為 active/inactive，script 為 draft/published，ConsultationBookingStatus 的 enum 全部涵蓋。小瑕疵見 F4。

## Findings

| # | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| F1 | MINOR | `src/lib/dashboard-read-model.ts`、`src/app/(app)/dashboard/dashboard-kpis.tsx`、`src/app/actions/line-actions.ts`、`src/app/actions/line-actions.test.ts`、`src/components/app-shell.tsx`、`src/components/evergreen-webinar-settings.tsx`、`src/components/line-official-account-form.tsx`、`src/lib/dashboard-read-model.query-event.test.ts`（共 8 檔） | 這 8 個檔案在 master 是 LF，本分支提交成 CRLF（`git ls-files --eol` 顯示 `i/crlf`）。實質變更只有 397 行新增、58 行刪除，但 `--stat` 顯示 1805/1466，等於整個檔案被改寫。squash 合併後 blame 會被污染；工作線 A／B 若也碰 `app-shell.tsx` 或 `dashboard-read-model.ts`，會出現整檔衝突。 | 合併前把這 8 個檔案轉回 LF（例如 `dos2unix` 後 commit），讓 `git diff --stat origin/master..HEAD` 只剩實質行數。也可以考慮另外補 `.gitattributes`（`* text=auto eol=lf`），但那屬於另一個 PR。 |
| F2 | MINOR | `src/lib/dashboard-read-model.ts:280-281`；`src/app/(app)/dashboard/dashboard-kpis.tsx` 中「近 7 天已付款訂單（不含待付款）」與「近 7 天已付款金額（TWD）」 | 時間窗用的是 `createdAt >= 7 天前`，不是 `paidAt`。例如第 8 天前建立、第 6 天前才付款的訂單不會計入；商家會把「近 7 天已付款」理解成「這 7 天內收到的錢」。另外，`partially_refunded` 的訂單整筆從已付款數與金額中消失，而標籤只寫「不含待付款」，看不出也排除了退款，對帳時會讓人困惑。這不涉及錢流，只是顯示語意。 | 二選一：(a) 已付款 KPI 改用 `paidAt >= since`，另做一次 `aggregate`，read operation 會加 1，需同步調整測試；(b) 保留現行查詢，把標籤改成「近 7 天建立、目前已付款」，並註明「不含退款與部分退款」。 |
| F3 | NIT | `src/components/system-status-indicator.tsx:48-55` | (1) `visibilitychange` 沒有節流，快速切換分頁時每次回到前景都會打一次 `SELECT 1`。(2) 回應可能亂序：較早發出的慢請求會覆蓋較新的結果，例如短暫顯示「連線異常」後才恢復。兩者影響都很小。 | 記錄上次檢查時間，15 到 30 秒內不重查；或用遞增的 request id，只接受最新一次請求的結果。 |
| F4 | NIT | `src/lib/status-labels.ts:17` | `table[value]` 會沿原型鏈查找。值若是 `"constructor"` 或 `"toString"`，會回傳函式而不是字串，React 渲染時會報錯。目前狀態值都來自 DB，實務上不會遇到。 | 改用 `Object.hasOwn(table, value) ? table[value] : …`，小寫版本也一樣處理。 |
| F5 | NIT | `src/app/error-boundary-props.test.ts:32-39` | 這個測試直接讀 `node_modules/next/dist/client/components/error-boundary.js` 並用 regex 比對。Next 若調整打包輸出，測試會誤報失敗。 | 可以接受；之後失敗時改成比對 `retry` 關鍵字即可，不需要現在處理。 |

- BLOCKER：無。
- MAJOR：無。金額只來自伺服器紀錄，查詢綁定 vendor；沒有新的 auth、權限或 migration 路徑；LINE 回傳值不洩漏憑證；error boundary 正確。

## 結論

沒有 BLOCKER 或 MAJOR。F1（CRLF）建議在 squash 前順手修正，以免和其他工作線衝突；F2 可以改標籤，或排入後續 PR。query-event DB 測試在本機因為沒有資料庫而未驗證，需以 CI 為準。

**可合併**
