# G7-50：Stream 額度耗盡停播與復原提示

## 結果

- 狀態：`PASS_LOCAL_DISPOSABLE`。
- 產品問題：`/api/stream-usage` 已會拒絕超出 Stream 額度的 heartbeat，但瀏覽器端只把所有非成功回應視為可重試失敗，會把秒數加回佇列；影片仍繼續播放，觀眾沒有看到額度耗盡或復原方式。這會讓 server ledger、實際播放與成本控制產生落差。
- 產品修正：heartbeat client 改為 `recorded`／`quota_exhausted`／`retryable_failure` 三種結果。只有 HTTP 429 且 bounded JSON 含 exact public code `stream_minutes_exhausted` 時停播；一般 429、衝突、server 或網路錯誤保留既有重試行為。
- 使用者回饋：額度耗盡後立即暫停影片、移除 controls、阻擋再次播放，顯示具 `role="alert"`／`aria-live="assertive"` 的繁體中文復原提示；商品、報名與聊天導覽仍可操作。
- 重送控制：耗盡結果不把 watch seconds 加回佇列、不再送 heartbeat；首次耗盡只 pause 一次，後續 `timeupdate` 只忽略，使用者重新嘗試播放時再明確 pause。

## 實際修改與 ownership

- `src/lib/stream-usage-client.ts`：新增 bounded outcome 與 exact quota response classifier。
- `src/app/api/stream-usage/route.ts`：額度耗盡回應保留安全文字並新增 stable public code；其他錯誤不暴露內部 code。
- `src/components/live-playback.tsx`：停止超額播放、停止重送、加入可存取復原提示並保留其他直播互動。
- 對應 client、route、component unit tests，以及 G7 commerce focused Browser runner／E2E contract。
- 本輪只接管上述 G7-50 精確 hunks；未回滾或覆蓋其他 dirty worktree 內容。

## Deterministic evidence

| 驗證 | 結果 |
|---|---|
| `npm test -- --run src/lib/stream-usage-client.test.ts src/app/api/stream-usage/route.test.ts src/components/live-playback.test.tsx` | `3 files / 48 tests PASS`，exit `0` |
| `node --test scripts/g7-commerce-browser-qa.test.mjs` | `20/20 PASS`，exit `0` |
| `npm run typecheck`（fresh `prisma generate` 後） | `PASS`，exit `0` |
| scoped ESLint | `PASS`，exit `0` |

## Final Browser／DB evidence

- Final receipt：`docs/ai-team/evidence/g7-50-stream-quota-browser-qa-e9604ab982f9b99a.json`
- Receipt SHA-256：`616b1160940caca459606b218bf04d30a5646f7a6a0e3c6fa6837612bda1f2dc`
- UTC：`2026-08-09T18:08:19.795Z` 至 `2026-08-09T18:10:53.232Z`。
- 隔離範圍：loopback production server、disposable PostgreSQL tmpfs、fresh Prisma generate、51 migrations；未連外、未讀 user browser profile、未操作正式服務。
- Phases：mirror、Prisma generate／validate／deploy／status、Next production build、server、Browser 全部 `PASS`。
- Browser：具名 contract `1/1 PASS`、desktop／mobile RWD `PASS`、Axe critical／serious `0`、exact quota stop 與 heartbeat retry suppression `PASS`。
- Scope truth：只有 `streamQuota` 為 `PASS`；tenant isolation、PII、商品、交付、Email、Live Studio、買家訂單、onboarding 等本 focused contract 未執行的欄位均為 `NOT_VERIFIED`。
- Cleanup：server、container、tempRoot 全部 `PASS`。

### 截圖

- Desktop：`g7-04-browser-qa-e9604ab982f9b99a-screenshots/stream-quota-desktop.png`，SHA-256 `08b33e049e0f1e1b6ac1c236c0eea0dcb287a414ed6f599c6ac0fa7e2f65cd7b`。
- Mobile：`g7-04-browser-qa-e9604ab982f9b99a-screenshots/stream-quota-mobile.png`，SHA-256 `91beeeef77d3f4bef50f99749adeee91f9014de6a908106a0c8c7da9ad2a2b4a`。
- 人工檢視：兩張皆顯示清楚的「直播播放額度已用完」與復原說明；提示未遮蔽底部聊天／商品／報名導覽，mobile 沒有水平裁切。

## 保留的失敗證據

- `g7-50-stream-quota-browser-qa-9f6599decb01a07b.json`，SHA-256 `f6abed8aca01badf65dcba0d1b6ee3b21b07bc4678f7a31659c940b81198978d`：第一個 fixture 受到 commerce publish readiness 影響，公開頁在功能 assertion 前回傳 404；最終改為產品規則明確的 content-only playback fixture，沒有降低 assertion。
- `g7-50-stream-quota-browser-qa-3b288ddb326bf6ac.json`，SHA-256 `57a8c7f9d85b196720adc0f4372b3773f80ebcab5ba2cd9f42a01aba20c8037f`：功能已停播且只送一筆 heartbeat，但耗盡後每個合成 `timeupdate` 都再次呼叫 pause，共 62 次；產品程式改為忽略後續進度事件，最終 Browser 證明首次停播與重播阻擋各一次。
- 兩份均維持 `BLOCKED_OR_FAILED`，沒有改寫為 PASS。

## Blocker 與回滾

- Final reviewer：`RELEASE_REVIEW: NO_P0_P1_WITH_P2`，P0 `0`、P1 `0`、P2 `2`。
- P2：`retryable_failure` 會把秒數放回 accumulator，持續播放時由下一個 `timeupdate` 重送；暫停、結束或不再有進度事件時沒有獨立 retry／backoff 排程。Client unit 已證明 generic 429 不會被誤判為額度耗盡，但 component／Browser 尚未直接覆蓋 generic 429 的重送路徑。
- 計分：reviewer 不支持 CAT01、CAT08 或固定功能數字上調。`team_stream_operations` 維持 `9.1`，canonical total 維持 `75.0`；本 receipt 只作為 fresh Stream 額度停播證據，不用修 bug 的可信度硬加分。
- CAT04 `6.0`、CAT10 `4.5` 的外部／真人 blocker 不屬於本輪，仍維持跳過並保留待辦。
- 本輪沒有執行真實 Cloudflare provider reconciliation、staging、Production、正式付款／退款、push、merge或 terminal no-go retry。
- 回滾範圍：stream heartbeat public outcome、quota error code、LivePlayback stop／alert、對應 tests 與 focused Browser runner；無 migration、正式資料或外部狀態。
- 下一個最高價值工作：為一般 heartbeat 失敗加入 bounded retry／backoff 與 component／Browser contract，再重新掃描剩餘產品 P1；依使用者指示，本 checkpoint 在 G7-50 收尾後停止執行。
