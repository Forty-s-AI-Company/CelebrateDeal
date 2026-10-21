# PR #459 複審：Line C UX 修正（對照 40-pr459-lineC-review.md）

- 分支：`codex/beta-l1c-lineC-ux`，worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineC`
- 範圍：`git diff 7d9adf5f..HEAD`（HEAD＝43d8f2f3），共 2 個 commit：8cb20e88（F-142 readiness）、43d8f2f3（MINOR／NIT）。16 個檔案，+325／-103
- 審查日期：2026-10-21
- 審查者：reviewer（Opus），只讀，未修改程式

## 本機驗證

| 項目 | 結果 |
|---|---|
| `npx vitest run` api/readiness/route、format-twd、dialog-focus、app-shell、live-stepper-form、scripts/api-contract-registry | 6 檔 67 測試通過 |
| `npm run typecheck` | 通過 |
| `npx eslint`（本次修正的 ts/tsx） | exit 0 |
| 兩個 action 的 `*.db.test.ts` | **本機無法執行**：測試資料庫 `127.0.0.1:54329` 拒絕連線。只做靜態判讀，必須以 CI `quality`（`test:coverage` 會跑 DB 測試）通過為準。審查時 CI 仍是 pending |

## 原 findings 狀態

| 編號 | 原等級 | 狀態 | 說明 |
|---|---|---|---|
| M-1 | MAJOR | **已修正** | 新的 `src/lib/job-readiness.ts` 依 job 分成 due／inFlight／stale 三組條件，逐一比對 worker 的 where 如下表。未來排程的列已用 `nextAttemptAt: { lte: now }` 排除，「最舊時間」也改用 `min(nextAttemptAt/nextRetryAt)`。測試直接攔截 delegate 收到的 `where` 並逐一斷言。殘留兩個小差異，見 r-1、r-2。 |
| M-2 | MAJOR | **已修正到可接受（有後續事項）** | 成功時間改為 `findFirst({ where: 成功狀態, orderBy: 成功欄位 desc, select })`，結果在模組層快取 60 秒，測試證明 60 秒內不會重查、61 秒後才重查。要說清楚的是：成功時間欄位仍然**沒有索引**，「只取一筆」並不會減少掃描量，PostgreSQL 仍要讀完所有成功列再做 top-1。真正壓低成本的是快取：每個暖機中的 instance 每分鐘最多做一次。這個端點只接受 `CRON_SECRET`，runbook 也定位為人工判讀，beta 階段可以接受。due、inFlight、stale 的計數都會用到既有的 `[status, nextAttemptAt]` 或 `[status, createdAt]` 索引前綴，成本有上限。後續事項見 r-3。 |
| M-3 | MAJOR | **已修正（有一個缺口）** | 兩個檔案都把 CSRF、manager、editable scope 改成可控制的 `vi.fn`。CSRF 測試斷言 `toHaveBeenCalledWith(form)`，且 manager 沒有被呼叫，證明 CSRF 先檢查。三種拒絕情境都斷言 A、B 兩個 vendor 的 tag、note、CRM 筆數皆為 0（查詢條件是 `vendorId in [A, B]`）。editable 斷言帶入 `("synthetic-user", vendorA)`。這些斷言是真的：mock 只有在 action 實際呼叫守門函式時才會拋錯，如果移除守門呼叫，`rejects.toThrow` 會失敗。另外，每個測試的 `beforeEach` 都會 `mockReset`，不會有 `Once` 殘留。缺口：`grantCustomerVoucherAction` 沒有列入 guard 測試，見 r-4。 |
| m-1 | MINOR | 已修正 | 沒有指定 `fractionDigits` 時交給 Intl 依幣別決定，JPY 顯示整數，並補了測試。 |
| m-2 | MINOR | 已修正 | 新增 Tab／Shift+Tab focus trap。用 `openedAt === pathname` 推導 `isOpen`，路由改變後抽屜就會隱藏，`useDialogBehavior` 再把焦點還給觸發元素。小瑕疵見 r-5。 |
| n-1 | NIT | 已修正 | 5 個 billing e2e 都改成 `value !== "NT$0"`。 |
| n-2 | NIT | 已修正 | registry 改用編號 94，描述同步更新為 due／inFlight／stale 與 60 秒快取。 |
| n-3 | NIT | 已修正 | 移除 `role="status" aria-live`，只保留把焦點移到標題。 |
| n-4 | NIT | 未處理 | 屬既有行為，原本就建議另開議題，不影響合併。 |

## M-1 逐一比對各 worker 的 where

| job | readiness `due` | worker 候選查詢 | readiness `stale` | worker 的 lease 回收 | 結論 |
|---|---|---|---|---|---|
| email | `status in [queued, failed]`、`nextAttemptAt <= now` | `email-delivery.ts:1207-1211` 相同 | `sending`、`claimedAt <= now-10m` | `:1177-1179`，`DELIVERY_LEASE_MS` 10 分鐘，`lte` | 一致 |
| line | `status in [queued, failed]`、`nextAttemptAt <= now` | `line-notification.ts:203`（多了可選的 tenant scope，全站彙總不需要） | `sending`、`claimedAt < now-5m` | `:195-199`，5 分鐘，`lt` | 一致 |
| webhookRetry | `failed`、`nextRetryAt <= now` | `webhook-retry.ts:299-303` 相同 | `retrying`、`updatedAt <= now-10m` | `:280-285`，10 分鐘，`lte` | 一致 |
| learnerNotifications | `queued`、`attemptCount < 5`、`nextAttemptAt <= now` | `learner-notification-job.ts:98` 多了 `preference.channel in 已設定 channels` | `processing`、`claimedAt <= now-10m` | worker 不會自動回收（`outbox.ts:56-57`），10 分鐘是 readiness 自訂門檻 | 大致一致，見 r-1 |
| trackingOutbox | `queued`、`nextAttemptAt <= now` | `tracking-purchase-worker.ts:92-97` 多了 `attemptCount < 8` 與 `modeScope`，並把 lease 過期的 processing 也視為候選 | `processing`、`leaseExpiresAt <= now` | worker 會把過期 lease 當作 due 重新認領 | 大致一致，見 r-2 |

## 新的 findings

| 編號 | 等級 | 位置 | 問題與情境 | 建議 |
|---|---|---|---|---|
| r-1 | NIT | `src/lib/job-readiness.ts:36` | learner 的 due 沒有套用 worker 的 `preference.channel in channels`（`learner-notification-job.ts:98`）。如果某個 channel 沒有設定，該 channel 的 queued 列會一直算進 due，`oldestDueAt` 也會越來越舊。不過這些列確實永遠不會送出，所以這個訊號是真的「未投遞」，不算誤報。但檔頭註解寫「exact candidate conditions」並不精確。 | 修正註解，或在 runbook 第 14 節註明：learner 的 due 包含未設定 channel 的列。 |
| r-2 | NIT | `src/lib/job-readiness.ts:42-44` | tracking 的 due 少了 `attemptCount < 8` 與 test／live `modeScope`。lease 過期的 processing 列被歸到 stale，但 worker 下一輪就會重新認領，所以兩次 worker 執行之間 `staleCount` 可能短暫大於 0。runbook 寫的是「必須為 0」，可能讓人誤判。 | due 補上 `attemptCount: { lt: 8 }`。runbook 改成「`staleCount` 連續兩次檢查都大於 0 才視為停擺」，email、line、webhook 也適用同樣說法。 |
| r-3 | MINOR（後續事項） | `src/lib/job-readiness.ts:69、85-89` | 5 個成功時間欄位（`sentAt`×2、`processedAt`、`dispatchedAt`、`acceptedAt`）都沒有索引。快取只限制了頻率，沒有降低每次的成本，表變大後單次查詢會越來越慢。快取是 instance 層級，冷啟動或多個 instance 時會各算一次。另外，回應中的 `checkedAt` 永遠是現在時間，但 `jobs` 可能是 60 秒前的資料。 | 列為 beta 後的後續事項：以 forward-only migration 為成功時間欄位建立索引（大表用 `CONCURRENTLY`），並登記到 `PRISMA_INVARIANTS.md`。回應改帶快取的 `computedAt`。這兩項都不阻擋本 PR。 |
| r-4 | MINOR | `src/app/actions/customer-crm-actions.db.test.ts:132-136` | guard 測試只涵蓋 `addCustomerTagAction` 與 `saveConsultantNoteAction`。最敏感的 `grantCustomerVoucherAction`（會解密 PII 並派券）原本由刪掉的原始碼測試守著，現在 CSRF 與 manager 的接線沒有斷言。程式本身仍有守門（`customer-crm-actions.ts:91-92`）。 | 把它加進 `mutations`，並用 `automationVoucherGrant.count({ vendorId in [A, B] }) === 0` 斷言。大約 5 行，可以在本 PR 補，也可以緊接著補。 |
| r-5 | NIT | `src/components/app-shell-mobile-nav.tsx:38-42` | 路由改變只會讓 `isOpen` 變成 false，`open` 仍維持 true。情境：在 /orders 開啟抽屜，按上一頁到 /dashboard，再按下一頁回到 /orders，抽屜會自己重新出現。 | 在 `isOpen` 從 true 變 false 時同步呼叫 `setOpen(false)`；或在 `openedAt !== pathname` 時於 render 中重設 `open`，也就是 React 文件中「依 props 調整 state」的寫法。 |

- BLOCKER：無。
- MAJOR：無。原本的 M-1、M-2、M-3 都已解決；M-2 的索引留作後續事項。
- 金流、租戶邊界、migration：本次修正沒有動到伺服器端金額或 schema。readiness 只回傳全站彙總，不含任何 tenant 資訊。

可合併（前提是 CI `quality` 通過，因為兩個 action 的 DB 測試本機未能執行；r-4 建議在合併前或緊接著補上）。
