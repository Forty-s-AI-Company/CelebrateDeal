# PR #461 審查：第五批工作線 B（F-092 用量計數列、F-091 可見性閘門與簽章 pass、F-015 `/lp` proxy、F-093 文件）

- 日期：2026-10-21
- 分支：`codex/beta-l1d-lineB-live`（HEAD `d73daecc`，5 個 commit），worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineB`
- 範圍：`git diff origin/master...HEAD`（merge-base `291acbd2`）。分支落後 master 1 個 commit（#459 `ad453597`），所以兩點 diff 會把 #459 的改動顯示成「被還原」（`formatCurrency`、`border-slate-500`、`useDialogBehavior`），那些不是本 PR 的改動；本審查以三點 diff 為準。
- 背景：`docs/review-2026Q4/16-performance-cost.md`（B06-05／06／07）、`15-nextjs-conventions.md`（B05-04）
- 審查者只讀；沒有修改任何程式、沒有 commit 或 push。

## 結論摘要

計數列的併發設計是對的：READ COMMITTED 加條件式 `UPDATE ... RETURNING` 的列鎖，可以讓同商家心跳依序執行，不會漏記也不會重複記。migration 只新增資料表，對既有資料是安全的；429 和 503 也接到前端的對應處理。修掉的 `allocations.create` 帶 `vendorId` 確實是 master 上既有的錯誤：master 上每一次真實心跳都會失敗。

但本 PR 新增的「隱藏分頁延後心跳」會讓背景分頁觀看的分鐘數漏記。webinar 觀眾常把分頁放在背景聽，這是計量回歸，合併前必須修正。

## Findings

| ID | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| R461-01 | **BLOCKER** | `src/components/live-playback.tsx:636`、`:607` | 心跳改成分頁隱藏時不送（`if (!force && !isPageVisible()) return;`），但 `onTimeUpdate` 在背景分頁仍持續累積秒數。`pagehide` 只送出**一個** ≤60 秒的 keepalive 心跳，剩下的累積量會隨文件一起消失。情境：觀眾開著 webinar 切到別的分頁聽 45 分鐘，然後從分頁列直接關掉，ledger 只記到約 1 分鐘。同一段時間裡，商家額度也完全沒有被檢查：額度用完的商家仍持續把 Cloudflare 分鐘送給背景觀眾，帳本和額度都少記，成本由平台吸收。心跳本來就每 60 秒才一次，延後它幾乎沒有減輕負載。另外，背景期間 admission 若因計時器節流而過期，回前景補送時會收到 403，重試 3 次後暫停，這些秒數同樣會遺失。新測試 `live-playback.test.tsx`「defers routine heartbeats while the tab is hidden」把這個行為鎖成預期，沒有測「長時間背景後關閉」。 | 可見性閘門只用在聊天和互動輪詢；用量心跳不分可見性，維持每累積 60 秒送一次。若一定要延後，`pagehide` 要把所有累積量分成多個 ≤60 秒的 keepalive 請求全部送出（或改用 `navigator.sendBeacon`），並補一個「隱藏 N 分鐘後 pagehide，送出的總秒數等於累積秒數」的測試。 |
| R461-02 | **MAJOR**（既有正式環境缺陷，列為發現） | master `src/lib/stream-usage.ts:362-363`（#136，2026-08-30 引入）；本 PR 修在 `src/lib/stream-usage.ts:442` | 已確認：巢狀 `allocations.create` 帶 `vendorId` 時，Prisma 會在執行期拒絕。產生的 `StreamUsageAllocationEntryUncheckedCreateWithoutLedgerEntryInput` 和 `CreateWithoutLedgerEntryInput` 都沒有 `vendorId` 欄位；TypeScript 沒擋下來，是因為 `.map()` 回傳的物件不受 excess property check。`buildStreamUsageAllocations` 一定會回傳至少一筆分配，所以 master 上**每一次**真實心跳都會 500。前端把 500 當可重試，重試 3 次後暫停，播放照常。結果：只要正式環境跑的是 #136 之後的 master，`StreamUsageLedgerEntry` 和 allocation 都是空的，串流額度從未被執行，`StreamUsageReconciliation` 會跟 Cloudflare 對不起來，過去的觀看分鐘也無法補記。master 沒有任何 DB 測試走過 `recordStreamUsageLedgerEntry`，只有 mock，所以一直沒被發現。 | 合併本 PR 就會修正。另外需要擁有者決定（涉及正式環境，審查者未讀取）：(a) 只讀確認正式環境 `/api/stream-usage` 的 500 比例和 ledger 列數；(b) 合併部署後，額度會**第一次**真正生效，`streamMinutesLimit` 偏低的商家可能在直播中收到 429、播放被暫停，部署前先檢查各商家的額度設定並通知；(c) 決定過去少記的分鐘是否只對帳、不回補。 |
| R461-03 | MINOR | `src/lib/stream-usage-counter.ts`；`docs/codex-goal/PRISMA_INVARIANTS.md`「已知限制」 | 計數列沒有修復路徑。舊版實例只寫帳本的期間，計數列會永久少記到月底。admission（`live-quota-admission.ts:202`）和心跳預留都以計數列判斷，所以少記多少，額度就多放行多少。帳務頁（`usage-estimation.ts`）讀的是帳本，兩邊會不一致，可能出現頁面顯示已用完、播放仍放行。Vercel 的部署是原子切換，正常情況下重疊只有 in-flight 請求，影響很小；但若專案開了 Skew Protection，舊版客戶端的 `/api/stream-usage` 會在 max age 內一直打到舊部署，少記量就會跟著放大。另外，部署順序必須是先 migrate 再部署：若新程式先上線而資料表不存在，`$queryRaw` 會回 P2010/42P01（不重試，500），而 `readVendorStreamUsageSeconds` 會讓所有有限額度商家的觀眾**無法入場**。 | (1) 在 `StreamUsageReconciliation` 或每日 cron 加一句冪等修復：`UPDATE counter SET watchSeconds = GREATEST(watchSeconds, ledger SUM)`，只會往上修；(2) 確認 Skew Protection 的狀態並寫進 release 清單；(3) release runbook 明列「先 `prisma migrate deploy`，再部署」。 |
| R461-04 | MINOR | `src/lib/stream-usage.ts:382-396` | 每個商家的心跳都排在同一列的鎖上，這是設計本意。但 `db.$transaction(work)` 沿用 Prisma 預設（`maxWait` 2 秒、`timeout` 5 秒），在鎖上等待的時間也算進 timeout。大型 webinar 同商家心跳同時到時，排隊的交易會以 P2028 失敗；它不在 `isSerializationConflict` 的範圍內，所以回 500，而不是可重試的 `usage_busy` 503。另外，額度在 80% 到 100% 之間時，每次心跳都會在持鎖期間 upsert 警告 alert（`:229`、`:267`），把 `acknowledgedAt` 清空，持鎖時間多一次寫入，商家按過「已讀」也會被重開。這是既有行為，但 R461-02 修好後才第一次真正觸發。本地 20 併發測試的 RTT 接近 0，無法代表 hnd1 對 Supabase 的實際情況。 | 明確傳入 `{ isolationLevel: ReadCommitted, timeout, maxWait }`，並把 P2028 也歸到 `usage_busy`；alert 只在跨越門檻時寫入（例如 `previousSeconds < threshold <= total`）；合併後在 staging 做一次單商家數百並發心跳的量測。 |
| R461-05 | MINOR | `src/lib/live-viewer-pass.ts:19`、`src/app/api/live-admission/route.ts:48,56` | pass 效期 10 分鐘，DB session 只有 90 秒，而前端每 30 秒就續期一次。觀眾在 session 過期、admission 被拒（額度、容量、直播結束）或沒呼叫 DELETE 的情況下，仍能在 10 分鐘內讀聊天列表、互動狀態，並觸發排定 `open`（`live-interactions/route.ts:411`；`open` 會建立 run，屬於寫入，但限定在同租戶已發布的腳本）。claim 裡的 `viewerSessionId` 沒有任何地方使用，「綁定 session」只是名義上的。續期本身仍經過 `admitLiveViewer` 的 DB 交易才會簽發新的 pass，這部分是對的。HMAC key 由 `CSRF_SECRET`（或 `JOB_SECRET`）以 `deriveSensitiveDataKey("live-viewer-pass")` 依用途衍生，與其他用途分開，可以接受。 | 把 pass 的 `e` 設成 session 的 `expiresAt`（≤90 秒）；30 秒續期一次仍能省掉每 2–3 秒一次的 session 讀取。admission 回非 200 時同時清掉 pass cookie。 |
| R461-06 | MINOR（程序） | `src/components/live-advanced-interactions.tsx` | `git merge-tree` 顯示與 master（#459）在這個檔案有內容衝突（import 區與 `formatCurrency`、`border-slate-500`）。 | rebase 到 master，衝突處理要同時保留 #459 的 `formatCurrency`、對比色和 `useDialogBehavior`，以及本 PR 的 `usePageVisible`；之後重跑 `live-playback`、`live-advanced-interactions` 的測試和 e2e。 |
| R461-07 | NIT | `src/lib/live-chat.ts:360` | 黑名單快取 60 秒，以 vendorId 為 key、每個實例各自一份，只影響列表的 `canPost`／`reason`。聊天列表本來就不因黑名單隱藏訊息（master 上也一樣），留言 POST 仍查 DB 並立刻擋下，所以這 60 秒沒有新的資料暴露。快取不分 `database` 參數，測試靠 `clearLiveChatBlacklistCache` 隔離。 | 可接受。之後若有「封鎖後立即隱藏列表」的需求，再改成 DB 查詢或主動失效。 |
| R461-08 | NIT | `src/proxy.ts`、`src/lib/public-landing-page-status.ts`、`tests/e2e/public-url-availability.spec.ts:59-72` | proxy 改成只查 slug→id 和發布狀態（含 `archivedAt: null`、專案已發布），所以不存在、未發布、封存、專案未發布的頁面仍由 proxy 回匿名 404，帶 `X-Robots-Tag`。報名表停用、step 不存在、operations 無效改由 page 的 `notFound()` 處理；`/lp` 和根目錄都沒有 `loading.tsx`，所以仍是真正的 HTTP 404，帶 robots noindex meta 和 no-store。對 SEO 來說，404 本來就不會被索引，改用 meta 可以接受。e2e 對 page 層 404 拿掉了「body 不含 slug」：RSC payload 會回顯使用者自己請求的路徑，不算新洩漏，原本「不透露原因」的斷言（不含「專案尚未發布」）仍保留，原意沒有被削弱。小差異是，旁人可以從兩種 404 的外觀，分辨「頁面存在且已發布、但內容層不可用」；已發布頁本來就是公開的，風險很低。 | 可接受；若想完全一致，可在 `not-found` 的 metadata 或 `next.config` headers 對 `/lp/*` 404 補上 `X-Robots-Tag`。 |
| R461-09 | NIT | `src/lib/db.ts:26` | `CELEBRATEDEAL_PRISMA_QUERY_LOG` 需要值剛好是 `stdout`，而且沒有 `VERCEL` 才會生效。Vercel 在 build 和 runtime 都會設 `VERCEL=1`，repo 裡也只有 `scripts/lp-load-probe.mjs` 會設這個變數。Prisma 的 stdout query log 不印參數。結論：在 Vercel 上不會開啟。 | 可再加一道 `VERCEL_ENV` 的防護，讓 preflight 在 production 偵測到這個變數時給出警告。 |
| R461-10 | NIT | `src/app/api/live-admission/route.test.ts` | 這個 route 測試沒有 `vi.stubEnv("CSRF_SECRET")`，依賴環境變數（CI 的 `ci.yml:18` 有設）。本機沒有設定時，3 個測試會 500。另外，若正式環境少了 `CSRF_SECRET`，admission 交易已經 commit 後才在簽 pass 時拋錯，回 500，座位要佔滿 90 秒才釋放；但這屬於設定錯誤，其他功能也會一起失效。 | 在測試內 stub 環境變數；也可以在交易前先呼叫一次 `deriveSensitiveDataKey`。 |

各等級統計：BLOCKER 1、MAJOR 1、MINOR 4、NIT 4。

## 逐項回覆指定重點

### (1) 用量計數列

- **不漏記、不重複記：成立。** 所有能放行的路徑最後都持有該 `(vendorId, monthKey)` 列的鎖：UPDATE 成功；或 INSERT 播種成功（未 commit 的插入列，其他交易在 `ON CONFLICT` 上等待）；或「列剛出現 → `continue` → UPDATE」。READ COMMITTED 下，被擋住的 UPDATE 會在前一個持鎖者結束後，用最新 commit 的值重新評估 WHERE。之後的 scoped quota 查詢每句都取新快照，看得到前一個持鎖者已 commit 的帳本。交易回滾時遞增也一起回滾。同一個 eventId 併發時，第二筆在建立帳本時撞到 unique，P2002 讓整個交易回滾，外層再查到既有列，回 `duplicate`。計數只增不減，所以「SELECT 看到放得下 → 下一輪 UPDATE 又放不下」只會在真的被別人用掉額度時發生，不會造成假的額度用完。
- **每月首次心跳播種**：`INSERT ... SELECT SUM(ledger) ... ON CONFLICT DO UPDATE WHERE <額度條件>` 是正確的。兩個首次心跳同時到，後者走 DO UPDATE，以已 commit 的總量判斷。播種本身就超額時不插入列，之後每次心跳都會再掃一次帳本，但這時已經用完，可以接受。
- **滾動部署少記**：見 R461-03。少記量等於多放行量，而且到月底都不會自動修正；在 Vercel 原子切換、沒開 Skew Protection 的情況下影響很小。
- **migration**：`20261021150000` 只新增資料表、FK CASCADE、兩個 CHECK、RLS，沒有動既有的資料表、欄位或列，不需要回填；`updatedAt` 沒有預設值，原生 INSERT 有自己帶入。`PRISMA_INVARIANTS.md` 已登記。部署順序見 R461-03。
- **429 前端處理**：route 只有在 `StreamQuotaExceededError` 或 `stream_minutes_exhausted` 時回 429 並帶 code，前端 `isQuotaExhaustedResponse` 認到後會暫停播放、顯示 `StreamQuotaAlert`。rate limit 的 429 沒有 code，會被當成可重試。`usage_busy` 回 503 加 `Retry-After`，前端用同一個 eventId 重試，符合冪等。
- **`allocations.create` 帶 vendorId**：見 R461-02，確認 master 上每次心跳都失敗。

### (2) 簽章 pass

key 的來源、綁定方式（vendorId、liveId、admission cookie 的 SHA-256 摘要）、timing-safe 比對、版本前綴、claim 白名單和效期上限都正確。續期只會在 `admitLiveViewer`（Serializable DB 交易）成功後簽發，所以仍有驗 DB。留言 POST、互動回應、提問、用量心跳和購買都不接受 pass，仍查 DB session（`admittedViewer` 只有 GET 和 `open` 才會 `allowPass`，`createViewerChatMessage` 不帶 pass）。風險見 R461-05：10 分鐘效期遠長於 90 秒的 session，`viewerSessionId` 沒有被使用。黑名單 60 秒的影響見 R461-07：不會造成新的讀取暴露。

### (3) `/lp` proxy

見 R461-08。未發布、封存、專案未發布的 404 行為不變（仍由 proxy 回匿名 404 加 `X-Robots-Tag`）。「停用」商家原本就不在 proxy 的條件裡，由 page 判斷，這點沒有改變。e2e 的斷言拆分保留了原意。

### (4) 可見性閘門與購買播報

購買播報（`src/components/live-purchase-broadcast-panel.tsx`）不在本 PR 的改動範圍。它原本就在隱藏時跳過、回前景時立即重新抓，而且每次抓的是最新 8 筆快照，所以正在看直播（前景）的觀眾不會漏掉，回前景時也會補上。聊天列表是最新一頁的合併，互動狀態是當前 run 的快照，回前景時都會立即重新抓。隱藏期間錯過的限時 flash sale 不會補彈，這是合理的取捨。真正的問題在用量心跳，見 R461-01。

### (5) `CELEBRATEDEAL_PRISMA_QUERY_LOG`

見 R461-09：在 Vercel 上不會開啟。

### (6) 3 個 q1 測試失敗

確認與本分支無關。

- 本分支在 `celebratedeal_e2e`（已套用 121 個 migration）上，加上 CI 的 `CSRF_SECRET` fixture 跑全套：`3 failed | 6956 passed | 15 skipped`。失敗的是 `scripts/q1-original-retry-audit.db.test.ts`、`scripts/q1-schema-recovery-audit.db.test.ts`、`src/lib/q1-downstream-readonly.db.test.ts`，與作者回報的一致。
- master 程式碼（主 repo 的 `codex/beta-goal-state-20261021`，與 `origin/master` 只差 docs）在**同一個** `celebratedeal_e2e` 上跑這 3 個檔案，得到同樣 3 個失敗。
- 原因是固定 ID 的 fixture 跨次執行殘留，例如 `webhookEvent (provider, eventId)` unique 衝突、「排除既有列」斷言被殘留列影響，跟程式碼無關。
- 本分支在乾淨的 `celebratedeal_test` 上第一次跑 `scripts/q1-` 時 12 個檔案全過，第二次重跑就因為自己留下的殘留列失敗，佐證上面的原因。注意：`celebratedeal_test` 現在也有這類殘留列。

## 本次執行的驗證

| 指令 | 結果 |
|---|---|
| `git fetch origin master`；`git merge-tree --write-tree HEAD origin/master` | 落後 1 個 commit；`live-advanced-interactions.tsx` 有衝突 |
| `vitest run`（全套，branch，`celebratedeal_e2e`，`CSRF_SECRET` 用 CI fixture） | 3 failed／6956 passed／15 skipped，3 個都是 q1 fixture 測試 |
| 同上，但沒設 `CSRF_SECRET`，且與其他 DB 測試同時跑 | 154 failed，是環境問題（缺 secret、DB 同時被使用），不列入結論 |
| master：上述 3 個 q1 檔案 @ `celebratedeal_e2e`／`celebratedeal_test` | 3 failed／2 failed（fixture 殘留） |
| `vitest run src/lib/stream-usage-counter.db.test.ts` @ `celebratedeal_e2e` ×3 | 每次 6/6 通過 |
| 本 PR 相關的 16 個 unit 測試檔（live-admission、live-interactions、stream-usage、live-viewer-pass、live-chat、live-quota-admission、public-landing-page-status、proxy、live-playback、attribution contract、lp-load-probe） | 258/258 通過（有設 `CSRF_SECRET`）；沒設時 `live-admission/route.test.ts` 有 3 個失敗，見 R461-10 |
| `npm run typecheck` | 通過 |
| 未執行 | lint、Playwright e2e、strict-index、contracts；CI `quality` 仍在 pending |

需修正後再審
