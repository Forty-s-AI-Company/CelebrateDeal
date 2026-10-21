# PR #461 複審：第五批工作線 B 修正

- 日期：2026-10-21
- 分支：`codex/beta-l1d-lineB-live`，worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineB`
- 範圍：`git diff d73daecc..HEAD`（HEAD `a6c4ba1d`）。內含 merge commit `86dbaff2`（併入 origin/master `ad453597`，#459）與 5 個修正 commit：`182b6ba0`、`6f7bd926`、`bdc4c66a`、`30ce689a`、`a6c4ba1d`。
- 對照：`docs/review-2026Q4/41-pr461-lineB-review.md`
- 審查者只讀；沒有修改程式、沒有 commit 或 push。

## 逐條狀態

| ID | 原等級 | 狀態 | 依據 |
|---|---|---|---|
| R461-01 | BLOCKER | **已修正** | 見下方「R461-01 細節」。 |
| R461-02 | MAJOR | **已處理（程式已修；正式環境的事項移交 owner）** | `allocations.create` 不再帶 `vendorId`（本來就已修）。`docs/operations/stream-usage-runbook.md` 第 1 節寫清楚 master 心跳 500 的原因與影響、額度第一次生效，以及部署前 owner 待辦：唯讀查帳本列數與有限額度商家、看 Vercel log 的 500 比例、調整額度、通知商家、過去少記的只對帳不回補、避開直播時段。這些涉及正式環境，仍須 owner 執行，不阻擋合併。 |
| R461-03 | MINOR | **已處理（以 runbook 取代自動修復）** | runbook 第 2 節規定先 `prisma migrate deploy`，確認 `_prisma_migrations.finished_at` 後才部署，並寫明順序反過來的後果；第 3 節說明 Skew Protection；第 4 節是唯讀對帳查詢；第 5 節是只往上修的重新播種。`PRISMA_INVARIANTS.md` 已同步。仍沒有自動修復的 cron，改由人工流程處理，可以接受，見 N-1。 |
| R461-04 | MINOR | **已修正** | 見下方「P2028 與交易選項」。 |
| R461-05 | MINOR | **已修正** | 見下方「pass 效期」。 |
| R461-06 | MINOR（程序） | **已修正** | 見下方「merge 衝突解法」。 |
| R461-07 | NIT | 維持可接受 | 沒有改動，也不需要改。 |
| R461-08 | NIT | 維持可接受 | 沒有改動；page 層 404 不帶 `X-Robots-Tag` 仍是已接受的取捨。 |
| R461-09 | NIT | 維持可接受 | 沒有改動；Vercel 上不會開啟。 |
| R461-10 | NIT | **已修正** | `route.test.ts` 用 `vi.stubEnv("CSRF_SECRET")`，並在 `afterEach` 呼叫 `unstubAllEnvs`。驗證時特別把 shell 的 `CSRF_SECRET`／`JOB_SECRET` 移除後再跑，結果通過。 |

## 指定確認事項

### R461-01：隱藏分頁仍會送心跳，額度照常檢查

`src/components/live-playback.tsx` 拿掉了 `if (!force && !isPageVisible()) return;` 和 `visibilitychange` 的強制 flush，也不再 import `isPageVisible`。現在每累積 60 秒就送一次心跳，不管分頁是否可見，所以背景分頁的每一分鐘都會經過 `/api/stream-usage` 的額度預留。`pagehide` 仍會用 keepalive 補送不到一分鐘的餘數。

新增的測試會實際觸發這兩條路徑：

- 「keeps sending heartbeats from a hidden tab for 5 minutes and still enforces the quota there (R461-01)」：先 `vi.stubGlobal("document", { visibilityState: "hidden" })`，再模擬播放 300 秒。斷言送出 5 筆各 60 秒、eventId 都不同的心跳，第 5 筆回 `quota_exhausted` 時影片被移除，並顯示 `StreamQuotaAlert`。
- 「sends the sub-minute remainder with a keepalive heartbeat on pagehide」：累積 45 秒後觸發 `pagehide`，斷言送出 `watchSeconds: 45` 且帶 `keepalive: true`。

聊天和互動輪詢仍保留可見性閘門，這兩者本來就應該保留。

### merge 衝突解法有保留 #459 的改動

- `git rev-list --count HEAD..origin/master` = 0，已經沒有落後。
- `git diff origin/master..HEAD -- src/components/live-advanced-interactions.tsx` 只剩本 PR 的 `usePageVisible` import、hook 和 effect 條件。#459 的 `formatCurrency`、`border-slate-500` 都保留。
- `live-playback.tsx` 對 master 的差異中沒有 `useDialogBehavior`、背景點擊、`formatCurrency` 或色彩的回退。
- #459 的互動台 `src/components/live-interaction-studio.tsx` 以及其他 #459 檔案，都不在 `origin/master..HEAD` 的檔案清單裡（只有 41 個 PR 自己的檔案），代表內容與 master 完全相同。

### pass 效期對齊 session

- `createLiveViewerPass` 必須傳入 `sessionExpiresAt`。到期時間取 `min(session 的 expiresAt, now + 120 秒)`；session 已經過期時直接拋錯。驗證端的上限也是 120 秒。
- admission route 用 `result.expiresAt`（90 秒）簽 pass，cookie 的 `Max-Age` 也是 90。
- 入場被拒（`LiveQuotaAdmissionError`）或回 500 時，都會用 `Max-Age=0` 清掉 pass。
- 有測試覆蓋：第 89 秒仍有效、第 90 秒失效；session 給 1 小時也只會簽到 120 秒；被拒時會清掉 cookie。

### P2028 回 503

- `runUsageTransaction` 改成明確傳入 `{ isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 }`。
- P2028 直接轉成 `usage_busy`，不在伺服器端重試；route 對 `usage_busy` 回 503 加 `Retry-After: 1`，瀏覽器用同一個 eventId 重送，冪等。
- 交易逾時時 Prisma 會整筆回滾，計數不會留下半套。
- 有測試確認交易選項的值，以及 P2028 只呼叫一次交易就回 `usage_busy`。

額度提醒改成只在跨過門檻時寫入（`previousSeconds < 門檻 <= usedSeconds`）。同商家的心跳在列鎖下依序執行，所以門檻判定是精確的；商家按過「已讀」也不會再被重開。DB 測試「10 分鐘額度、20 個並發心跳」仍會開出 `QUOTA_EXHAUSTED`。

### runbook 的對帳與重播種 SQL 不會把計數往下修

- 第 5 節的寫法是 `SET "watchSeconds" = GREATEST(c."watchSeconds", l.ledger_seconds) ... WHERE c."watchSeconds" < l.ledger_seconds`，只會往上修，而且冪等。
- 在服務運作中執行也不會多算：READ COMMITTED 下，子查詢的帳本加總只包含已 commit 的列；遇到正在進行的心跳時，UPDATE 會等它的列鎖，再對新的計數重算 `GREATEST`。結果最多是少修（再跑一次就會補上），不會超過帳本，也不會往下修。
- `monthKey` 用 `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')`，與程式的 `getUTCFullYear`／`getUTCMonth` 一致。
- 第 4 節的對帳查詢只讀；遇到計數大於帳本時，指示「停下調查，不要調降」，這個處置正確。

## 新發現

| ID | 等級 | 位置 | 說明 | 建議 |
|---|---|---|---|---|
| N-1 | NIT | `docs/operations/stream-usage-runbook.md` 第 4 節 | 對帳查詢是從帳本出發再 LEFT JOIN 計數列，所以「有計數列、但當月帳本為 0」的情況（計數大於帳本）不會出現在結果裡。照理不應發生，但第 4 節說這種情況要「停下調查」，目前的查詢卻抓不到。 | 改成 FULL OUTER JOIN，或另外加一句查「有計數列但沒有帳本」的查詢。 |
| N-2 | NIT | `src/components/live-playback.tsx` `flushStreamUsage` | 觸發 `pagehide` 時，若剛好有心跳還在送出，或正在等重試計時器，函式會直接 return，不到 60 秒的餘數就不會送出。現在心跳每分鐘都會送，所以最多只少記不到一分鐘。 | 可接受；之後可以在 `pagehide` 時改用 `sendBeacon` 補送。 |

本次修正沒有引入 BLOCKER、MAJOR 或 MINOR 等級的新問題。

## 本次執行的驗證

| 指令 | 結果 |
|---|---|
| 本 PR 相關的 17 個 unit 測試檔（live-admission、live-interactions、stream-usage route 和 lib、live-viewer-pass、live-chat、live-quota-admission、public-landing-page-status、proxy、live-playback、live-advanced-interactions、attribution contract、lp-load-probe），shell 中移除 `CSRF_SECRET`／`JOB_SECRET` | 271/271 通過 |
| `src/lib/stream-usage-counter.db.test.ts` @ loopback `celebratedeal_e2e` | 6/6 通過 |
| `npm run typecheck` | 通過 |
| `eslint`，範圍是 PR 改到的 ts、tsx、mjs 檔案 | 無錯誤 |
| `git rev-list --count HEAD..origin/master` | 0 |
| 未執行 | 全套 vitest、Playwright e2e、contracts；CI `quality` 與 Vercel preview 在審查當下仍是 pending，合併前要確認通過 |

可合併
