# WP-93 — Webhook Retry Lease Recovery 與本機可靠性證據

狀態：`ACCEPTED_PARTIAL_DETERMINISTIC_EVIDENCE`；Sol High 已接受本工作包，但證據範圍不足以調整 CAT-08 分數（維持 5.0／10）。

## 已完成

- `retrying` claim 以十分鐘 lease 與 `id`、`status`、`retryCount`、原始 `updatedAt` 的 CAS fence 回收。
- 新鮮 claim 不回收；到達上限的 stale claim 直接 `exhausted`，不呼叫 processor。
- retry failure 的 operational diagnostic 僅傳固定 source、operation、provider 與 status；既有 monitoring allowlist 負責拒絕不安全 context。
- `/billing/usage` 已納入既有 authenticated browser performance budget，門檻不寬於 dashboard。
- unit：`src/lib/webhook-retry.test.ts` 10 passed。
- scoped ESLint、`tsc --noEmit` 與 `git diff --check` 通過。
- 以排除 `.env*` 的 OS temp mirror、node_modules junction 與 synthetic loopback configuration 建立唯一 PostgreSQL 16 schema；13 migrations 後執行 payment-webhook、monitoring、failure-code、job route suites：4 files、45 passed。schema 已 `DROP ... CASCADE` 清除。

## 邊界與未完成 gate

- 一開始曾嘗試從 workspace 直接執行 Prisma；其 config 會呼叫 dotenv，因而立刻停止該路徑並清除 disposable DB。後續所有 Prisma／Vitest integration 都改在沒有 `.env*` 的 mirror 執行；本包不把前一次嘗試列為 no-env evidence。
- 尚未完成 production-mode Playwright performance run、受控 server／mirror cleanup receipt 與完整 WP-93 runner，因此不得宣稱 CAT-08 7.5、field CWV、telemetry delivery 或 production reliability。

## Browser gate 結果

- 在同一 no-env mirror、synthetic loopback schema 與 production-mode Playwright lifecycle 下，Next/Turbopack 拒絕 workspace 外的 `node_modules` junction，production server 未能啟動；這是 isolation toolchain failure，不是 browser performance PASS 或產品 route failure。
- disposable schema 已在 finally 清除。實體 mirror 的清理曾遇到 `EBUSY`；本次工作包結案後的本機清理也被執行環境政策拒絕，故保留為受控 OS temp cleanup 項目，未影響 workspace 或資料庫。若要完成此 gate，必須在乾淨、非 junction、依 lockfile 安裝完整相依套件的原生工作副本執行，不得沿用本次 mirror 或以 workspace server 替代。

## Sol High acceptance

- Verdict：`ACCEPT`。
- 接受範圍：unit 10 passed、integration 45 passed、13 migrations 的 disposable loopback schema、schema cleanup、scoped ESLint、TypeScript 與 diff check。
- Browser performance 仍為 `TOOL_BLOCKED`：Turbopack 不接受 junction mirror；實體 offline mirror 缺可執行的 Next.js，且已在 `npx` 企圖下載不同版本前停止。這不是產品 route 的 PASS 或 FAIL。
- 由於同一根因已重複三次，禁止在此工作包重試相同 mirror；release 前需以新的原生副本補做 Playwright。
