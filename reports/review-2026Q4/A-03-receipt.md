# A-03 收據：測試地圖盤點

- 任務：產出 `docs/review-2026Q4/03-test-map.md`
- 執行者：唯讀測試盤點員（Sonnet）
- 開始：2026-10-19 12:28:54（本機時鐘）；結束：12:47（撰寫完成時）；總耗時約 18 分鐘（實際牆鐘，含 `gh` 查詢）
- 安全：未讀取 `.env*`；未執行任何測試套件、build、docker 或資料庫連線；未執行 git 寫入；既有檔案未修改（`git status` 的 `M PRODUCT.md` 與其他 untracked 在開始前就存在）

## 新增檔案

- `docs/review-2026Q4/03-test-map.md`
- `reports/review-2026Q4/A-03-receipt.md`
- 暫存腳本（scratchpad，不在 repo）：`topics.mjs`、`topics2.mjs`、`direct.mjs`、`cfgcount.mjs`（唯讀統計 `src/`）

## 主要命令（皆唯讀）

| 目的 | 命令（摘要） | 結果摘要 |
|---|---|---|
| 設定檔清單 | `ls vitest.*.config.ts playwright.*.config.ts prisma.*.config.*` | 20 vitest、15 playwright、5 prisma（4 disposable + 1 playwright）；另有 `vitest.config.ts`、`playwright.config.ts` |
| 設定檔內容 | `cat` 各設定檔 | 取得 include／testMatch、環境標記 |
| 呼叫端對照 | `grep -rIl <config> scripts .github package.json tests` | 8 個設定檔（4 vitest g7 + 4 prisma g7）無 runner／CI 參照 |
| 測試檔數 | `find src -name "*.test.ts*"`、`find scripts -name "*.test.*"`、`ls tests/e2e/*.spec.ts`、`grep -lE "node:test"` | src 662、scripts 190（TAP 135）、e2e spec 90、`.db.test` 42 |
| 主題分群 | `node topics2.mjs` | 見報告 §2.2 |
| import 圖交叉驗證 | `node direct.mjs` | lib 323/323、app 273/354、components 110/135 被測試觸及 |
| CI 讀取 | `cat .github/workflows/ci.yml`、`grep timeout-minutes .github/workflows/*.yml` | 24 個 workflow，僅 ci.yml 自動觸發，無 job timeout |
| 覆蓋率邏輯 | `cat scripts/run-combined-coverage.mjs`、`vitest.config.ts`、`vitest.synthetic-db-coverage.config.ts` | 門檻三處重複，synthetic 步驟未啟用 coverage |
| 近期 PR | `gh pr list --state merged --limit 30 --json number,title,mergedAt` | #412–#444；#437、#426、#427 與測試穩定性相關 |
| CI 歷史 | `gh run list --workflow CI --limit 60 --json ...` | 成功 42／失敗 18；成功耗時最小 25.2、中位 40.4、最大 72.9 分 |
| CI 步驟耗時 | `gh run view 39181999330 --json jobs` | job 32.6 分、49 步 |
| CI 失敗原因 | `gh run view <id> --log-failed`（39115688218、39142581174、39158056262、39147548693…） | 一次 Vitest 英文介面斷言失敗；多次 E2E 兩次皆失敗（非 flaky） |
| CI 測試量 | `gh run view 39181999330 --log`（過濾） | Vitest 757 檔／6357 tests、TAP 1225、覆蓋率 65.52/63.96/68.64/70.78 |
| 版本差異 | `git diff HEAD origin/master -- .github/workflows/ci.yml package.json`、`git ls-tree`、`git grep` | 本分支落後 master 約 15 個 PR |
| flaky 掃描 | `grep -rnE "test\.skip|it\.skip|describe\.skip|retries|flaky"` 與文件 grep | 條件式略過 4 處；無 `.only／.fixme／.todo` |

## 發現與限制（未完成項目）

1. **版本落差**：HEAD `a0c7ffdc` 落後 `origin/master` `78621ca3`。設定檔與測試數以 HEAD 為準；CI 實測值來自 master。master 多 1 個 playwright 設定（learner-notifications）、1 個 CI 步驟、約 39 個 src 測試。建議審查前先確認以哪個基準為準。
2. **未執行任何測試**：Vitest 檔數 717（HEAD）為依 include／exclude 規則計算的預估；master 以相同規則算得 757，與 CI 實測一致，可信度高，但 HEAD 無實測。
3. **靜態 case 數**為正規表示式統計，不含迴圈／`.each` 展開，僅作相對大小。
4. **主題分群為關鍵字啟發式**，可能有邊界誤判；缺口判斷已用 import 圖交叉驗證，但 import 圖不等於覆蓋率（無法在不執行測試下取得行覆蓋）。
5. **歷史 flaky**：run 36372141599、36410824308、36410861112 超出 `gh run list` 可查範圍，僅引用 `docs/launch/NEXT-CYCLE.md` 記載，未驗證；Playwright reporter 不輸出測試名，連續紅燈的具體測試無法還原。
6. **非 CI 設定檔的「最近通過紀錄」**只能指向 `docs/remaining-capabilities-*.json` 本機收據（2026-10-07/08），未對目前 HEAD／master 重驗，且 live-private-commerce 的最新相關收據是失敗紀錄。
7. **全量本機驗證耗時**（30–60 分）為由 CI 同類步驟外推的估計，未實測。
8. 未檢視 `ops/backup` 的 PowerShell 測試與 `prisma/` 內任何 migration 測試細節（CI 步驟已列入，未逐檔盤點）。
