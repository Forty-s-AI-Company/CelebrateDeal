# G7-51：Stream heartbeat timeout、冪等重試與額度停播

## 結果

- 狀態：`PASS_LOCAL_DISPOSABLE`。
- 產品修正：Stream heartbeat 遇到永久 pending request 時，2 秒後會 abort 並進入 bounded retry；重試沿用同一 `eventId`，避免 server 已寫入但回應遺失時重複記帳。
- 重試控制：最多 3 次自動重試，base delay 為 500／1000／2000ms，另以每位觀眾的隨機 `eventId` 衍生 0～25% jitter；用完 retry budget 後不會由 `timeupdate` 形成 request storm。
- lifecycle：component unmount 會清除 retry timer 並 abort in-flight request；caller abort 與 client timeout 即使遇到忽略 `AbortSignal` 的 fetcher，也會回傳 `retryable_failure`。
- 額度停播：收到 exact `stream_minutes_exhausted` 後 pause、撤除 `src`、呼叫 `load()` 並卸載 `<video>`；停止後不再提供舊 `currentSrc` 或新增 heartbeat，復原 alert、聊天、商品與報名仍可操作。

## 實際修改與 ownership

- `src/lib/stream-usage-client.ts`：timeout／abort contract 與 bounded request outcome。
- `src/components/live-playback.tsx`：stable event identity、bounded retry、event-derived jitter、dispose cleanup、quota source cancellation。
- `src/lib/stream-usage-client.test.ts`、`src/components/live-playback.test.tsx`：timeout、caller abort、stable retry、retry budget、jitter、quota cancellation。
- `tests/e2e/commerce-orders.spec.ts`：延遲第一個 response 3.3 秒的 Browser timeout contract，以及 quota 後播放器卸載／heartbeat suppression contract。
- `scripts/g7-commerce-browser-qa.mjs`、`scripts/g7-commerce-browser-qa.test.mjs`：G7-51 focused runner 與 source-attested contract。
- 本輪只接管上述精確 hunks；沒有覆蓋其他 dirty worktree ownership。

## Deterministic evidence

| 驗證 | 結果 |
|---|---|
| `npm test -- --run src/components/live-playback.test.tsx src/lib/stream-usage-client.test.ts src/app/api/stream-usage/route.test.ts` | `3 files / 54 tests PASS`，exit `0` |
| `node --test scripts/g7-commerce-browser-qa.test.mjs` | `21/21 PASS`，exit `0` |
| `npm run typecheck` | `PASS`，exit `0` |
| scoped ESLint | `PASS`，exit `0` |
| `npm run typecheck:strict-index` | `FAIL`，exit `1`；10 個既有錯誤位於 invoice、support case、actions、Live Studio draft、policies、interaction roles 與 usage estimation，G7-51 修改檔案沒有出現在錯誤清單 |

## Final Browser／DB evidence

### Timeout、stable retry

- Receipt：`docs/ai-team/evidence/g7-51-stream-retry-browser-qa-219b00b4693552be.json`
- SHA-256：`961f299258ef39535eca62341cb0f1db29036d218c62962d5aec27d5bc2bb504`
- UTC：`2026-08-09T18:42:52.089Z` 至 `2026-08-09T18:45:31.219Z`。
- Browser：具名 contract `1/1 PASS`；第一個 heartbeat response 延遲 3.3 秒，client timeout 後以相同 `eventId` 重試，generic 429 不會誤停，第三次成功。
- Desktop／mobile RWD `PASS`、Axe critical／serious `0`；`streamRetry=PASS`，其他 focused 範圍均如實為 `NOT_VERIFIED`。

### Quota source cancellation

- Receipt：`docs/ai-team/evidence/g7-50-stream-quota-browser-qa-c3429009491880d7.json`
- SHA-256：`2b99691c43cd291af4dea6fad67cc057eb1506d3b5deb2573d6f50f67e7f9ad3`
- UTC：`2026-08-09T18:40:07.064Z` 至 `2026-08-09T18:42:44.581Z`。
- Browser：具名 contract `1/1 PASS`；exact quota response 後 pause 一次、`video` 數量為 0，等待 3 秒後 heartbeat 仍只有一筆。
- Desktop／mobile RWD `PASS`、Axe critical／serious `0`；`streamQuota=PASS`，其他 focused 範圍均如實為 `NOT_VERIFIED`。

兩個 final run 均使用 loopback production server、disposable PostgreSQL tmpfs、fresh Prisma generate、51 migrations、Next production build；server、container、tempRoot cleanup 全部 `PASS`。兩份 receipt 的 `live-playback.tsx`、`stream-usage-client.ts`、E2E 與 runner source hash 完全一致。

### 截圖

- Retry desktop：`g7-04-browser-qa-219b00b4693552be-screenshots/stream-retry-desktop.png`，SHA-256 `f68cd046c31a3df3ea8b4ece5a3f238b249e053cfcbfaca1212976f2fcdeaeee`。
- Retry mobile：`g7-04-browser-qa-219b00b4693552be-screenshots/stream-retry-mobile.png`，SHA-256 `84cd0ba6ae5a369b66b0842de23a22615dc73dcdf2a3941b45b41f14304f6023`。
- Quota desktop：`g7-04-browser-qa-c3429009491880d7-screenshots/stream-quota-desktop.png`，SHA-256 `0ae7ea96007b76f80a99a0a871163cbf03d71c8b1ca6cc74b0125eeb89a2e4c2`。
- Quota mobile：`g7-04-browser-qa-c3429009491880d7-screenshots/stream-quota-mobile.png`，SHA-256 `970cf77253d836d98f7beb5ce331643f29cb46af4b388fb01ba29042e827651c`。
- 人工檢視：retry 畫面保留播放器與所有導覽；quota 畫面清楚顯示復原 alert，播放器內容已撤除，desktop／mobile 沒有水平裁切。

## 保留的失敗證據

- `g7-50-stream-quota-browser-qa-89b1f6494b9d1599.json`，SHA-256 `8ad1b704284a16c3d3301d7d362f55de9e211d26c8dc4d8b4f0870db1243329d`：React 已移除 `src` attribute，但 Chromium `currentSrc` 仍保留舊媒體 URL。Receipt 維持 `BLOCKED_OR_FAILED`；產品改為 quota 後卸載播放器，未降低 assertion。
- G7-51 首次完成 retry receipt 後，quota 修正改動了 attested source；因此重新產生 final G7-51 receipt，沒有沿用 source lineage 已漂移的舊 PASS。

## Review、計分、blocker 與回滾

- Final reviewer：`RELEASE_REVIEW_PASS_NO_P0_P1_P2_BLOCKER`。P0 `0`、P1 `0`；component unit 仍 mock `useEffect` 的限制已明記，cleanup 由 source review、client abort unit 與 Browser lifecycle evidence共同支撐。
- 計分：CAT08 `7.5→8.0`，canonical total `75.0→75.5`；CAT01 維持 `8.5`，避免同份證據重複計分。固定功能 `team_stream_operations` 依 recovery 與 fresh evidence 維度由 `9.1→9.4`。
- 外部限制：未查詢真實 Cloudflare provider usage、未執行 staging、Production 或正式付款／退款；CAT04 `6.0`、CAT10 `4.5` 持續保留外部／真人 blocker。
- 回滾範圍：heartbeat timeout／abort、retry scheduler／jitter、quota player removal、對應 tests 與 focused Browser contract；無 migration、正式資料或外部狀態。
- 下一個最高價值工作：依 current source 重新掃描剩餘販售流程 P0/P1，優先選擇會影響功能完整度或商家／買家成功率的缺口；strict-index 既有錯誤另列品質工作，不拿來取代產品功能。
