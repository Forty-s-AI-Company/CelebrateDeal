# B-09／B-11 執行收據

- 日期：2026-10-19（Asia/Taipei）
- 分支：`codex/goal-review-2026q4`，與 `origin/master` `78621ca3` 相同（已 `git fetch`）
- 模式：唯讀。未修改任何既有檔案；僅新增下列 3 個檔案。

## 產出

| 檔案 | 內容 |
|---|---|
| `docs/review-2026Q4/19-observability-ci-supply-chain.md` | B-09：22 條 findings（B09-01～B09-22） |
| `docs/review-2026Q4/21-open-prs.md` | B-11：7 條 findings（B11-01～B11-07）＋#384／#420 狀態＋近 25 個 PR 的 owner sign-off 清單 |
| `reports/review-2026Q4/B-09-11-receipt.md` | 本收據 |

## 執行過的外部讀取指令

| 指令類型 | 目的 | 寫入? |
|---|---|---|
| `git fetch`、`git log`、`git show`、`git cat-file`、`git ls-remote --tags`、`git ls-tree`、`git merge-base` | 比對 master 與 #436 | 否（`fetch` 只更新遠端追蹤 ref） |
| `git merge-tree --write-tree origin/master origin/codex/audit-wp10-admin-mfa` | 判定衝突 | 僅在物件庫產生暫時 tree 物件（無 ref、無索引、無工作樹變動） |
| `gh pr list／view／diff`、`gh run list` | PR 與 workflow 狀態 | 否 |
| `gh api repos/.../actions/permissions*`、`branches/master/protection`、`environments`、`repos/.../`（security_and_analysis） | repo 設定 | 否（GET） |
| `npm ls braces`、`npm view <pkg>` | advisory 路徑與可修版本 | 否 |
| `node -e` 讀 `package-lock.json` | 統計 install script、integrity | 否 |

## 刻意沒做的事

- 未讀 `.env*`、未讀任何 secret 值；`gh api` 未列出 secret 或 variable 內容。
- 未呼叫 Vercel、Sentry、Cloudflare 的 API（雖然環境中有 Vercel MCP，為避免回傳含環境變數的專案物件，決定不使用）。因此 Vercel 方案、區域、環境變數、Production 實際部署權限，以及 repo 外是否已有排程，全部標為「需 owner 確認」。
- 未執行 `next build`、測試、`npm audit`（沿用 `04-static-scan.md` 與 `reports/review-2026Q4/A-04-audit*.txt` 的結果，並以 `npm ls`／`npm view` 補驗）。
- 未 merge、rebase、close 或評論任何 PR。

## 重要結論

1. 排程缺口屬實：無任何排程驅動 9 個 cron／jobs 端點；4 個 job 為 POST-only，Vercel Cron（只發 GET）無法直接驅動。
2. #436：建議 rebase（唯一衝突檔 `wp88-direct-url-guard-matrix.spec.ts` 是 CRLF／LF 造成的假衝突），並先處理 staging 財務 QA 帳號沒有 MFA 因子的問題後再合併；另需一次正式獨立審查。
3. 公開 repo 的 secret scanning、push protection、Dependabot 皆未啟用；CI 無 job timeout 與 concurrency。

## 對 04-static-scan.md 的補充

- braces advisory：已驗證 `eslint-config-next@16.4.2`（目前 latest）仍依賴 `fast-glob@3.3.1`，升級無法消除；`braces` 在 npm 沒有高於 3.0.3 的版本。
- `remaining-capabilities-source-map-security-*` 實為 `source-map-js` DoS advisory 的 override 修補（#376），不是公開 source map 的修補。

## 未驗證項目

見 19 號文件第 8 節。
