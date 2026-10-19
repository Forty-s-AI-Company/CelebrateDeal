# A-02 執行收據

- 任務：文件盤點（`docs/review-2026Q4/02-docs-map.md`）
- 執行者：唯讀盤點員（Sonnet 5.5）
- 日期：2026-10-19；開始約 12:28，產出文件約 12:40，總花費約 12 分鐘（Asia/Taipei，本機時鐘）
- 盤點基準：`origin/master` @ `78621ca3`（#444）。工作分支 `codex/claude-handoff-20261017` 落後 master 15 個 commit，故數量以 master tree 為準

## 修改範圍

- 新增：`docs/review-2026Q4/02-docs-map.md`、本收據。
- 未修改任何既有檔案；未執行 git 寫入（`git fetch -q origin` 僅更新遠端追蹤 ref，屬唯讀於工作樹）；未讀取 `.env*`。
- 暫存統計檔寫在 scratchpad（`files.txt`、`gitlog.txt`、`stats.py`、`coarse.py`、`groups.tsv`），不在專案內。

## 執行過的命令（摘要）

| 目的 | 命令 |
|---|---|
| 檔案數量 | `find docs -type f \| wc -l`、`git ls-files docs`、`git ls-tree -r --name-only origin/master docs` |
| 與 master 差異 | `git rev-list --left-right --count HEAD...origin/master`、`git diff --stat HEAD origin/master -- docs`、`git log --oneline origin/master..HEAD` |
| 日期範圍 | `git log --name-only --format='@@%cs' origin/master -- docs`，再以 python 依前綴分群（檔名日期＋git 最後 commit） |
| ignore 狀態 | `git status --short --ignored docs`、`git check-ignore -v`、`grep -n 'docs\|reports' .gitignore` |
| canonical 內容 | `cat`／`head` 讀 `DOCUMENT_AUTHORITY.md`、`launch/CURRENT.md`、`NEXT-CYCLE.md`、`handoff-codex-to-claude-20261017.md`、`PRODUCT.md`、`domain-workflows.md`、6 個 `SKILL.md`、`codex-goal/*` 檔頭 |
| 數字核對 | `git ls-tree --name-only origin/master prisma/migrations/`、`git show origin/master:prisma/schema.prisma \| grep -c '^model '`、`git ls-tree … \| grep -c 'route.ts$'` |
| 引用關係 | `git grep -l`（scripts／tests／.github 對 `docs/...` 的引用；對 `.ai-team`、`.agents/skills`、`.codex/agents` 的殘留引用） |
| Codex 殘留 | `git show archive/wip/product-audit-goal-plan-20261017 --stat`（及 `--name-only`）、`git show <tag>:docs/launch/goal-plan-20261011-product-audit.md \| grep WP-`、`git tag -l 'archive/wip/*'` |
| PR 對照 | `git log --oneline origin/master -25`（另 `-60`、`--since=2026-10-15`）、`git ls-tree -r … \| grep live_metric` |

## 驗證結果（本次實際跑過的事實）

- master `docs/` 1,885 個 tracked 檔案；`docs/ai-team/evidence` 1,376（518 PNG）、`remaining-capabilities-*` 257、`branch-integration-*` 91、`docs/launch` 60、根目錄單檔 35。
- master 實際 148 models、108 migration 目錄、122 個 `route.ts`。
- 10 個 `scripts/*.test.*`、35 個 scripts 對 `docs/launch`／`docs/codex-goal`／`docs/ai-team/evidence` 有固定路徑引用。
- 83 個 docs 檔案（不含 evidence）、133 個 scripts、117 個 evidence 檔仍含已刪除的 `.ai-team`／`.agents/skills`／`.codex/agents` 字串。

## 未能完成或有保留的項目

1. **ARCHITECTURE_BOUNDARIES、AUTHORIZATION_MATRIX 是否仍反映現況**：只確認日期與無腳本引用，未逐條對照程式碼，標為「推測過期」。
2. **`API_CONTRACT_REGISTRY.md` 實際覆蓋的 route 數**：未重算（以 `scripts/api-contract-registry.test.ts` 為準），文件只指出「63」「27/27」等舊數字與現況不符。
3. **staging 實際部署來源**：repo 內沒有 10-19 的 tracked 收據；「staging 已部署 `78621ca3`」僅出自未追蹤的 goal plan 文件，未向 Vercel／GitHub 查證（此任務為唯讀文件盤點，未呼叫外部服務）。
4. **WP 對照屬推測**：只以 PR 標題的 WP 編號判斷；WP-19 與 #431 的關係、WP-10／WP-11 是否以未標編號的 PR 合併，無法由標題確認。另用 `git ls-tree` 檢查 live_metric migration（不在 master）作旁證。
5. **每個檔案的精確日期**：`docs/` 多數檔案 git 最後 commit 為 2026-08-30（整批匯入），日期範圍欄以「檔名日期＋git 日期」並列，無法還原真實撰寫日。
6. **工作樹獨有檔案**（gitignore 的 `codex-goal` 8 份、`live-feature-handoffs` 60 份、未追蹤的 `market-2026Q4`）僅依檔案系統統計，未讀取內文（`market-2026Q4` 為他人產出，未審閱）。
7. 未逐檔讀 JSON 收據（依指示）；`launch/` 35 個歷史檔的分類依檔名與引用關係判斷，未逐一開啟內文。
8. 未對 `launch/` 內 runbook 逐份核對是否符合現行 `.github/workflows`（建議後續項目）。
