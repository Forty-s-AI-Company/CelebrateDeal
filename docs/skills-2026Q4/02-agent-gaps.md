# 02 Agent 缺口分析（D-02）

- 基線：`review-baseline-2026Q4` = `origin/master@78621ca3`；日期 2026-10-19（Asia/Taipei）
- 方式：唯讀；diff 與草稿都是建議，未套用。
- 輸入：`01-skill-inventory.md`、Phase B 報告 `11`～`21`、`docs/goal-plan-review-research-skills-20261017.md`。
- 範圍：#428 之後還缺什麼。四件事：(1) Critical 軸線專屬 reviewer 檢查清單；(2) Goal 狀態追蹤；(3) 內建 `code-review`／`security-review`／`simplify` 如何接進 PR 流程；(4) 封測期間 bug triage。

## 0. 結論先講

1. **Critical 軸線需要專屬檢查清單，放進 skill，而不是塞進 reviewer prompt。** B 階段的 findings 有明顯重複的「失敗型態」（例如「事件狀態沒檢查就入帳」「平台自收款混進商家營收」「身份模型共用角色」「新表沒開 RLS」）。把這些型態寫成清單，reviewer 才不會每次重新發現同一類問題。草稿見 §1，名稱 `celebratedeal-review-checklists`。
2. **Goal 狀態改用「repo 內單一 `STATE.md` 檔＋GitHub Issues」兩層**：repo 檔是唯一真相來源（可 diff、可審、離線可讀），GitHub Issues 用來承接封測 bug 與對外可見的待辦；**暫不使用 GitHub Projects**（目前 `gh` token 沒有 `project` scope）。舊的 `.ai-team/state/goal-state.json` 從來就被 `.gitignore:97` 排除，沒有版本歷史，這次要避免重蹈。見 §2。
3. **內建 skill 不要「每個 PR 全跑」**，依風險分級（§3.2）：reviewer 是必經閘門；`security-review` 只用於 auth／租戶／付款／webhook／RLS；`code-review high` 用於大 diff；`code-review ultra` 只留給封測前的 release candidate 增量審查。**reviewer 的工具清單沒有 `Skill`，不能自己呼叫這些 skill**，必須由主對話呼叫。
4. **封測 bug triage 要先解決一個隱私問題**：repo 是 public，客戶回報不能直接貼進 Issue 或 `docs/`。流程用「私下收件＋去識別 Issue」兩段，見 §4。

## 1. Critical 軸線的 reviewer 檢查清單

### 1.1 為什麼要寫成 skill

- reviewer prompt 現在的 5 點是通用原則，抓得到「有沒有綁 vendorId」，抓不到 B-03 那種「欄位語意對不上 provider 真實回呼」的缺陷（`TradeStatus` 沒檢查、`cents(undefined)` 回 0）。
- B 階段用掉的 Opus 時間大部分花在重新建立這些型態。清單可重複使用到封測期間的每一次修復審查。
- 放 skill 而不是 agent prompt：可以用 `skills:` 預載（見 01 §3.3，需實測），也可以讓主對話在 `code-review` 時用同一份清單當輸入。

### 1.2 變更路徑 → 清單對照

reviewer 一個 PR 只跑一次，依路徑選清單；跨軸線就同一次看多份，不分次審。

| 變更路徑（任一命中） | 套用清單 |
|---|---|
| `src/lib/auth.ts`、`csrf.ts`、`rate-limit.ts`、`api-security.ts`、`merchant-api-security.ts`、`student-portal-auth.ts`、`src/proxy.ts`、`src/app/actions/**`、`src/app/api/**`（非付款）、`src/app/admin/**` | 租戶與授權（T） |
| `src/lib/payment*`、`payment-providers/**`、`billing*.ts`、`api/payments/**`、`api/webhooks/**`、`api/jobs/**`、`refund*`、`affiliate*`、`inventory-reservations.ts`、`src/app/actions.ts` 的結算／出款／退款區段 | 金流與帳務（P） |
| `prisma/schema.prisma`、`prisma/migrations/**`、`prisma/seed.ts`、`sensitive-data.ts`、`bank-account.ts` | 資料與 migration（D） |
| `src/app/**/page.tsx`／`layout.tsx`／`error.tsx`／`loading.tsx`、`next.config.ts`、`src/instrumentation*.ts` | Next.js 慣例（N，選用） |

### 1.3 `celebratedeal-review-checklists` 草稿

位置建議 `.claude/skills/celebratedeal-review-checklists/SKILL.md`。依 Goal Plan §6.2 D-03 的規則，**先放 `docs/skills-2026Q4/drafts/` 驗證觸發與效果，再進 `.claude/skills/`**；此處給完整內容以便直接建檔。

```diff
diff --git a/.claude/skills/celebratedeal-review-checklists/SKILL.md b/.claude/skills/celebratedeal-review-checklists/SKILL.md
new file mode 100644
--- /dev/null
+++ b/.claude/skills/celebratedeal-review-checklists/SKILL.md
@@ -0,0 +1,64 @@
+---
+name: celebratedeal-review-checklists
+description: 審查 CelebrateDeal 的 diff 或程式區域時使用：租戶授權（auth、vendorId、Server Action、API route、MFA）、金流帳務（PayUni 回呼、結帳、退款、佣金、settlement、payout、排程 job）、資料與 migration（Prisma schema、migration、RLS、約束、金鑰）。Use when reviewing changes to auth, tenant boundaries, payments, billing, webhooks, migrations or schema.
+---
+
+依變更路徑選用下列清單，逐條回答「符合／不符合／未驗證」並附 `檔案:行號`。未驗證不得寫成符合。
+一個 PR 只審一次；跨軸線時合併使用。嚴重度：BLOCKER／MAJOR／MINOR／NIT。
+
+## T 租戶與授權
+- T1 對每個進入點列出：actor 如何驗證 → 需要哪個 capability → 輸入 ID 在哪個 DB 呼叫綁 `vendorId`。三者缺一即 finding。
+- T2 `where: { id }` 單鍵查詢：確認屬平台層級；商家層級必須是複合條件。relation `connect` 也要綁。
+- T3 拒絕回應一致（404／not_found），不揭露他租戶資料是否存在，也不在錯誤訊息回傳他租戶欄位。
+- T4 平台動作（退款、結算、出款、銀行帳號匯出、ops 端點）：platform role＋MFA 已驗證＋audit；商家 finance 不得進入。
+- T5 身份模型：partner／affiliate／student／staff 是否與商家成員共用同一角色或 session（見 B02-02）。
+- T6 第二租戶負向測試存在且斷言「無寫入」，而不只是 HTTP 狀態碼。
+- T7 新 route 是否被 `src/proxy.ts`／CSRF／rate limit 涵蓋；job／ops 端點在 Production 的行為（B10-01）。
+- T8 新表／新欄位：tenant key、FK、unique、index；RLS 是否啟用、`anon`／`authenticated` 權限是否撤銷（B02-03）。
+
+## P 金流與帳務
+- P1 金額、幣別、費率、affiliate 只來自伺服器紀錄；client 值只作為候選，不可覆寫。非 TWD 幣別是否被拒（B03-05）。
+- P2 Webhook 順序：驗簽 → 解析 → **檢查 provider 狀態為成功** → 對應已知 pending order → 金額與幣別相符 → 入帳。任何一步缺漏即 BLOCKER（B03-01）。
+- P3 冪等鍵（provider＋event ID／refund event ID／chargeback event ID）有 DB 唯一約束；重送、亂序、併發有測試。
+- P4 provider 欄位：測試 fixture 使用 provider 文件的真實欄位名稱；缺欄位時不得預設為 0 或空字串後仍入帳（B03-04、B08-02）。
+- P5 區分用途：平台訂閱費、帳單付款、商家商品收款不得混算（`billingPurpose`，B03-02）。
+- P6 退款：可退餘額由伺服器計算；跨月（已鎖結算）以 adjustment 追加，不改舊 ledger（B03-03）；`sum(RefundRecord)` 與 `refundedAmount` 一致。
+- P7 佣金：只在確認付款後產生；退款／拒付有對應負向 adjustment；self-referral、過期連結、無效 affiliate 的行為有測試。「聯盟只累計不出款」時，是否仍從商家撥款扣除佣金（B03-08）。
+- P8 非同步工作：此 PR 依賴的 job（webhook 重試、庫存釋放、月結）是否真的有人排程呼叫；GET／POST 與密鑰型態是否和排程器相符（B09-01）。
+- P9 庫存：保留逾期後才收到 paid、庫存已售完時，結果必須是可處理的明確狀態，不能靜默失敗（B03-07）。
+- P10 對帳公式以 DB 驗證，而不是文字敘述；測試不得降低 assertion 或覆蓋率門檻。
+
+## D 資料與 migration
+- D1 Migration 只能往前；既有資料列上可安全執行（NOT NULL 需 default 或回填；大表索引用 `CONCURRENTLY` 評估）。
+- D2 `schema.prisma` 與 migration 無漂移（`prisma migrate diff --exit-code`，B04-04）；migration 時間序在合併後仍單調（B04-09）。
+- D3 財務表的 `onDelete`：Vendor 刪除不得串聯刪除交易、退款、結算（應 RESTRICT，B04-02）。
+- D4 帳務 CHECK／unique：金額 > 0、`refunded <= gross`、訂單號唯一且不可預測（B04-06、B04-07）。
+- D5 敏感欄位：加密、金鑰來源、輪替影響；`CSRF_SECRET` 屬資料根金鑰，不可輪替（B04-03）。
+- D6 新查詢的索引（`vendorId`＋常用排序欄）；`findMany` 有 `take`（B06-11）。
+- D7 已登記 `docs/codex-goal/PRISMA_INVARIANTS.md`；`seed`／bootstrap 不含正式價格或帳號。
+- D8 個資：保存期限、刪除流程、不得進 Sentry／log。
+
+## N Next.js 16（選用）
+- N1 已讀 `node_modules/next/dist/docs/` 對應章節並在報告列出路徑。
+- N2 `error.tsx` 不洩漏 `error.message`；金流相鄰表單使用 pending／防重送（B05-01、B05-09）。
+- N3 `force-dynamic`、快取與 `proxy.ts` 行為變更需說明對 404／503 契約的影響（B05-04）。
+
+## 輸出
+findings 表欄位：ID、嚴重度、檔案:行號、問題、為何重要（情境）、重現／測試、建議修法、估工、需 owner 決策、封測前必修。
+最後列「未覆蓋」與「無法驗證」。報告用繁體中文（台灣用語）。
```

### 1.4 驗證方式

依 Goal Plan 的規則用 `skill-creator` 的 eval 流程驗證，具體做法：

1. 取 3 個已知答案的 diff 做回歸：(a) B03-01 的修復前版本（應抓到 P2）；(b) `requireFinanceAdmin` 修復前（應抓到 T4）；(c) 任一缺 `onDelete: Restrict` 的財務表（應抓到 D3）。
2. 每個 diff 跑「有預載清單」與「無預載清單」各一次，比較是否抓到。清單沒有提高命中率就不進 `.claude/skills/`。
3. 觸發測試：用 8 句不同說法（含只給檔名的任務）檢查 skill 是否被自動載入。

## 2. Goal 狀態追蹤

### 2.1 事實

- `.ai-team/state/goal-state.json` 被 `.gitignore:97` 排除（`git check-ignore -v .ai-team/state` 確認），所以舊機制只存在單一工作目錄；多個 worktree 之間不共享，也沒有版本歷史。
- 現有的 Goal 文件只有 `docs/goal-plan-review-research-skills-20261017.md` 的「PLAN_STATUS」一行與各 WP receipt；沒有可一眼看到「哪個 WP 誰在做、哪個 PR、哪個檔案被鎖」的表。
- `gh` token scope 為 `repo`、`read:org`、`gist`、`admin:public_key`；沒有 `project`。GitHub Projects v2 的 API 會被拒絕，需 owner 執行 `gh auth refresh -s project` 才能用。

### 2.2 選項比較

| 選項 | 優點 | 缺點 |
|---|---|---|
| repo 檔 `docs/goal-*/STATE.md` | 有 diff 與歷史；離線可讀；代理只要 `git pull` 就看得到；可進 PR 審 | 多人同時改會衝突；每次更新是一個 commit |
| GitHub Issues＋labels | 對 owner 可見、可從手機看；與 PR 自動連結（`Fixes #`）；`repo` scope 即可 | 公開（不可放客戶資料）；狀態分散在多張 issue |
| GitHub Projects v2 | 看板直觀 | 目前沒有 `project` scope，需 owner 操作；對單人團隊價值有限 |
| Claude Code 排程任務／工作清單 | 與 session 綁定 | 不跨 session 持久、不可審 |

### 2.3 建議：兩層

1. **唯一真相來源**：`docs/goal-<slug>/STATE.md`，**只有主對話編輯**（子代理只回報，不寫此檔）。單一 writer 就沒有合併衝突。封測前的修復 Goal 建議路徑 `docs/goal-beta-prep-2026Q4/STATE.md`。
2. **對外與封測用**：GitHub Issues，標籤 `beta-blocker`、`finding:B03-01`、`wp:<id>`、`sev:S0..S3`；每個封測前必修的 finding 一張 issue，PR 以 `Fixes #n` 連結。Issue 內不放任何客戶資料。
3. 不使用 Projects，直到 owner 同意授權 `project` scope 且確實需要看板。
4. 舊 `docs/codex-goal/*`、`docs/ai-team/*` 的狀態檔不沿用；`DOCUMENT_AUTHORITY.md` 需新增一行指向新的 `STATE.md`，避免代理又去讀過期狀態（A-02 已點出此風險）。

`STATE.md` 範本：

```markdown
# Goal 狀態：封測前修復（beta-prep-2026Q4）

STATUS：IN_PROGRESS　更新：2026-10-19 18:00（Asia/Taipei）　編輯者：主對話（唯一 writer）
基線：master@78621ca3　RC 候選：（尚未建立）　封測日：2026-11-01

## 工作項目
| WP | Finding | 類別 | 優先 | 狀態 | 負責 | 分支 | PR | 審查證據 | 備註 |
|---|---|---|---|---|---|---|---|---|---|
| FIX-01 | B02-01、B11-01～03 | H | P0 | rebase 中 | engineer-hard | codex/fix-b02-01-admin-mfa | #436 | （待）docs/review-2026Q4/fixes/… | 需 owner OK 才合併 |
| FIX-02 | B03-01、B08-02 | H | P0 | 未開始 | — | — | — | — | 需 owner 提供 Sandbox 回呼樣本 |

狀態值：未開始／已派工／實作中／待審查／審查中／待 CI／待合併／已合併／阻擋（寫原因）／延後

## 檔案鎖
| 檔案或目錄 | 持有 WP | 持有者 | 取得時間 | 預計釋放 |
|---|---|---|---|---|
| src/lib/auth.ts | FIX-01 | engineer-hard | 10-19 09:30 | FIX-01 合併 |

## Owner 待辦
| # | 事項 | 影響的 WP | 期限 | 狀態 |
|---|---|---|---|---|

## 今日摘要
- 已合併：
- 阻擋：
- 需要 owner 決策（最多 3 項）：
```

## 3. 內建 skill 與 reviewer 如何接進 PR 流程

### 3.1 事實

- 本 session 可用的內建 skill：`code-review`（等級 low／medium／high／xhigh／max，`ultra` 為雲端多代理審查；`--comment` 把 findings 貼成 PR inline 留言；`--fix` 把修正套用到工作樹；`--max-findings`）、`security-review`（審查當前分支待合併變更的安全問題）、`simplify`（審查變更程式碼的重用、簡化、效率並**直接套用修改**，不找 bug）。
- `reviewer` agent 的 `tools` 沒有 `Skill`，所以它無法自行呼叫上述 skill；是否能在子代理內呼叫需另行實測，不要預設可行。
- repo 沒有 PR template、沒有 CODEOWNERS，必要 review 數為 0（01 §1.2），所以「獨立審查」目前沒有任何可稽核的痕跡。

### 3.2 分級規則

| PR 類別 | 作者 | 必經 | 加跑 | 不要做 |
|---|---|---|---|---|
| **H 高風險**（付款、checkout、退款、佣金、auth／權限、租戶邊界、migration、`proxy.ts`、job／ops 端點） | `engineer-hard` | `reviewer`（對最終 head 一次，使用 §1 清單） | `security-review`（認證、租戶、付款、webhook、RLS 變更一律加跑）；diff 超過約 300 行或跨模組再加 `code-review high` | 不用 `simplify` 動付款／授權程式碼；不用 `--fix` 讓審查自行改程式 |
| **E 一般**（UI、非金流 API、文案、測試） | `engineer` | CI `quality` | 作者回合結束前可跑 `simplify`（限本 PR 變更的非風險檔案，之後重跑測試）；超過約 500 行再加 `code-review medium` | 不需 reviewer |
| **D 文件／設定** | `docs` 或主對話 | CI | 設定／權限變更主對話自查 | — |
| **RC 增量**（封測前一次，`review-baseline-2026Q4..master`） | — | `reviewer`（Opus，Critical 三軸各一次）＋`security-review` | `code-review ultra`（雲端、多代理）一次 | 不在封測期間反覆跑 ultra |

補充規則：

- **`--comment` 預設不用。** 在公開 repo 的 PR 貼 inline 留言等於以 owner 帳號發佈公開內容，依安全規則需明確許可；預設做法是主對話把 findings 整理進 PR 描述的「審查證據」區塊。owner 另行同意後才開 `--comment`。
- **`--fix` 只在作者自己的分支、獨立 worktree 使用**，且修改後必須重跑測試與 reviewer（因為 head 變了）。
- **head 變動就重審**：reviewer 的結論綁定它審查的 commit SHA，之後任何新 commit（包含 `--fix`、rebase 後的衝突解決）都要重跑受影響範圍。
- security-review 與 reviewer 的重疊結果由主對話去重，兩者衝突時以較嚴格者為準，並把分歧寫進 PR 描述。

### 3.3 PR template（新增）

```diff
diff --git a/.github/pull_request_template.md b/.github/pull_request_template.md
new file mode 100644
--- /dev/null
+++ b/.github/pull_request_template.md
@@ -0,0 +1,32 @@
+## 摘要
+<!-- 一到三句：改了什麼、為什麼。對應 finding ID（例如 B03-01）。 -->
+
+## 類別
+- [ ] H 高風險（付款／checkout／退款／佣金／auth／租戶／migration／proxy／job）
+- [ ] E 一般
+- [ ] D 文件／設定
+
+## 檔案範圍
+<!-- 派工單宣告的範圍；`git diff --name-only origin/master...HEAD` 若超出，說明原因 -->
+
+## 驗證
+- [ ] targeted tests：
+- [ ] `npm run typecheck`
+- [ ] `npm run lint`
+- [ ] DB 測試（僅 loopback `celebratedeal_*`）：
+- 沒跑的項目與原因：
+
+## 審查證據（H 類必填）
+- reviewer 報告路徑：`docs/review-2026Q4/fixes/…`　審查的 head SHA：
+- security-review：已跑／不適用　結果摘要：
+- code-review 等級：未跑／high／ultra　結果摘要：
+- 未解 findings：無／（列出）
+
+## 風險與回復
+- forward migration／回復方式：
+- 外部相依（owner 動作、Sandbox、排程）：
+
+## 檢查
+- [ ] 沒有 `.env*`、金鑰、客戶資料
+- [ ] 若搬移或封存 `docs/codex-goal/*`：已同步改 `AGENTS.md`、`engineer-hard.md`、`domain-workflows.md` 的路徑
+- [ ] squash 合併，不 force push
```

### 3.4 可選：風險路徑 label 閘門（需 owner 同意才能設為必要檢查）

目的：讓「H 類需審查」留下機器可查的痕跡。做法是命中風險路徑的 PR 需要 `reviewer-ok` label，label 在新 push 後自動移除，避免舊審查套用到新 head。這是**自我宣告**機制（有寫入權限的人都能貼 label），價值在於留下稽核軌跡與防止忘記，不是防惡意。

```diff
diff --git a/.github/workflows/risk-path-review-gate.yml b/.github/workflows/risk-path-review-gate.yml
new file mode 100644
--- /dev/null
+++ b/.github/workflows/risk-path-review-gate.yml
@@ -0,0 +1,41 @@
+name: risk-path-review-gate
+on:
+  pull_request:
+    types: [opened, synchronize, reopened, labeled, unlabeled]
+permissions:
+  contents: read
+  pull-requests: write
+jobs:
+  gate:
+    runs-on: ubuntu-latest
+    timeout-minutes: 5
+    concurrency:
+      group: risk-gate-${{ github.event.pull_request.number }}
+      cancel-in-progress: true
+    steps:
+      - name: Require reviewer-ok for risk paths
+        env:
+          GH_TOKEN: ${{ github.token }}
+          REPO: ${{ github.repository }}
+          PR: ${{ github.event.pull_request.number }}
+          ACTION: ${{ github.event.action }}
+        run: |
+          set -euo pipefail
+          files="$(gh api "repos/$REPO/pulls/$PR/files" --paginate --jq '.[].filename')"
+          risky="$(printf '%s\n' "$files" | grep -E '^(src/lib/(payment|billing|auth|csrf|rate-limit)|src/proxy\.ts|src/app/api/(payments|webhooks|jobs|admin)/|src/app/admin/|prisma/|vercel.*\.json|\.github/workflows/)' || true)"
+          labels="$(gh api "repos/$REPO/issues/$PR/labels" --jq '.[].name')"
+          if [ "$ACTION" = "synchronize" ] && printf '%s\n' "$labels" | grep -qx 'reviewer-ok'; then
+            gh api -X DELETE "repos/$REPO/issues/$PR/labels/reviewer-ok" >/dev/null
+            labels="$(printf '%s\n' "$labels" | grep -vx 'reviewer-ok' || true)"
+          fi
+          if [ -n "$risky" ] && ! printf '%s\n' "$labels" | grep -qx 'reviewer-ok'; then
+            echo "Risk-path files changed; run the reviewer on the current head and add the reviewer-ok label:"
+            printf '%s\n' "$risky"
+            exit 1
+          fi
```

限制：fork PR 的 token 為唯讀，移除 label 會失敗（本專案沒有 fork 貢獻者，B09-10 已建議收緊核准政策）；要成為合併必要條件，需 owner 在分支保護加入 `gate` check（目前只有 `quality`）。

## 4. 封測期間 bug triage 流程

### 4.1 前提與限制

- 封測是 2026-11-01，客戶為真實的人，環境為 staging（`Preview – celebrate-deal-staging`）與 PayUni Sandbox；不是 Production，不收真實款項（Goal Plan §9.2）。
- repo 與 Issues 皆 public。客戶姓名、Email、電話、截圖、訂單內容都**不得**進 Issue、PR、`docs/`、`reports/`。
- 目前沒有回報管道、沒有告警接收人（Goal Plan §9.2、B09 都列為待辦）。Sentry 沒有連到本 session；registry 內有 Sentry MCP 但未連線（`connected: false`）。Vercel MCP 對 staging 專案的 `list_deployments`、`get_runtime_errors` 回 403（scope 未授權），但本機 `vercel` CLI（已登入）可讀 deployment 列表，見 03 文件。

### 4.2 流程

```
客戶回報（LINE／Email／口頭，owner 收）
  → ① owner 以匿名代號登記（客戶A、客戶B），原始內容留在私人處（owner 的私人文件或聊天），不進 repo
  → ② 主對話每日 2 次（上午、傍晚）分類：建立去識別 Issue（模板見下）
  → ③ 依嚴重度派工（§4.3）
  → ④ 先寫會失敗的重現測試（或明確寫出無法自動化的原因），再修
  → ⑤ 走一般 PR 流程（類別 H／E 規則不變）
  → ⑥ 修復合併、staging 部署後，owner 向客戶回覆
```

### 4.3 嚴重度與回應目標

目標以「單人 owner＋AI 代理」的現實設定，是**努力目標**不是承諾。

| 等級 | 定義 | 動作 | 目標 |
|---|---|---|---|
| S0 | 疑似跨租戶資料外洩、金額錯誤入帳／出款、secret 外洩、客戶資料進 repo | **立即以單獨訊息通知 owner**（Goal Plan §8.4）；暫停封測受影響功能；派 `engineer-hard`＋`reviewer`；不貼進任何公開文件 | 當天止血 |
| S1 | 卡住首次成功路徑：無法登入、無法建立／發布直播、無法結帳、通知未送達、頁面白屏 | 當天派工；H 類風險路徑仍需 reviewer | 24 小時內 |
| S2 | 有替代做法的功能缺陷、資料顯示錯誤但不影響金額 | 排入次日批次 | 3 天內 |
| S3 | 文案、版面、體驗建議 | 每週一批（對應 B07 批次 C） | 每週 |

### 4.4 Issue 模板（去識別）

```diff
diff --git a/.github/ISSUE_TEMPLATE/beta-bug.yml b/.github/ISSUE_TEMPLATE/beta-bug.yml
new file mode 100644
--- /dev/null
+++ b/.github/ISSUE_TEMPLATE/beta-bug.yml
@@ -0,0 +1,43 @@
+name: 封測問題（去識別）
+description: 只填去識別資訊。禁止貼客戶姓名、Email、電話、截圖或訂單內容。
+labels: ["beta"]
+body:
+  - type: markdown
+    attributes:
+      value: |
+        這是公開 repo。請勿填入任何個資、金鑰、token 或客戶原始訊息。客戶以匿名代號（客戶A、客戶B）表示。
+  - type: input
+    id: reporter
+    attributes:
+      label: 回報者代號
+      placeholder: 客戶A
+    validations:
+      required: true
+  - type: dropdown
+    id: severity
+    attributes:
+      label: 嚴重度
+      options: ["S0 資金／資料／外洩", "S1 卡住首次成功路徑", "S2 有替代做法", "S3 文案／體驗"]
+    validations:
+      required: true
+  - type: input
+    id: role
+    attributes:
+      label: 角色與頁面路徑（不含 query 字串、不含 ID）
+      placeholder: 商家 owner／/lives/新增
+  - type: textarea
+    id: steps
+    attributes:
+      label: 重現步驟
+    validations:
+      required: true
+  - type: textarea
+    id: expected-actual
+    attributes:
+      label: 預期結果與實際結果
+    validations:
+      required: true
+  - type: input
+    id: when
+    attributes:
+      label: 發生時間（Asia/Taipei，精確到分鐘，供查 Sentry／日誌）
+  - type: input
+    id: related
+    attributes:
+      label: 對應 finding ID（若已知）
+      placeholder: B07-09
```

### 4.5 每日例行（封測期間）

| 時段 | 動作 | 工具 |
|---|---|---|
| 上午 | 讀 `STATE.md`；`gh issue list --label beta`；看 staging 部署與錯誤（目前用 `vercel logs` CLI；MCP 授權範圍修好後改用 `get_runtime_errors`）；Sentry 由 owner 或日後連線的 MCP 提供 | `gh`、`vercel` CLI |
| 上午 | 分類新回報、去重、指派；S0 立即通知 | 主對話 |
| 下午 | 修復回合與 reviewer 回合 | 子代理 |
| 傍晚 | 合併已通過者；更新 `STATE.md`；寫給 owner 的一則摘要（已修、阻擋、需決策最多三項） | 主對話 |

可選：用 `schedule`／`loop` 建立每日「staging 健康檢查」排程，但這是持久設定且會讓代理在無人看管時執行，需 owner 同意；排程內容只限唯讀（`gh issue list`、`vercel logs`、`/api/health`）。

## 5. 其他發現的缺口

| # | 缺口 | 證據 | 建議 | 需 owner |
|---|---|---|---|---|
| 1 | 沒有專案層 permission／hook，安全底線只靠 prompt | 無 `.claude/settings.json` | 01 §4.2 的 deny 清單 | 是 |
| 2 | 子代理不繼承 skill；4 個 agent 都沒有 `skills:` | agent frontmatter | 01 §2.3、§3.3；先實測 | 否 |
| 3 | 「獨立審查」無機制 | `required_approving_review_count: 0` | §3.3 PR template；§3.4 可選 label gate | 設為必要檢查需要 |
| 4 | 合併方式未限制 squash | `allow_merge_commit`／`allow_rebase_merge` 皆 true | 設定為只允許 squash，並開 `delete_branch_on_merge` | 是（repo 設定） |
| 5 | 派工單沒有統一格式，風險路徑沒有單一清單 | `CLAUDE.md` 只有分工表 | 05 文件 §1.2、§2 | 否 |
| 6 | 沒有 evidence receipt 慣例給修復階段 | A/B 階段每個 WP 有 receipt，修復階段無 | 沿用 `reports/review-2026Q4/<WP>-receipt.md`，修復 PR 的審查報告放 `docs/review-2026Q4/fixes/` | 否 |
| 7 | Next 16 慣例只靠「請先讀」 | engineer／engineer-hard prompt | 要求回報列出讀過的 docs 路徑（01 §2.4 diff） | 否 |
| 8 | 封存 `docs/codex-goal/*` 會讓三處寫死路徑失效 | `AGENTS.md`、`engineer-hard.md`、`domain-workflows.md` | PR template 檢查項；封存 PR 同步改 | 否 |
| 9 | worktree 建立／移除有 Windows junction 風險 | 記憶檔、B-10 事故 | 05 文件 §3.3 的固定步驟 | 否 |
| 10 | 無 Sentry／Cloudflare MCP 連線 | `session_connectors_status`；registry 皆 `connected: false` | 03 文件；由 owner 決定是否連線 | 是（OAuth 授權） |
