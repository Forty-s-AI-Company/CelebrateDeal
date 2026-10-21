# 串流用量與額度 Runbook（F-092／PR #461）

適用：`/api/stream-usage` 用量心跳、`StreamUsageLedgerEntry` 帳本、`StreamUsageMonthlyCounter` 月計數列、商家串流分鐘額度（`VendorUsageLimit.streamMinutesLimit`）。

本文件中所有對正式環境的查詢或寫入，都要先取得 owner 授權；查詢只用唯讀帳號，寫入只在下面「人工重新播種」一節列出的情況下執行。

## 1. 第一次真正執行額度（部署前必讀）

**master 在 PR #461 之前，每一次真實心跳都會失敗（HTTP 500）。**

- 原因：帳本 `create` 的巢狀 `allocations.create` 帶了 `vendorId`，Prisma 在執行期拒絕；這個錯誤從 #136（2026-08-30）起就存在。單元測試用 mock，所以沒有發現。
- 影響：瀏覽器把 500 當成可重試，重試 3 次後暫停送出，播放照常進行。結果 `StreamUsageLedgerEntry` 與 `StreamUsageAllocationEntry` 實際上是空的，商家的串流額度**從未被執行**，`StreamUsageReconciliation` 也無法與 Cloudflare 對上。
- 本 PR 部署後：心跳會第一次真正入帳，額度會第一次真正生效。`streamMinutesLimit` 設得偏低的商家，觀眾可能在直播中收到 429，播放被暫停並顯示「直播播放額度已用完」。

部署前 owner 待辦：

1. 唯讀確認正式環境現況：

   ```sql
   -- 帳本是否為空（預期 0 或極少）
   SELECT count(*) FROM "StreamUsageLedgerEntry";
   -- 有設定有限額度的商家與額度
   SELECT "vendorId", "streamMinutesLimit", "entitlementStatus"
   FROM "VendorUsageLimit"
   WHERE "streamMinutesLimit" > 0
   ORDER BY "streamMinutesLimit";
   ```

   另在 Vercel 的 runtime log 確認 `/api/stream-usage` 的 500 比例。
2. 逐一檢查有限額度商家的 `streamMinutesLimit` 是否符合方案；偏低的先調整。
3. 通知有限額度的商家：額度從部署當天起實際計算，用完時觀眾會被暫停播放。
4. 決定過去少記的觀看分鐘：只對帳，不回補（帳本是 append-only，事後無法還原個別觀眾的觀看事件）。
5. 部署避開直播時段。

## 2. 部署順序：先 migrate，再部署

1. `prisma migrate deploy` 套用 `20261021150000_stream_usage_monthly_counter`（只新增資料表，不鎖既有資料表）。
2. 確認 `_prisma_migrations` 有這筆且 `finished_at` 不為空。
3. 才部署應用程式。

順序反過來的後果：新程式在資料表不存在時，心跳的原生 SQL 會失敗（P2010／`42P01`，回 500）；觀眾入場讀計數列也會失敗，**所有有限額度商家的觀眾都無法入場**。

## 3. Skew Protection 與少記

- 部署切換期間，仍在執行舊版程式的請求只寫帳本、不更新計數列，計數列會比帳本少記這段時間。
- Vercel 部署是原子切換；沒開 Skew Protection 時，重疊只有切換當下還在處理的請求，影響很小。
- 若 Vercel 專案有開 Skew Protection，舊頁面的 `/api/stream-usage` 會在 max age 內持續打到舊部署，少記量會放大。部署前在 Vercel 專案設定確認狀態，並記入 release 清單。
- 少記多少，額度就多放行多少，而且到月底都不會自動修正。用第 4、5 節對帳與修復。

## 4. 唯讀對帳查詢

比對當月每個商家的計數列與帳本加總：

```sql
SELECT
  l."vendorId",
  l."monthKey",
  l.ledger_seconds,
  c."watchSeconds" AS counter_seconds,
  l.ledger_seconds - COALESCE(c."watchSeconds", 0) AS counter_shortfall_seconds
FROM (
  SELECT "vendorId", "monthKey", SUM("watchSeconds")::integer AS ledger_seconds
  FROM "StreamUsageLedgerEntry"
  WHERE "monthKey" = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
  GROUP BY "vendorId", "monthKey"
) AS l
LEFT JOIN "StreamUsageMonthlyCounter" AS c
  ON c."vendorId" = l."vendorId" AND c."monthKey" = l."monthKey"
WHERE c."watchSeconds" IS DISTINCT FROM l.ledger_seconds
ORDER BY counter_shortfall_seconds DESC;
```

解讀：

- 沒有任何列：計數列與帳本一致。
- `counter_seconds` 為 NULL：該商家本月還沒有新心跳；下一次心跳會從帳本播種，不需處理。
- `counter_shortfall_seconds > 0`：計數列少記（部署重疊或手動寫入帳本），需要第 5 節修復。
- `counter_shortfall_seconds < 0`：計數列多於帳本，正常情況不應發生，先停下來調查，不要調降。

## 5. 人工重新播種（只往上修）

只在第 4 節查到 `counter_shortfall_seconds > 0` 時執行，需 owner 授權：

```sql
UPDATE "StreamUsageMonthlyCounter" AS c
SET "watchSeconds" = GREATEST(c."watchSeconds", l.ledger_seconds),
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT "vendorId", "monthKey", SUM("watchSeconds")::integer AS ledger_seconds
  FROM "StreamUsageLedgerEntry"
  WHERE "monthKey" = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
  GROUP BY "vendorId", "monthKey"
) AS l
WHERE c."vendorId" = l."vendorId"
  AND c."monthKey" = l."monthKey"
  AND c."watchSeconds" < l.ledger_seconds;
```

- 冪等：可以重複執行，只會往上修，不會把計數列調低。
- 可以在服務中執行：`UPDATE` 取得的列鎖與心跳相同，正在排隊的心跳會在它之後以新值判斷額度。
- 執行後再跑一次第 4 節，應該沒有 `counter_shortfall_seconds > 0` 的列。
- 修正後商家可能立刻進入 80% 或 100% 的額度狀態，執行前先通知受影響的商家。

## 6. 錯誤碼與觀眾端行為

| 回應 | 意義 | 觀眾端 |
|---|---|---|
| 200 | 已入帳（或同一個 eventId 重送） | 繼續 |
| 429 `stream_minutes_exhausted` | 真正的額度用完，或方案權益已撤銷（`entitlementStatus = revoked`） | 暫停播放，顯示額度用完提示 |
| 503 `Retry-After: 1` | `usage_busy`：死結或寫入衝突重試 3 次仍失敗，或交易等鎖／等連線逾時（P2028，`maxWait` 5 秒、`timeout` 10 秒） | 用同一個 eventId 退避重試，不暫停播放 |
| 403 | 沒有有效的入場 session | 重新入場 |
| 500 | 其他未預期錯誤 | 退避重試 |

同一商家的心跳在計數列上排隊執行。大型直播如果出現大量 503，代表單一商家的心跳排隊超過 10 秒，需要在 staging 以數百個同商家併發心跳量測後再調整。

## 7. 額度提醒

- 心跳讓用量**跨過** 80% 時開 `QUOTA_WARNING`，跨過 100% 時開 `QUOTA_EXHAUSTED` 並關閉警告；之後同月份的心跳不再重寫提醒，商家按過「已讀」不會被重新打開。
- 已知限制：心跳以 1～60 秒為單位入帳，超過額度的心跳會被整筆拒絕；用量剛好停在額度以下幾十秒時，`QUOTA_EXHAUSTED` 不會打開，但觀眾已經會收到 429。

## 8. 相關檔案

- `src/lib/stream-usage.ts`、`src/lib/stream-usage-counter.ts`、`src/app/api/stream-usage/route.ts`
- `src/lib/live-quota-admission.ts`（入場讀計數列）
- `prisma/migrations/20261021150000_stream_usage_monthly_counter/migration.sql`
- `docs/codex-goal/PRISMA_INVARIANTS.md`（F-092 段）
- 測試：`src/lib/stream-usage-counter.db.test.ts`
