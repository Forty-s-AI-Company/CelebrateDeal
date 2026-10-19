# B-08／B-10 執行收據

- 日期：2026-10-19（Asia/Taipei）
- 分支：`codex/goal-review-2026q4`，與 `origin/master` `78621ca3` 相同
- 模式：唯讀。未修改任何既有檔案、未做 git 寫入（沒有 tag／branch／worktree／commit 操作）、未讀取 `.env*`、未在其他 worktree 內寫入；僅新增下列 3 個檔案。

## 產出

| 檔案 | 內容 |
|---|---|
| `docs/review-2026Q4/18-test-quality.md` | B-08：12 條 findings（B08-01～B08-12）、假測試盤點、28 個金流／權限測試檔的 assertion 強度表、覆蓋率合成說明、flaky 假說與驗證方法、CI 合併方案、設定檔收斂方案、封測前最值得補的 10 個測試 |
| `docs/review-2026Q4/20-dead-code-residue.md` | B-10：15 條 findings（B10-01～B10-15）、正式 bundle 殘留逐項判定、knip 19 個檔案逐一判定、9 個 worktree 處置與安全移除步驟、文件封存批次與 43 個釘住檔、`docs/codex-goal` 處置、`.ai-team` 引用判斷 |
| `reports/review-2026Q4/B-08-10-receipt.md` | 本收據 |

## 執行過的指令

| 指令類型 | 目的 | 寫入? |
|---|---|---|
| `git ls-files`、`git grep`、`git log`、`git show`、`git cherry`、`git merge-base --is-ancestor`、`git tag -l`、`git tag --contains`、`git rev-list --count`、`git ls-tree`、`git rev-parse`、`git worktree list --porcelain`、`git check-ignore` | 引用核對、worktree 與分支比對、tag 備份核對 | 否 |
| `git -C <worktree> status --porcelain`、`git -C <worktree> log -1` | 各 worktree 的未提交變更與最後提交 | 否 |
| `git ls-remote --heads`／`--tags origin` | 核對遠端分支與 82 個 archive tag 是否在 origin | 否（只讀遠端） |
| `Get-Item <worktree>\node_modules -Force`（PowerShell） | 判定 `node_modules` 是實體目錄、junction 或 symlink | 否 |
| `ls`／`find`／`wc`／`du`／`cat`／`sed -n` | 讀取原始碼、設定與文件 | 否 |
| `node` 腳本（存放於 session scratchpad，不在 repo 內）：以 TypeScript compiler API 解析 992 個測試檔（case／assertion／讀檔／`vi.mock`／skip）、分類 97 個讀檔型測試、掃描 133 個 `.ai-team` 引用、讀取 readiness 快照的 provenance 清單 | 測試品質與文件釘住的統計 | 否（只寫 scratchpad 的中間 JSON） |
| `npx vitest run`（僅 4 個檔案：`customer-crm-actions.test.ts`、`mobile-consultation-actions.test.ts`、`customers/page.test.tsx`、`consultations/mobile/page.test.tsx`） | 確認 4 個「原始碼字串」測試實際通過及耗時：4 檔 7 tests 通過，tests 39 ms | 否（可能更新 `node_modules/.vite` 快取；`git status` 前後相同） |
| 讀取 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/pageExtensions.md` | AGENTS.md 要求改 Next.js 相關建議前先讀文件；確認以 `pageExtensions` 在建置期排除 App Router 路由需要更名所有 route 檔，因此改建議以 `proxy.ts` 做正式環境 404 | 否 |

## 刻意沒做的事

- 沒有執行 e2e、完整 Vitest、覆蓋率、DB 測試、`next build`、`npm audit`；flaky 根因與 CI 節省分鐘數是假說與推估，文件內都已標明。
- 沒有對任何 Vercel／Cloudflare／PayUni／Resend／PostHog 環境發送請求；ops 端點的守門描述來自讀原始碼。
- 沒有進入 `~/.codex/worktrees` 底下 23 個未登記目錄，也沒有逐一比對各 worktree 的 wip tag 內容與目前檔案內容是否相同（只比對路徑是否存在於 tag）。
- 沒有刪除、移動、封存任何檔案，沒有移除任何 worktree，也沒有補任何 tag（建議的 tag 與移除步驟寫在 20 號文件 §4.3，由主對話執行）。

## 重要結論

1. 沒有找到真正沒有 assertion 的測試，沒有 `expect(true)`、`.only`、`.skip`（條件式略過 4 處）。但有 4 個檔案 7 個 case 只讀原始碼做 `toContain`（CRM、行動諮詢），39 ms 通過，不執行被測程式。
2. 測試保護金流的最大問題不是斷言太弱，而是輸入不真實（PayUni 回呼 fixture 是自創欄位）、已知缺陷被測試釘住（`auth.test.ts:224`）、以及 B03 的月結問題完全沒有回歸測試。
3. `vitest.synthetic-db-coverage.config.ts` 的 thresholds 不會被評估（CI 命令無 `--coverage`）；該步驟其實是整個測試集在獨立 schema 重跑，約 3.5 分鐘可省。`coverage.exclude` 沒有排除任何高風險目錄。
4. CI 單一 job 串行 32.6 分鐘，照建議合併與拆分預估牆鐘可降到約 12–14 分鐘；`push`＋`pull_request` 雙觸發每次 PR 更新多花約 32 runner 分鐘。
5. 28 條 ops 端點中 5 條只靠 `JOB_SECRET`；`wp4-*` 沙盒輔助（含可建立 MFA-verified session 的函式）編進正式 auth／結帳／發票路徑，雖然有多層環境閘門，仍建議移出正式 bundle。
6. `src/app/__test`、`src/app/sentry-example-page` 在 master 是空資料夾，`sentry-example-api` 不存在。
7. 9 個 worktree：保留主目錄與 PR #436 的 `codex/audit-wp10-admin-mfa`；其餘 7 個有 archive tag 備份，其中 notifications 的本機 merge commit 需先補 tag，commission policy 與 staging 回復點需 owner 確認；`wp4-secure-runner` 的 `node_modules` 是指向不存在目標的 symlink，另有 880 MB 的 `node_modules.incomplete-*`。
8. `docs/` 有 1,725 個檔案（91.5%）可第一批封存；43 個檔案被測試或 CI 腳本以固定路徑讀取（02 號文件估 22 個，加上 `readiness-truth-reconciliation.mjs` 對快照 provenance 的存在性檢查後修正為 43）。
9. 133 個 `.ai-team` 引用的 scripts 在 CI 內的 11 個都沒有壞（把它當成被 gitignore 的收據輸出資料夾）；只有 9 個不在 CI 的歷史 runner 會因缺少舊收據而失敗。

## 與其他軸線的交叉

- B08-02／B08-03／B08-04 對應 B03-01、B03-04、B03-13、B04-13、B02-01、B03-02、B03-03、B03-05（先寫紅燈測試再修）。
- B08-05 直接引用 `12-tenant-auth.md`「第二租戶測試缺口」12 項。
- B08-09 與 `19-observability-ci-supply-chain.md` 的「CI 無 job timeout 與 concurrency」互相印證；若兩邊都要改 `ci.yml`，建議同一個 PR 處理。
- B10-01 延伸 B03-21；B10-11 延伸 `02-docs-map.md` 的「釘住」清單（22 → 43）；B10-12 延伸 B04-23。

## 需要主對話注意

- 本機 `master` 分支停在 `efb8b7e9`，任何後續「是否已合併」的檢查請使用 `origin/master`。
- 18 號文件 §7.2 的 10 個測試，其中 #1–#3、#7、#8 建議先寫成紅燈測試再修（會讓 CI 暫時變紅，需在修復 PR 內同時提交）。
- 20 號文件的 worktree 與 tag 操作都是 git 寫入，由主對話在 owner 同意後執行。
