# A-04 靜態掃描收據

日期：2026-10-19；分支 `codex/claude-handoff-20261017`；Node v22.23.1。耗時為實際牆鐘時間。

| # | 命令 | exit code | 耗時 | 完成 | 狀態 | 輸出 |
|---|---|---|---|---|---|---|
| 1a | `npm run typecheck` | 2 | 154s | 是 | FAIL（313 錯誤；主因本機 Prisma Client 過期與 stale `.next`） | A-04-typecheck.txt |
| 1b | `npm run typecheck:strict-index` | 2 | 55s | 是 | FAIL（125 錯誤，同源） | A-04-typecheck-strict-index.txt |
| 1c | 隔離 `tsc --noEmit`（scratchpad 內重新產生的 Prisma Client、排除 `.next`） | 0 | 83s | 是 | PASS（補充驗證，不取代 1a） | A-04-typecheck-freshprisma.txt |
| 1d | 隔離 strict-index | 0 | 42s | 是 | PASS（補充驗證，不取代 1b） | A-04-typecheck-strict-freshprisma.txt |
| 2 | `npm run lint` | 0 | 133s | 是 | PASS（0 errors / 3 warnings） | A-04-lint.txt |
| 3a | `npm audit --json` | 1 | 5s | 是 | 5 high（皆 dev-only，無修補版） | A-04-audit.txt |
| 3b | `npm audit --omit=dev --json` | 0 | 8s | 是 | PASS（0） | A-04-audit-prod.txt |
| 4a | `npx --yes knip@5 --reporter json`（預設設定） | 2 | 19s | 否 | TOOL_BLOCKED（載入 `vitest.course-community-db.config.ts` 時 throw：需要 disposable binding） | A-04-knip-default-failed.txt |
| 4b | `npx --yes knip@5 --config <scratchpad>/knip.json --reporter json`（關閉 vitest／playwright plugin） | 1 | 20s | 是 | 完成（exit 1 代表有 issue） | A-04-knip.txt |
| 4c | `npx --yes knip@5 --production --config <scratchpad>/knip-prod.json --reporter json` | 1 | 15s | 是 | 完成（exit 1 代表有 issue）；首次嘗試因設定未排除測試檔，已用第二次結果覆寫 | A-04-knip-production.txt |
| 5 | `npx --yes madge@8 --circular --extensions ts,tsx --ts-config tsconfig.json src` | 1 | 34s | 是 | 完成（exit 1 代表找到 1 個循環） | A-04-madge.txt |
| 6 | `npm run secret:scan` | 0 | 3s | 是 | PASS（`secret_scan_passed`） | A-04-secret-scan.txt |
| 7a | `git log --since=2026-07-01 --format= --name-only origin/master \| sort \| uniq -c \| sort -rn \| head -40` | 0 | 4s | 是 | 完成（未 fetch，origin/master = 78621ca3） | A-04-hotspots-gitlog.txt |
| 7b | `wc -l` 前 30 長檔案與 >800 行清單 | 0 | 5s | 是 | 完成 | A-04-loc.txt |
| 8 | Next.js 版本與棄用 grep | 0（首次 124 逾時，因 `find` 掃入 node_modules，改為 `ls` 後重跑） | 5s | 是 | 完成 | A-04-nextjs-deprecation.txt |
| 9a | `du` 依賴大小 | 0 | 38s | 是 | 完成 | A-04-dependency-sizes.txt |
| 9b | `next build`（First Load JS） | 未執行 | - | 否 | NOT_RUN：會觸發 `prisma generate` 覆寫共用 `node_modules/.prisma`、Prisma Client 過期導致型別檢查必失敗、需讀 `.env*`、會覆寫 `.next`；詳見 04-static-scan.md 第 9 節 | 無 |

## 副作用與限制

- 未修改任何既有檔案；未寫入 git；未讀取 `.env*`；未更動 `package.json`。
- 新增檔案僅限 `reports/review-2026Q4/A-04-*.txt`、本收據、`docs/review-2026Q4/04-static-scan.md`。
- 1c／1d、4b／4c 使用的暫存設定與重新產生的 Prisma Client 都在 scratchpad（`pgen/`、`knip*.json`）；`pgen/node_modules` 是指向專案 `node_modules` 的 junction，未複製也未修改其內容。
- 官方 typecheck 可能更新 `tsconfig.tsbuildinfo`（`git status` 無新增差異）。
