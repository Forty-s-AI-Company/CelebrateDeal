# 01 Agent 與 Skill 盤點（D-01）

- 基線：`review-baseline-2026Q4` = `origin/master@78621ca3`；工作分支 `codex/goal-review-2026q4`
- 日期：2026-10-19（Asia/Taipei）
- 方式：唯讀。只讀 repo 檔案、`gh pr view 428`、`gh api` 的設定讀取；沒有修改任何既有檔案、沒有 git 寫入、沒有讀 `.env*`。
- 本文件的 diff 片段是**建議**，沒有套用到任何檔案。套用需要走 `codex/*` 分支與 PR，其中涉及 `.claude/settings.json`、權限與 hook 的部分屬於「建立或修改持久設定」，需要 owner 明確同意。
- 範圍：PR #428（已合併，`68df16d4`）留下的 4 個 agent、6 個 skill、`CLAUDE.md`／`AGENTS.md` 與 `docs/domain-workflows.md` 的一致性。不重做 Codex 時代的盤點（該套件已封存在 tag `archive/codex-ai-team-vnext-20261017`）。

## 0. 結論先講

1. **#428 的瘦身方向正確**，沒有留下指向已刪除 routing 的引用（`grep -i "ai-team|route_task|codex" CLAUDE.md AGENTS.md .claude` 只命中三處：`AGENTS.md` 與 `engineer-hard.md` 內的 `docs/codex-goal/PRISMA_INVARIANTS.md` 路徑，以及 `AGENTS.md` 的 `codex/*` 分支前綴，皆為現行有效資訊）。
2. **最大問題不是內容過期，而是「六個 skill 幾乎是空殼」**：每個 SKILL.md 只有 318–379 bytes，一句中文指向 `docs/domain-workflows.md` 的一個小節。它們能被載入，但載入後沒有任何檢查清單；觸發描述沒有「何時使用」的語句與檔案路徑線索，Claude 自動載入的機率低，而且**子代理預設不繼承主對話的 skill**（見 §3.3，需實測），所以 `engineer-hard`、`reviewer` 實際上是靠自己的 prompt 去讀 `docs/domain-workflows.md`，skill 沒有發揮作用。
3. **reviewer 的「唯讀」目前只是 prompt 約定**。它的工具清單有 `Bash`，技術上可以用重新導向寫檔，也可以執行 `git commit`；本輪三個 Critical 審查（B-02、B-03、B-04）都因為它「角色限制」自己不寫檔，改由主對話代寫，每份 20–34 KB 的報告各多繞了一趟主對話 context。建議給 reviewer `Write`，並用 hook 把路徑限制在 `docs/review-*/` 與 `reports/`（§2.3）。
4. **`docs/domain-workflows.md` 在 master 上與 owner 2026-10-18 的決策矛盾**：master 版本仍寫「官方／AI／system 互動角色必須揭露，不能假扮真人觀眾」，更新版（允許不標示的虛擬觀眾帳號，但不得計入商家統計）目前只在工作目錄（`git status` 顯示 `M docs/domain-workflows.md`、`M PRODUCT.md`），尚未 commit。`celebratedeal-product-domain` 與 `celebratedeal-browser-qa` 都指向這份文件，所以現在派出去的代理讀到的是舊規則。
5. **`domain-workflows.md` 與 Phase B 的事實有 5 處落差**（§4.2）：文件寫的是「應然」，但沒有標示目前程式尚未達成，代理照文件驗收會誤判為已符合。

## 1. 事實核對

### 1.1 PR #428 實際內容（`gh pr view 428`）

- 刪除 `.ai-team/` 設定、MCP server、prompt、PowerShell 腳本，`.codex/`、4 個 `ai-team-*` skill、`docs/ai-team/` 下的 routing／workflow／handoff 文件（141 個檔案），以及 CI 的 6 個 `AI Team …` 步驟。
- 搬移：6 個 `celebratedeal-*` skill → `.claude/skills/`，`docs/ai-team/domain-workflows.md` → `docs/domain-workflows.md`。
- 新增：`.claude/agents/` 4 個 agent、`CLAUDE.md` 分工表、縮短後的 `AGENTS.md`。
- 殘留（非 #428 缺陷，但影響代理的搜尋雜訊）：
  - 本機 `.ai-team/` 資料夾仍在（只有 `__pycache__`、`state/` 等；`git ls-files .ai-team` 為 0，`.gitignore:97` 忽略 `.ai-team/state/`）。`state` 從來就不在版本控制內，所以舊的 goal-state 不會跨 worktree 保存（見 02 文件 §2）。
  - `docs/ai-team/` 仍有 1,379 個已追蹤檔案（歷史證據，B-10 已列入封存提案）。
  - 沒有 `.claude/settings.json`：專案層沒有任何權限規則或 hook，安全底線完全靠 prompt。

### 1.2 GitHub 側設定（`gh api` 唯讀，2026-10-19）

| 項目 | 觀察值 | 與 `AGENTS.md` 的關係 |
|---|---|---|
| `master` 保護 | required check：`quality`；`strict: true`；`enforce_admins: true`；禁止 force push | 符合「需 `quality` CI 通過」「禁止 force push」 |
| 必要 review 數 | `required_approving_review_count: 0` | **「付款…變更合併前需要一次獨立審查」沒有任何機制強制**，純靠流程自律 |
| 合併方式 | squash、merge commit、rebase 三種都允許 | `AGENTS.md` 寫「以 squash 合併」，設定沒有限制 |
| Auto merge | `allow_auto_merge: false` | Claude Code 的 `set_auto_merge` 在這個 repo 目前無法生效 |
| 合併後刪分支 | `delete_branch_on_merge: false` | 解釋了 B-10 的分支堆積 |
| Repo 可見性 | public | 所有 `docs/` 內容都是公開的，封測客戶資料不得進 repo（見 02 §4） |
| `.github/` | 只有 `workflows/`（25 個），沒有 PR template、沒有 CODEOWNERS | — |
| Environments | `Preview – celebrate-deal`、`Preview – celebrate-deal-staging`、`Production` | B09-14 已列：是否限制只有 master 可部署，需 owner |
| `gh` token scope | `repo`、`read:org`、`gist`、`admin:public_key`（無 `project`、無 `workflow`） | GitHub Projects v2 目前不可用（需 owner 執行 `gh auth refresh -s project`） |

## 2. Agent 逐一評估

### 2.1 總表

| Agent | 模型／effort | 工具 | 評價 | 主要缺口 |
|---|---|---|---|---|
| `engineer-hard` | Opus／high | 全部 | 合理 | 沒有「風險路徑」清單、沒有禁止丟棄變更的指令、沒有疑似 secret 外洩的停止條件、Next docs 只是「請讀」沒有留證據 |
| `engineer` | Sonnet／medium | 全部 | 合理 | ownership 規則比 AGENTS.md 弱；沒有「不碰 Production」；升級條件（付款、權限、migration）沒有具體路徑清單 |
| `reviewer` | Opus／high | Read、Grep、Glob、Bash | 模型合理；**權限與輸出契約需調整** | 無 Write；沒有 `.env`／Production／loopback DB 規則；沒有 Next 慣例與測試品質檢查；findings 格式與實際報告欄位不一致；沒有輸出語言規範 |
| `docs` | Haiku／low | Read、Grep、Glob、Edit、Write | 合理（限存檔與整理） | 可寫任何路徑；沒有 Bash，無法自己取得 `git diff --stat`，PR 描述素材要由主對話提供 |

### 2.2 安全底線與規則覆蓋矩陣

「是」＝ prompt 內有明文；「部分」＝有精神但不完整；「無」＝沒有。

| 規則（來源） | engineer-hard | engineer | reviewer | docs |
|---|---|---|---|---|
| 不讀 `.env*`（AGENTS 安全底線） | 是 | 是 | **無** | 部分（只說不複製 secret） |
| 不碰 Production 主機／DB／付款／寄信 | 是 | **無** | **無** | 無 |
| 不用 reset／clean／stash／restore／checkout 丟棄變更 | **無** | **無** | 部分（不修改檔案） | 無 |
| 每個輸入 ID 在最後 DB 操作綁 vendor ownership | 是 | 部分（「scoped to the current vendor」） | 是 | 不適用 |
| 金額只來自伺服器紀錄 | 是 | **無** | 是 | 不適用 |
| Migration 只能往前＋登記 `PRISMA_INVARIANTS.md` | 是 | 部分（遇到就停下） | 是（檢查） | 不適用 |
| 修改 Next.js 前讀 `node_modules/next/dist/docs/` | 是（要求但無證據） | 是（同上） | **無**（B-05 這類審查需要） | 不適用 |
| DB 測試只連 loopback `celebratedeal_*` | 是 | 無 | **無**（允許跑測試但沒限制連線目標） | 不適用 |
| 疑似 secret 外洩／正式資料進 repo 時停止並單獨通知（Goal Plan §8.4） | 無 | 無 | 無 | 無 |
| 虛擬使用者不計入商家統計（domain-workflows，2026-10-18） | 無 | 無 | **無** | 不適用 |
| 第二租戶負向測試是否存在 | 無 | 無 | **無** | 不適用 |
| 報告以繁體中文（台灣用語）撰寫 | 無 | 無 | **無**（但報告會被存成文件） | 是 |

說明：`CLAUDE.md` 透過 `@AGENTS.md` 匯入，子代理通常會帶入專案記憶，所以上表缺的規則並非完全沒有生效；但 prompt 是代理最先、最明確看到的契約，**把「會造成不可逆後果」的規則（Production、`.env`、丟棄變更）重複寫進每個 agent 是便宜的保險**。

### 2.3 reviewer 工具權限：三個選項與建議

**事實**

- 現況 `tools: Read, Grep, Glob, Bash`。B-02 收據寫明「依審查者角色限制，這份 receipt 和 `12-tenant-auth.md` 沒有由 reviewer 寫入，由主對話存檔」；B-03、B-04 同。
- Bash 可以寫檔（`cat > file`、`tee`），也可以 `git commit`、`git reset`。所以「never edits code」現在是 prompt 約定，不是權限邊界。reviewer 這輪守規矩，不代表邊界存在。
- 成本：`12`、`13`、`14` 三份合計約 77 KB（繁中，估約 3–4 萬 token）。reviewer 回報原文先進主對話，主對話再原文寫出一次，同一份內容佔用兩次主對話 context（估計值，未量測）。Phase D 之後的修復審查會有數十次，每次都重複這個成本。

| 選項 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| A 維持現狀 | reviewer 只回報文字，主對話代寫 | 無需改設定；最保守 | 主對話 context 重複佔用；主對話可能在轉寫時改動措辭；大報告容易被截斷 |
| B 改由 docs agent 存檔 | reviewer 回報 → 主對話 → docs agent（Haiku）寫檔 | 主對話不必逐字輸出 | 內容仍進出主對話兩次（輸入給 docs agent）；Haiku 轉寫有失真風險；多一個 agent 回合 |
| **C（建議）給 reviewer `Write`，用 hook 限制路徑** | `tools` 加 `Write`，frontmatter 掛 PreToolUse hook：`Write` 只允許新檔且路徑為 `docs/review-*/**` 或 `reports/**`；`Bash` 擋 git 寫入與破壞性指令 | 報告由審查者原樣落地；主對話只收摘要；同時把「唯讀」從約定升級為可檢驗的邊界 | 需要在本機實測 hook 在子代理 frontmatter 是否生效（見下方「需驗證」）；hook 是 best-effort，Bash 側無法完整防堵 |

**建議採 C**，並加兩道不依賴 hook 的補強：

1. 主對話在每次 reviewer 回合結束後執行 `git status --porcelain`，只允許出現 `docs/review-*/`、`reports/` 下的新檔；其他任何變更視為違規並退回。
2. reviewer 檔案一律新增、不覆寫（hook 內拒絕覆寫既有檔），重審用新檔名（例如 `-v2`）。

**需驗證**（我在本任務無法實測，因為只能唯讀）：Claude Code 子代理 frontmatter 的 `hooks` 欄位與 `skills` 欄位在目前版本是否生效。套用前先用一個拋棄式 agent 驗證「違規路徑被擋下」。若 hook 不生效，退回選項 A＋上面的第 1 道補強，不要裸給 `Write`。

建議 diff（`.claude/agents/reviewer.md`）：

```diff
 ---
 name: reviewer
-description: Independently reviews a CelebrateDeal diff for correctness, security, tenant isolation and money handling. Required once before merging payment, checkout, refund, commission, auth/permission or migration changes. Reports findings only; never edits code.
+description: Independently reviews a CelebrateDeal diff or code area for correctness, security, tenant isolation, money handling, data/migration safety and Next.js 16 conventions. Required once before merging payment, checkout, refund, commission, auth/permission or migration changes. Writes its findings report to docs/review-*/ or reports/ only; never edits product code.
 model: opus
 effort: high
-tools: Read, Grep, Glob, Bash
+tools: Read, Grep, Glob, Bash, Write
+skills:
+  - celebratedeal-review-checklists
+  - celebratedeal-multi-tenant-security
+  - celebratedeal-attribution-commission
+hooks:
+  PreToolUse:
+    - matcher: "Write|Bash"
+      hooks:
+        - type: command
+          command: "node .claude/hooks/reviewer-guard.mjs"
 ---

 You review a diff you did not write. The main session gives you the branch or commit range and what the change is meant to do.

+Safety floor (same as AGENTS.md): never read `.env*`, tokens, cookies or private keys; never touch Production hosts, databases, payments or email; run DB tests only against a loopback `celebratedeal_*` database, otherwise do not run them and say so. If you see what looks like a real secret or real customer data in the repo, stop and tell the main session in a separate message first; do not copy it into the report.
+
 Check, in this order:
 1. Money: amounts come from server records; idempotency on provider events; refunds and commissions reconcile; there is no path to a zero or negative charge.
 2. Tenant boundaries: every input ID is bound to the actor's vendor in the final DB call; denials do not leak existence.
 3. Auth and permissions: the capability check matches the action; MFA and admin paths stay protected.
 4. Data: migrations are forward-only and safe on existing rows; constraints match the code's assumptions.
 5. Correctness: edge cases, concurrency, error handling, and whether the tests actually exercise the change.
+6. Tests: a negative test for the second tenant exists for every new sensitive read/mutation; assertions are not weakened; tests use real provider field names, not invented ones.
+7. Next.js: for changed Next.js code, read the matching guide in `node_modules/next/dist/docs/` and list the paths you read in the report.
+8. Product rules: scripted/virtual viewers never count toward vendor-side registrations, orders, payments, analytics or conversion (docs/domain-workflows.md).

-You may run read-only commands and tests. Do not modify files, commit or push.
+You may run read-only commands and loopback tests. You may create new report files under `docs/review-*/` or `reports/` with Write; never overwrite an existing file and never write anywhere else. Do not modify product code, commit, push, install packages, or use reset/clean/stash/restore/checkout to discard changes.

-Report each finding as `BLOCKER`, `MAJOR`, `MINOR` or `NIT`, with file:line, the concrete failure scenario, and a suggested fix. Say plainly if you found nothing at a given level.
+Write the report in Traditional Chinese (Taiwan usage); keep identifiers and paths as they are. Use one table row per finding with columns: ID, 嚴重度 (`BLOCKER`/`MAJOR`/`MINOR`/`NIT`), 檔案:行號, 問題, 為何重要（情境）, 重現／測試, 建議修法, 估工, 需 owner 決策, 封測前必修. Say plainly if you found nothing at a given level, and list what you did not cover. Finish by returning only the report path, the count per severity, and anything the main session must decide.
```

新增 `.claude/hooks/reviewer-guard.mjs`（Node，跨平台；hook 以 stdin 收 JSON，exit code 2 代表阻擋）：

```diff
diff --git a/.claude/hooks/reviewer-guard.mjs b/.claude/hooks/reviewer-guard.mjs
new file mode 100644
--- /dev/null
+++ b/.claude/hooks/reviewer-guard.mjs
@@ -0,0 +1,44 @@
+// Best-effort guard for the reviewer agent. Exit code 2 blocks the tool call.
+import { existsSync, readFileSync } from "node:fs";
+import path from "node:path";
+
+const input = JSON.parse(readFileSync(0, "utf8"));
+const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd());
+const deny = (message) => {
+  console.error(`reviewer-guard: ${message}`);
+  process.exit(2);
+};
+
+if (input.tool_name === "Write") {
+  const target = path.resolve(root, String(input.tool_input?.file_path ?? ""));
+  const rel = path.relative(root, target).split(path.sep).join("/");
+  const allowed = /^docs\/review-[^/]+\//.test(rel) || /^reports\//.test(rel);
+  if (rel.startsWith("..") || !allowed) {
+    deny(`Write is limited to docs/review-*/ and reports/ (got ${rel}).`);
+  }
+  if (existsSync(target)) {
+    deny(`Refusing to overwrite ${rel}; write a new file name instead.`);
+  }
+}
+
+if (input.tool_name === "Bash") {
+  const command = String(input.tool_input?.command ?? "");
+  const blocked = [
+    /\bgit\s+(add|commit|push|reset|clean|stash|restore|checkout|switch|merge|rebase|cherry-pick|tag|apply|am)\b/,
+    /\bgit\s+branch\s+-[dDmM]/,
+    /\b(rm|mv|cp|del|rmdir)\s/,
+    /\bsed\s+-i\b/,
+    /\b(npm|pnpm|yarn)\s+(i|install|ci|add|remove|update)\b/,
+    /\b(curl|wget|Invoke-WebRequest|iwr)\b/,
+    /\.env(\.|\b)/,
+    /\bvercel\s+(env\s+(pull|add|rm)|deploy|--prod|rm|promote|rollback)\b/,
+  ];
+  const hit = blocked.find((pattern) => pattern.test(command));
+  if (hit) deny(`Command blocked for reviewer (${hit}). Reviewer is read-only apart from report files.`);
+}
+
+process.exit(0);
```

說明：這支 guard 擋的是「明顯的」寫入與破壞性指令，擋不住 `node -e` 之類的繞法。真正的保證來自 §2.3 的補強第 1 項（事後 `git status` 檢查）。

### 2.4 模型與 effort

| Agent | 判斷 | 建議 |
|---|---|---|
| `engineer-hard`（Opus／high） | 對付款、權限、migration 合理。B-phase 的三個 BLOCKER（B02-01、B03-01、B03-02）估工都在 0.5–1.5 天，一個 high 回合足夠 | 維持。`CLAUDE.md` 已授權主對話逐次決定 effort：對**需要同時推理多個狀態機的修復**（B03-03 跨月退款、B03-07 庫存保留逾期、B06-06 stream 月帳本）建議逐次提高到 xhigh，而不是改預設值 |
| `engineer`（Sonnet／medium） | 對 B05、B07 這類 UI／慣例修正合理 | 維持。但要把「何時必須停下改派 `engineer-hard`」從抽象句子變成路徑清單（見下方 diff 與 05 文件 §1.2） |
| `reviewer`（Opus／high） | Critical 軸線合理 | 維持預設。非 Critical 的審查（純 UI、文件、測試）主對話可用呼叫參數降為 Sonnet，這在 B 階段已採用；請在 `CLAUDE.md` 明寫，避免日後誤以為 reviewer 一律要 Opus |
| `docs`（Haiku／low） | 適合存檔、整理格式、PR 描述 | 維持。**需要判斷的整合性文件**（findings 合併、ROADMAP、DECISIONS）不要交給它，交 Sonnet |

建議 diff（`.claude/agents/engineer.md`，補齊 ownership、Production 與升級路徑）：

```diff
 - Reuse existing components in `src/components/ui.tsx` and tokens in `src/app/globals.css`. UI text is natural Traditional Chinese.
-- Every query or mutation stays scoped to the current vendor. If the change turns out to involve payments, permissions or migrations, stop and say so.
+- Bind every input ID to the current vendor in the final DB call (compound `where`, not a global lookup followed by an in-memory check). Money amounts come from server records, never from the client. Denials must not reveal whether another tenant's record exists.
+- Stop and tell the main session before editing anything under: `src/lib/payment*`, `src/lib/billing*`, `src/lib/auth.ts`, `src/lib/csrf.ts`, `src/lib/rate-limit.ts`, `src/proxy.ts`, `src/app/api/payments/**`, `src/app/api/webhooks/**`, `src/app/api/jobs/**`, `src/app/api/admin/**`, `src/app/admin/**`, `prisma/**`, `vercel*.json`, `.github/workflows/**`, or any refund / commission / settlement / payout code. Those go to `engineer-hard`.
 - Run the targeted tests, `npm run typecheck`, and `npm run lint` for what you changed.
-- Never read `.env*` files. Commit on the branch you were given. Do not push.
+- Never read `.env*` files. Never touch production hosts, databases, payments or email. Do not use reset/clean/stash/restore/checkout to discard changes you did not make. If you find what looks like a real secret or real customer data, stop and say so first.
+- Commit on the branch you were given, staging explicit paths only (`git add <paths>`). Do not push.
+- For Next.js changes, list the `node_modules/next/dist/docs/` files you read in your report. If `node_modules` is missing, stop and tell the main session (do not run `npm ci` yourself).

-Report: what changed, tests run with results, and anything left unverified.
+Report in Traditional Chinese: what changed (files), the Next docs you read, tests run with results, and anything left unverified.
```

`engineer-hard.md` 同理加入：丟棄變更禁令、疑似 secret 停止條件、Next docs 路徑回報、`git add <paths>`。

## 3. Skill 評估

### 3.1 逐一檢查

| Skill | 大小 | description | 內容 | 錨點連結 | 評價 |
|---|---|---|---|---|---|
| `celebratedeal-attribution-commission` | 358 B | 「referral、付款歸因、佣金、退款 adjustment、settlement 與 payout 對帳」 | 一句話＋連到 `#歸因與佣金` | 有效 | 觸發詞對，但缺「何時使用」與檔案線索；無清單 |
| `celebratedeal-browser-qa` | 373 B | 「實際交付介面的合成資料 Playwright、登入／權限／購買與 responsive 驗證」 | 一句話＋連到 `#瀏覽器-qa` | 有效 | 同上 |
| `celebratedeal-design-system` | 379 B | 「共用 UI／token、互動狀態、繁中與 responsive／a11y 設計驗證」 | 一句話＋連到 `#設計與互動` | 有效 | 沒有帶入 B07-18／22 已知缺口（`Field`／`TextArea` 無 error 語意、78 處 `outline-none`） |
| `celebratedeal-multi-tenant-security` | 372 B | 「tenant ownership、RBAC、Server Action／API、RLS 與跨租戶回歸」 | 一句話＋連到 `#租戶與權限` | 有效 | 文件寫「RLS 是額外防線」，但 B02／B04 證實 148 張表中 77 張未開 RLS、DB 層沒有租戶隔離 |
| `celebratedeal-product-domain` | 356 B | 「跨角色或模組的產品流程、狀態轉換與驗收契約」 | 一句話＋連到 `#產品與角色` | 有效 | 指向的小節在 master 上仍是舊的虛擬使用者規則 |
| `celebratedeal-release-gate` | 318 B | 「驗收證據、必要 review、精確 head CI 與受保護 PR 交付檢查」 | 一句話＋連到 `#驗收與交付` | 有效 | 沒提 `quality` check 名稱、squash、reviewer 呼叫方式，也沒接 `code-review`／`security-review` |

連結檢查：6 個 skill 的相對路徑（`../../../docs/domain-workflows.md`）皆可解析；`domain-workflows.md` 內連到的 `codex-goal/API_CONTRACT_REGISTRY.md`、`codex-goal/PRISMA_INVARIANTS.md`、`remaining-capabilities-work-matrix-20261005.md`、`../playwright.config.ts`、`../.github/workflows/ci.yml`、`ui.tsx`、`globals.css` 目前都存在。

**過期風險不在現在，而在即將到來的封存**：B10-12 建議整理 `docs/codex-goal/`，B10-10／11 建議把大量 `docs/` 檔案搬到 `reports/archive/2026/`，並已指出有 43 個檔案被測試或 CI 以固定路徑讀取。`AGENTS.md`、`engineer-hard.md`、`domain-workflows.md` 都寫死 `docs/codex-goal/PRISMA_INVARIANTS.md`。**任何封存 PR 必須同時改這三處**，否則代理會被指向不存在的檔案。建議在 05 文件的 PR 檢查表加一條。

### 3.2 觸發描述是否足以自動載入

現在的 description 是名詞片語，沒有「Use when …」語句，也沒有檔案路徑或動作線索。Claude 判斷是否載入 skill 主要看 description 與當前任務的語意相似度；使用者與代理用中文描述時尚能命中，但當任務只是「修 `src/lib/payment-webhooks.ts` 的 bug」，沒有任何字面線索連到「歸因與佣金」。建議每個 description 改成「何時用＋關鍵檔案路徑＋中英關鍵字」。

### 3.3 子代理不會自動帶 skill（需實測）

依 Claude Code 的子代理設計，子代理是獨立 context，**不會繼承主對話已載入的 skill**；要預載須在 agent frontmatter 用 `skills:` 列出（本文件 §2.3 的 diff 已這樣寫）。目前 4 個 agent 都沒有 `skills:`，所以：

- `engineer-hard` 做 tenant／payment 修復時，不會自動拿到 multi-tenant 或 attribution skill；它靠 prompt 裡「讀 `docs/domain-workflows.md` 的對應小節」。
- 這在 skill 只是指標時影響不大；**一旦 skill 內含檢查清單（§3.5），預載就有實質價值**。

這點同樣標為「需驗證」：套用前用拋棄式 agent 確認 `skills:` 欄位會把 SKILL.md 內容注入子代理 context。

### 3.4 與 `domain-workflows.md` 的重複／矛盾

結構上**沒有重複**（skill 只是指標，內容單一來源，這是優點）。矛盾與落差如下。

| # | 位置 | 問題 | 嚴重度 | 建議 |
|---|---|---|---|---|
| 1 | 「產品與角色」第二段（master 版） | 與 owner 2026-10-18 決策矛盾：master 仍要求「官方／AI／system 互動角色必須揭露，不能假扮真人觀眾」。工作目錄的未提交修改已更新為「腳本化虛擬使用者只存在於觀眾端聊天室，不得計入商家後台任何統計」 | 高：代理會依舊規則審查或「修正」B07-04 相關程式 | 把已更新的 `domain-workflows.md`（及 `PRODUCT.md`）以獨立文件 PR 合併；在合併前，派工模板要附上更新後的規則 |
| 2 | 「租戶與權限」表格 | 「Staff／Affiliate」角色列沒有「僅 portal 的夥伴」身分。B02-02：夥伴與商家成員共用 `VendorMember` 角色，需要 owner 決定是否新增最小權限身分 | 中 | owner 決策後補一列；決策前在 skill 的「已知缺口」註記 |
| 3 | 「租戶與權限」末段 | 「RLS 是額外防線，不取代 server guard」——事實上目前 DB 層**沒有**租戶隔離，77／148 張表未啟用 RLS（B02-03、B04-08） | 中：代理可能以為 RLS 已兜底而放鬆 server 端檢查 | 補一句「現況：多數表未啟用 RLS，server guard 是唯一防線」 |
| 4 | 「歸因與佣金」表 Provider paid 列 | 前提只寫「簽章有效、已知 pending order、幣別及金額相符」，沒有「provider 回報成功狀態」。B03-01：PayUni 回呼不檢查 `TradeStatus`，失敗刷卡也被當成已付款 | 高：照文件驗收會判定「符合」 | 前提加入「provider 狀態為成功（例如 PayUni `TradeStatus=1`），失敗／待處理狀態不得入帳」 |
| 5 | 「歸因與佣金」對帳公式 | `settlement payable = collected - refunds - fees - commissions + adjustments`。B03-02／03／04／08：平台自收款被算成商家營收、跨月退款扣不到、費用與淨額寫成 0、佣金被扣下卻沒有出款路徑 | 高 | 在公式下加「現況偏差：見 `docs/review-2026Q4/13-payments-finance.md`，修復前不得宣稱對帳一致」 |
| 6 | 「瀏覽器 QA」 | 要求 Chromium＋四個 viewport；未說明 staging 登入由誰執行。依代理安全規則，在非本機開發主機輸入密碼不可行，現有 Playwright runner 依賴 workflow secret | 低 | 補一句「staging 登入驗證只用既有受控 runner；代理不在瀏覽器輸入憑證」 |
| 7 | 「驗收與交付」 | 寫「需要一次獨立審查」，但 GitHub `required_approving_review_count` = 0，無機制強制 | 中 | 見 02 文件 §3 的 PR template 與可選的 label gate |

### 3.5 建議的 skill 結構

原則：**指標保留（單一來源），在 SKILL.md 內只加三樣東西**：(1) 何時使用與檔案線索；(2) 不可妥協的 5–8 條檢查（這是子代理預載後真正會用到的部分）；(3) 已知缺口與對應 finding ID。每個 skill 控制在 40 行以內，避免預載浪費 context。

`celebratedeal-multi-tenant-security`：

```diff
 ---
 name: celebratedeal-multi-tenant-security
-description: CelebrateDeal tenant ownership、RBAC、Server Action／API、RLS 與跨租戶回歸。
+description: 修改或審查 CelebrateDeal 的租戶權限時使用：Server Action、API route、`src/lib/auth.ts`、`merchant-api-security.ts`、`student-portal-auth.ts`、vendor／member／capability、跨租戶 ID、RLS／GRANT、MFA、admin 與 platform 權限。Use when touching tenant ownership, RBAC, vendorId scoping, platform admin, or writing cross-tenant tests.
 ---

 讀取 [租戶與權限](../../../docs/domain-workflows.md#租戶與權限)，把 authenticated actor、capability、輸入 ID 與 related ownership 追到最後 DB 操作，驗證第二租戶與平台／商家界線。
+
+不可妥協：
+1. 每個輸入 ID（含 relation connect）在最後一個 DB 呼叫以 `vendorId` 複合條件綁定，禁止先全域查詢再於記憶體過濾。
+2. 拒絕時回統一的 404／not_found，不洩漏其他租戶資料是否存在。
+3. 平台層動作（退款、結算、出款、銀行帳號匯出）只認 platform role＋已驗證 MFA，不認商家 finance。
+4. UI 隱藏不算權限；每個新增敏感 read／mutation／export 必須有第二租戶負向測試。
+5. 新表／新欄位：評估 tenant key、FK、unique、index，並啟用 RLS 且撤銷 `anon`／`authenticated` 權限。
+
+現況缺口（修復前不得假設已安全）：多數表未啟用 RLS，DB 層沒有租戶隔離（B02-03、B04-08）；夥伴與商家成員共用 `VendorMember`（B02-02）；`requireFinanceAdmin` 在 #436 合併前不檢查 MFA 因子（B02-01）。詳見 `docs/review-2026Q4/12-tenant-auth.md`。
```

`celebratedeal-attribution-commission`：

```diff
-description: CelebrateDeal referral、付款歸因、佣金、退款 adjustment、settlement 與 payout 對帳。
+description: 修改或審查 CelebrateDeal 金流與佣金時使用：`src/lib/payment-providers/`、`payment-webhooks.ts`、`billing*.ts`、`api/payments/checkout`、`api/webhooks/payments`、退款、PayUni 回呼、referral／affiliate 歸因、commission ledger、settlement、payout、庫存保留。Use for payment webhooks, refunds, commissions, settlement and payout reconciliation.
 ---

 讀取 [歸因與佣金](../../../docs/domain-workflows.md#歸因與佣金)，固定 server-owned checkout 快照、provider event、ledger 與冪等鍵，驗證退款、併發及跨租戶。
+
+不可妥協：
+1. 金額、幣別、affiliate、rate 只來自伺服器紀錄；client 傳值不得覆寫。
+2. Webhook 先驗簽，再檢查 provider 狀態為成功，才可入帳；未知訂單、失敗或待處理狀態不得產生付款或佣金。
+3. 每個 provider 事件有唯一冪等鍵（provider＋event ID）；重送、亂序、併發都要有測試。
+4. 退款、拒付只追加 adjustment，結算鎖定後不改舊 ledger。
+5. 測試 fixture 使用 provider 真實欄位名稱，不自創欄位（B08-02）。
+
+現況缺口：PayUni 回呼不檢查 `TradeStatus`（B03-01）；平台自收款被算入商家營收（B03-02）；跨月退款扣不到（B03-03）；費用與淨額被寫成 0（B03-04）；沒有任何排程驅動 webhook 重試與庫存釋放（B03-06、B03-07）。詳見 `docs/review-2026Q4/13-payments-finance.md`。
```

`celebratedeal-release-gate`（接上審查與內建 skill）：

```diff
-description: CelebrateDeal 驗收證據、必要 review、精確 head CI 與受保護 PR 交付檢查。
+description: 準備合併或回報完成前使用：核對 scope、必要 gate、reviewer 審查、`quality` CI 是否綁在精確 head SHA、PR 描述的審查證據區塊。Use before opening a PR for merge, before declaring a work package done, or when asked whether something is ready to merge.
 ---

 讀取 [驗收與交付](../../../docs/domain-workflows.md#驗收與交付)，核對本次 scope、必要 gate、未解 findings、外部相依與 revision/head 證據。
+
+交付前依序確認：
+1. `git diff --name-only origin/master...HEAD` 與派工單宣告的檔案範圍一致。
+2. 屬於風險路徑（付款、checkout、退款、佣金、auth／權限、租戶邊界、migration）：已由 `reviewer` 對**最終 head** 審查一次，報告路徑寫進 PR 描述。
+3. 涉及 auth／租戶／付款／webhook／RLS：另跑內建 `security-review`；超過約 300 行或跨模組：另跑 `code-review high`。
+4. `quality` check 在最終 head 為 SUCCESS（merge 後 head 會變，需重看）。
+5. squash 合併；不 force push；不直推 `master`。
```

`celebratedeal-product-domain`、`celebratedeal-browser-qa`、`celebratedeal-design-system` 同樣把 description 改成「何時使用＋關鍵檔案＋Use when」，其清單內容待 D-03 的草稿與 domain-workflows 修訂後再補，避免現在寫入尚未定案的規則。

## 4. 治理文件一致性

### 4.1 `CLAUDE.md`／`AGENTS.md` 對照 Goal Plan

| 項目 | 一致？ | 說明 |
|---|---|---|
| Fable 主對話不寫程式，交給 engineer-hard／engineer | 一致 | 與 Goal Plan §8.1、記憶檔相符 |
| 子代理模型由主對話決定 | 一致 | Goal Plan §8.5 的 Opus 配額限制適用於「審查階段」，修復階段以 `CLAUDE.md` 分工表為準；建議在 05 文件寫明 |
| 最多 4 個並行子代理 | 部分 | 規定只在 Goal Plan §8.5，`CLAUDE.md` 沒有；建議在 05 文件採用「同時寫入者最多 3 個、加 1 個 reviewer」 |
| 疑似 secret 外洩時單獨通知 owner | 缺 | 只在 Goal Plan §8.4，AGENTS／agent prompt 都沒有 |
| 每檔單一 writer | 一致 | `CLAUDE.md` 有；沒有鎖定機制，見 05 文件 §3 |
| 「以 squash 合併」 | 設定與文字不符 | repo 允許三種合併方式（§1.2） |
| 獨立審查 | 流程有、機制無 | `required_approving_review_count` = 0 |
| Goal 狀態追蹤 | 缺 | `.ai-team/state` 已刪；見 02 文件 §2 |

### 4.2 建議新增 `.claude/settings.json`（把安全底線變成機制）

目前沒有任何專案層 permission。以下是**最小**的 deny 清單，目的是把 AGENTS.md 已寫的規則做成機器檢查，不是新增規則：

```diff
diff --git a/.claude/settings.json b/.claude/settings.json
new file mode 100644
--- /dev/null
+++ b/.claude/settings.json
@@ -0,0 +1,26 @@
+{
+  "permissions": {
+    "deny": [
+      "Read(./.env)",
+      "Read(./.env.*)",
+      "Read(./**/.env)",
+      "Read(./**/.env.*)",
+      "Bash(git push --force*)",
+      "Bash(git push -f*)",
+      "Bash(git push origin master*)",
+      "Bash(git reset --hard*)",
+      "Bash(git clean*)",
+      "Bash(git stash*)",
+      "Bash(git restore*)",
+      "Bash(vercel env pull*)",
+      "Bash(vercel --prod*)",
+      "Bash(vercel deploy --prod*)",
+      "Bash(vercel promote*)",
+      "Bash(vercel rollback*)"
+    ],
+    "ask": [
+      "Bash(git checkout*)",
+      "Bash(gh pr merge*)",
+      "Bash(gh workflow run*)",
+      "Bash(gh api -X*)"
+    ]
+  }
+}
```

限制：`Read(...)` deny 只管 Claude 的檔案讀取工具，擋不住 `cat .env` 這類 Bash 指令；`vercel env pull` 被列入 deny 是因為它會把環境變數寫成本機檔案（正是 `.env*`）。這份設定會同時影響主對話與所有子代理，**屬於持久設定，套用前需 owner 同意**。

## 5. 優先順序

| 順序 | 動作 | 估工 | 誰做 | 需 owner |
|---|---|---|---|---|
| 1 | 把更新後的 `domain-workflows.md`＋`PRODUCT.md` 開文件 PR（修正虛擬使用者規則） | 0.1 天 | 主對話（文件） | 否（owner 已於 10-18 決策） |
| 2 | `domain-workflows.md` 補 §3.4 的第 3、4、5、7 項「現況缺口」註記 | 0.2 天 | `docs` 或 Sonnet | 否 |
| 3 | 實測 agent frontmatter 的 `hooks` 與 `skills` 欄位 | 0.2 天 | `engineer`（拋棄式 agent 驗證，不改產品程式碼） | 否 |
| 4 | reviewer 改版（§2.3）＋`reviewer-guard.mjs` | 0.3 天 | `engineer` | 是（持久設定） |
| 5 | 三個 engineer／engineer-hard／reviewer prompt 補安全底線（§2.4） | 0.2 天 | 主對話（設定） | 是（持久設定） |
| 6 | skill 改寫（§3.5）＋新增 `celebratedeal-review-checklists`（見 02 文件） | 0.5 天 | `engineer`＋主對話審 | 否 |
| 7 | `.claude/settings.json` deny 清單 | 0.1 天 | 主對話 | 是 |

這七項合計約 1.6 天，可與 B 階段修復並行；第 1–2 項建議在派出第一批修復工作**之前**完成，因為派工模板會引用 domain-workflows。
