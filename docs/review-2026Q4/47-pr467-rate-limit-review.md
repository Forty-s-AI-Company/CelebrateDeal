# PR #467 審查：帳號鎖定剩餘秒數 3601 抖動修正

- 分支：`codex/beta-fix-rate-limit-flake`，commit `26b0c7f3`，比對 `origin/master`
- 範圍：`src/lib/account-rate-limit.ts`、`src/lib/account-rate-limit.db.test.ts`
- 審查者：reviewer（Opus），2026-10-22
- 結論：**可合併**（合併前需 `quality` CI 綠燈；審查當下仍 pending）

## 檢查結果

1. 金流：本 PR 不涉及金額、退款與佣金，無發現。
2. 租戶邊界：key 依舊是 scope + subject 的 SHA-256，`keyHash` 綁定不變。不涉及 vendor ID，無發現。
3. Auth／權限：`lockAccount`（`account-rate-limit.ts:121-131`）的語意不變，仍是 upsert，並把 `windowStartedAt` 重設為現在、`count = 1`。`accountLockRemainingSeconds` 未改；呼叫端 `auth-security-actions.ts:296,311` 的「>0 即 locked」與 fail-closed（catch 後回傳 `temporarily_unavailable`／503）都維持原樣，登入的 `login_account` 限流也只改寫入時刻的取值方式。無發現。
4. 資料：欄位在 migration `20261021160000_account_rate_limit_bucket` 中定義為 `TIMESTAMP(3)`，也就是 timestamp without time zone，Prisma 以 UTC 寫入。`now() AT TIME ZONE 'UTC'` 產生 timestamp without tz，`date_trunc('milliseconds', …)` 仍回傳同型別，與既有讀取端（`accountLockRemainingSeconds` 第 137 行、sweep 第 100 行、`retryAfterSeconds` 第 88 行）的 UTC 基準一致。沒有 migration，也不影響既有資料列。無發現。
5. 正確性：
   - 根因成立。PostgreSQL 把 typmod 強制轉成 `timestamp(3)` 時會四捨五入，微秒部分 ≥ 500 會進位，使儲存的起點比交易的 now() 晚最多 0.5 ms，`ceil` 之後就成了 3601。改成 `date_trunc` 後，儲存的起點一定 ≤ now()，所以剩餘秒數 ≤ duration。
   - 長度變化：鎖定與視窗的起點相對真實時間往前移不到 1 ms（舊作法是 ±0.5 ms），所以有效長度縮短不超過 1 ms，符合要求。`consumeAccountRateLimit` 中，`windowStartedAt` 與 `updatedAt` 由同一個截斷值寫入，視窗判斷（第 76、81 行）兩側都是截斷值，比較語意不變，`retryAfterSeconds` 也 ≤ window。
   - 併發：`ON CONFLICT` 的原子 upsert 沒有變動。
   - 測試：新增的案例（`account-rate-limit.db.test.ts:146-158`）在單一交易內先 lock 再讀；交易內 now() 固定，所以新實作會穩定得到 3600。舊實作每輪約有 50% 機率進位成 3601，25 輪全部漏掉的機率約 3e-8，足以抓到回歸。沒有放寬任何既有斷言（第 138-139 行仍是 `>3590` 且 `<=3600`），也沒有 skip。

## Findings

- BLOCKER：無。
- MAJOR：無。
- MINOR：無。
- NIT `src/lib/account-rate-limit.db.test.ts:146`：回歸測試的偵測力取決於 DB 時鐘是否有微秒解析度。如果測試庫的 `now()` 只有毫秒粒度（某些 Windows／VM 時鐘），舊實作也會通過，測試等於沒有檢查到東西；CI 的 Linux PostgreSQL 不受影響。可選的改善：在同一交易中另外斷言 `"windowStartedAt" <= now() AT TIME ZONE 'UTC'`，或直接比較 `windowStartedAt = date_trunc('milliseconds', now() AT TIME ZONE 'UTC')`，讓檢查不依賴進位機率。
- NIT：第 88 行的 `retryAfterSeconds` 改前改後都不會因進位而超過 window（兩個欄位同步進位），這部分的改動屬於一致性調整，並非修 bug。說明這點只是為了讓 PR 描述更準確。

## 驗證紀錄

- 本機執行 `npx vitest run src/lib/account-rate-limit.db.test.ts`：**未能執行**，因為測試庫 `localhost:54329` 沒有啟動（`Can't reach database server`），12 個案例都在連線階段失敗，與本 PR 無關。這些 DB 測試**沒有在本機通過**，要以 CI `quality`（`test:db:concurrency`）的結果為準。
- 沒有執行 typecheck 與 lint，改動只限 SQL 字串與註解。
- `gh pr checks 467`：`quality` pending，Vercel staging pass。
