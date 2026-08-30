# WP-97 — Cloudflare Stream Webhook CAS 競態收斂與安全重試

日期：2026-07-30  
類別：CAT-08 效能、可靠性、Log、監控與追蹤  
狀態：`ACCEPTED`

## 修正的失敗模式

Cloudflare Stream webhook 是至少一次、可能亂序的 delivery。原本兩個 callback 同時從 `processing` 讀取資料時，若 `error` 先寫入，後到的 `ready` 會因 CAS miss 而直接結束；若 provider 不重送 ready，影片可能永久保留在 error。

新增的 bounded convergence helper 在每次 CAS miss 後重新讀取同一筆 local video，再依既有狀態規則決定能否重試：

- error-first 再 ready：error 的最新狀態允許 ready recovery，第二次 claim 會收斂至 ready。
- ready 之後的 error 或 processing：維持 ready，安全 no-op。
- 重複 ready：可安全重複處理，狀態不會倒退。
- mapping 被刪除：回傳安全 no-op。
- 最多三次 claim；耗盡時固定回應 `503` 與固定 code，沒有 video ID、provider payload 或 raw error。
- telemetry 僅接收 allowlisted fixed context；telemetry 自身失敗不影響固定 503。

## Deterministic evidence

- `npx vitest run src/lib/cloudflare-video-status.test.ts src/lib/cloudflare-video-transition.test.ts`：2 files、13 tests passed。
- 以 disposable local PostgreSQL schema `cd_wp97_cas_20260730` 套用 13 migrations 後，`route.test.ts`、status resolver、transition helper：3 files、27 tests passed。
- 27 tests 覆蓋既有簽章、oversize、unknown status、ambiguous mapping、stale/recovery 行為，以及新的 fixed contention 503、monitoring throw 和 DB invariant。
- 上述 disposable schema 已 `DROP SCHEMA`，並以 catalog query 確認不存在。
- scoped ESLint：PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `git diff --check`：PASS；staged index 為空。

完整 `npm test` 沒有取得可驗收的完成摘要；其後清除後仍殘留的本包子程序已停止。因此它明確是 `NOT_ACCEPTED_AS_PASS_NO_COMPLETE_SUMMARY`，沒有被作為加分證據。

## Ownership 與 rollback

本包 owned product paths：

- `src/app/api/cloudflare/stream-webhook/route.ts`
- `src/app/api/cloudflare/stream-webhook/route.test.ts`
- `src/lib/cloudflare-video-transition.ts`
- `src/lib/cloudflare-video-transition.test.ts`

status resolver、database layer、monitoring、Prisma schema 均為 `PRESERVE_ONLY`，pre/post SHA-256 維持一致。回滾僅能針對上述四個 owned paths 建立反向 patch；不得 reset、checkout、stash 或修改 preserve-only 檔案。

## Acceptance 與 score boundary

- Sol High verdict：`ACCEPT`。
- CAT-08：`5.5 → 6.0`。
- AGY Fast：`QA_RECEIPT_UNAVAILABLE_AFTER_2_ATTEMPTS`；未視為 PASS，也不取代 deterministic tests。

此分數只反映本機 Cloudflare Stream webhook 的 CAS 競態收斂與安全失敗處理；不涵蓋 production Cloudflare、scheduler、external telemetry delivery、Browser performance 或 CAT-08 的 7.5 門檻。
