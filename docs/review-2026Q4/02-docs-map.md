# A-02　文件地圖與權威核對（2026 Q4 Review）

- 產出日期：2026-10-19（Asia/Taipei）
- 性質：唯讀盤點。本文件不修改任何既有檔案；所有「建議」都是提案，需 owner 或主對話核准後另開 PR 執行。
- 盤點基準：`origin/master` @ `78621ca3`（#444，2026-10-19）。目前工作分支 `codex/claude-handoff-20261017` 落後 master 15 個 commit，因此檔案數量與內容一律以 `git ls-tree origin/master` 為準；工作樹獨有的檔案另外標明。
- 「最後修改日期」說明：`docs/` 內大量檔案的 git 最後 commit 日期是 **2026-08-30**（一次整批匯入），不代表內容日期。下表同時給「檔名日期／內文日期」與「git 最後 commit」。

## 0. 先講結論

1. `docs/` 在 master 上共 **1,885 個 tracked 檔案、約 73 MB**；其中真正屬於「目前仍應被讀」的不到 **30 份**，其餘 98% 是 Codex 時期的收據、證據與一次性報告。
2. `docs/DOCUMENT_AUTHORITY.md`（內文 2026-07-25，git 2026-09-01）宣告的 canonical 讀取順序，**第一順位就是已過期的快照**，而且沒有列入現在真正決定工程行為的 `AGENTS.md`、`CLAUDE.md`、`docs/domain-workflows.md`、`.claude/skills/*`。以它為入口會把人導向錯誤的現況。
3. 「現況」文件彼此矛盾（詳見 §2）：分數、migration 數、staging 來源、Funnel 狀態各有 2～4 種說法，且最新的 `docs/launch/CURRENT.md` 停在 2026-09-29（master 之後又合了約 95 個 PR）。
4. 有 **一組文件被測試或腳本以固定路徑讀取**（§1 標「釘住」），搬動前必須同步改腳本，不能直接 `git mv`。
5. `PRODUCT.md`（尚未 commit 的修改）與 `docs/domain-workflows.md` 對「虛擬使用者／腳本角色」的規則直接衝突，需 owner 裁示。

---

## 1. 分類總表

分類代號：**C** = canonical current；**R** = operational runbook；**H** = historical evidence／receipt；**P** = product／UX research。
建議去向：保留＝留在原地；封存＝搬到 `reports/archive/2026/…`；刪除候選＝封存 tag 建立後可從 working tree 移除（git 歷史仍可還原）；更新＝內容過期需改寫。
「釘住」＝已確認有 `scripts/`、`tests/` 或 CI 以固定路徑讀取，移動前要改引用。

### 1.1 大量收據群（約 1,720 個檔案，佔 91%）

| 路徑模式 | 數量 | 日期範圍（檔名／git） | 類 | 用途 | 建議去向 |
|---|---:|---|---|---|---|
| `docs/ai-team/evidence/g7-*`（browser-qa json、`.sha256`、`*-screenshots/` PNG、closure md） | 983 | 2026-08-06～09-25／git 2026-08-30 | H | G7 系列 Goal 的瀏覽器 QA 與功能收尾證據（g7-04 一項就 490 張截圖資料夾內檔案） | 封存；PNG 可列刪除候選 |
| `docs/ai-team/evidence/wp-*`（含 wp-106…wp-166 等 runner 證據 md／json） | 110 | 2026-08～09／git 2026-08-30 | H | 各 WP runner 的 sanitized receipt | 封存；`scripts/wp1xx-*.mjs` 預設寫入此處，改預設輸出路徑後再搬 |
| `docs/ai-team/evidence/wp7-one-stop-webinar-flow-*`、`wp6-persistent-player-*`、`wp4-*` | 95 | 2026-08／git 2026-08-30 | H | 一場即上線／持續播放器的 QA（memory 記載該分支已被 master 取代） | 刪除候選（先封存 tag） |
| `docs/ai-team/evidence/qual-*`、`rel-20260821-*`、`sec-*`、`release-*`、`master-*`、`goal-*`、`cat04/06/10-*` 等 | 93 | 2026-08-07～09-25／git 2026-08-30 | H | 品質、release、安全、類別（CAT）收尾報告 | 封存 |
| `docs/ai-team/evidence/fin-*`、`func-*` | 92 | 2026-08-07～08-08／git 2026-08-30 | H | 金流（fin）與功能（func）Closure；內含 PayUni 對帳歷史，有稽核參考價值 | 封存（md 保留可讀，不要刪） |
| `docs/ai-team/evidence/` 其他（`acceptance-*`、`affiliate-*`、`one-*`） | 3 | 2026-08～09 | H | 零星證據 | 封存 |
| 小計 `docs/ai-team/evidence/*`（含 518 PNG、357 md、216 json、242 sha256、43 txt） | **1,376** | 2026-08-06～09-25／git 2026-08-30～09-25 | H | Codex AI Team 的 evidence 目錄（約 51 MB，占 docs 的 70%） | **整批封存**；PNG 518 張為首要刪除候選 |
| `docs/remaining-capabilities-*.json`（f1 62、f2 145、f3 19、q1 5、q2 8、private 8、其他 8） | 255 | 2026-10-05～10-09／git 2026-10-06～10-18 | H | 「remaining capabilities」Goal 的每次本機／CI／Browser 收據，含大量失敗重試紀錄 | 封存 |
| `docs/remaining-capabilities-*.md`（`session-handoff-20261006`、`work-matrix-20261005`） | 2 | 2026-10-05～10-06／git 2026-10-17 | H（但被引用） | `work-matrix` 被 `domain-workflows.md` 當作「工作矩陣」引用 | **work-matrix 保留／改名並更新引用**；session-handoff 封存 |
| `docs/branch-integration-*`（json 82、md 6、patch 3） | 91 | 2026-10-04～10-05／git 2026-10-04～10-11 | H | 分支整併稽核；已被 `branch-cleanup-20261017.md` 與 handoff 取代 | 封存（3 個 `.patch` 先確認內容已進 master 再決定是否刪） |
| `docs/launch/` 歷史收據與舊計畫（見 §1.2） | 35 | 2026-07-28～09-29 | H | 舊 readiness、舊 Goal plan、舊 owner packet | 封存 |
| 根目錄歷史報告（release-readiness-audit-2026-07-21／22、staging-validation-report-2026-07-21、staging-backup-restore-drill-2026-07-22、external-service-validation-report、report-1、report-2、agy-claude-transport-repair-20261006.json、sharp-security-patch-20261007.json） | 10 | 2026-07-21～10-07 | H | 單日快照；`DOCUMENT_AUTHORITY` 已明示「只可證明該日」 | 封存 |
| `docs/ai-team/LINE-OA-CLOSURE-DELIVERY-2026-09-07.md`、`master-execution-plan.md`、`master-planning-input.md` | 3 | 2026-08-30～09-07 | H | Codex AI Team 的規劃輸入／LINE OA 交付；兩份 master-* 內容引用已刪除的 `.ai-team` | 封存 |
| 分支清理紀錄：`branch-cleanup-20261017.md`、`branch-cleanup-remote-delete-20261017.txt`、`branch-refs-backup-20261017.txt` | 3 | 2026-10-17／git 2026-10-18 | H | 刪除分支前的 ref SHA 備份，**還原用** | 保留至 2026-11 底（封測後）再封存，不可刪 |

### 1.2 `docs/launch/`（master 上 60 個檔案）

| 路徑模式 | 數量 | 日期範圍 | 類 | 用途 | 建議去向 |
|---|---:|---|---|---|---|
| `CURRENT.md`、`NEXT-CYCLE.md` | 2 | 內文 2026-09-29 | C（已過期） | 固定 staging 現況與下一輪工作；仍引用已刪除的 AI Team 路由與 #349 之前的來源 | **更新**（見 §2、附錄 B） |
| `local-database-development.md` | 1 | git 2026-10-18 | R | WP-07 本機 DB 與 seed 流程 | 保留 |
| `sandbox-payment-only-runner.md`、`secure-staging-runner.md`、`staging-backup-recovery.md`、`staging-cron-operations.md`、`staging-migration-apply.md`、`staging-migration-compat-preflight.md`、`staging-provider-binding-attestation.md`、`payuni-live-one-time-probe.md`、`payuni-staging-live-plan-test.md`、`cat04-fresh-staging-payuni-reconciliation-runbook-20260807.md` | 10 | 2026-08-07～10-04 | R | staging／Sandbox 受保護 runner 與還原、migration 程序 | 保留，逐份核對是否仍符合 `.github/workflows`（尤其 #430 新增的 staging-migrate） |
| `wp122/123/125/126/127/129/175/195-*-contract.json`（8）、`solo-founder-launch-score.json`、`solo-founder-launch-standard.md`、`current-release-gate-handoff-20260821.md`、`cat10-policy-review-matrix-20260821.md` | 12 | 2026-08 | H（**釘住**） | 由 `scripts/*.test.*` 以固定路徑讀取的契約 JSON 與標準 | 暫時保留原地；改成「fixture」搬到 `scripts/fixtures/` 時一併改測試 |
| 其餘歷史（`current-readiness-snapshot-20260802.{md,json}`、`current-readiness-provenance-manifest.json`、`current-function-scorecard-20260809.json`、`current-release-completion-audit-20260821.md`、`current-release-owner-action-packet-20260822.md`、`current-snapshot-regression-baseline.md`、`evidence-index.md`（226 KB）、`goal-plan/preflight/progress/review-status-20260924.md`、`integration-inventory-20260924.md`、`m2-*`、`manual-blockers.md`、`next-work-packages.md`、`payuni-token-contract-20260929.md`、`prelaunch-*-20260929.md`、`production-readiness-baseline.md`、`readiness-reconciliation-2026-07-30.md`、`remaining-git-review-plan.md`、`sandbox-*-receipt/reconciliation-20260928.md`、`stream-resource-receipt-20260929.md`、`tool-blockers.md`、`wp-91-*`、`wp08-*`、`wp1-*`、`wp19-*`、`change-batch-plan.md`、`cat10-human-owner-acceptance-packet-20260807.md`） | 35 | 2026-07-28～09-29 | H | 舊現況快照、舊 Goal 計畫與收據 | 封存；`current-readiness-snapshot-20260802.json` 被 `scripts/readiness-truth-reconciliation.mjs` 讀取（釘住），`payuni-token-contract-20260929.md`、`integration-inventory-20260924.md` 仍被 NEXT-CYCLE 引用，待改寫後再封存 |

### 1.3 其他資料夾與根目錄單檔

| 路徑模式 | 數量 | 日期範圍 | 類 | 用途 | 建議去向 |
|---|---:|---|---|---|---|
| `docs/domain-workflows.md` | 1 | git 2026-10-18 | C | 6 個專案 skill 的領域規則本體 | 保留（需處理 §2 衝突 #6） |
| `docs/DOCUMENT_AUTHORITY.md` | 1 | 內文 2026-07-25／git 2026-09-01 | C（已失真） | 文件權威地圖 | **改寫**（附錄 A 草稿） |
| `docs/handoff-codex-to-claude-20261017.md` | 1 | 2026-10-17 | H（一次性交接） | Codex→Claude 交接，多項狀態已過期（§2 #7） | 保留到 11/01 後封存；先加「已過期」頁首 |
| `docs/codex-goal/API_CONTRACT_REGISTRY.md`、`PRISMA_INVARIANTS.md` | 2 | 內文 2026-08-25／2026-10-06，實際 git 2026-10-19 | C（**釘住**） | 各有 `scripts/*.test.ts` 對照程式碼，AGENTS.md 要求新 model／migration 登記 | 保留原路徑；頁首日期與基準 revision 需更新 |
| `docs/codex-goal/` 其餘 10 份：`ARCHITECTURE_BOUNDARIES`、`AUTHORIZATION_MATRIX`、`ARTIFACT_INDEX`、`CODE_REVIEW_REPORT`、`DECISIONS_NEEDED`、`MANUAL_ACTIONS`、`PROGRESS`、`QA_REPORT`、`QUALITY_SCORECARD`、`REQUIREMENTS_TRACEABILITY` | 10 | 內文 2026-07-25～08-13；git 2026-08-30（`DECISIONS_NEEDED` 10-04） | H | 7～8 月 Goal 的狀態快照；無任何腳本引用 | 封存；`AUTHORIZATION_MATRIX`、`DECISIONS_NEEDED`、`MANUAL_ACTIONS` 若仍有效，抽取後併入新文件再封存 |
| `docs/codex-goal/` 工作樹獨有（gitignore）：`CELEBRATEDEAL_PLAN`、`GOAL_RUNBOOK`、`GOAL_*_PROMPT` ×3、`COMMAND_LOG`、`README`、`REPOSITORY_HYGIENE` | 8（僅本機） | 2026-07-25～08-07 | H | Codex 時期 Goal 規則；**不在 repo 內**，但 `DOCUMENT_AUTHORITY.md` 與 `README.md` 仍把它們當連結目標 | 刪除候選（本機檔，不影響 git）；同時修正 README 死連結 |
| 根目錄 runbook／SOP：`admin-mfa-recovery-sop`、`password-reset-email-smoke-runbook`、`cloudflare-stream-dashboard-checklist`、`external-service-validation-runbook`、`payuni-sandbox-checkout-runbook`、`payuni-pending-refund-consumer`、`production-backup-restore-runbook`、`production-database-runbook`、`production-go-live-checklist`、`production-rate-limit-runbook`、`staging-backup-restore-drill-runbook`、`staging-production-env-vars`、`ai-team-payuni-sandbox-qa` | 13 | 2026-07-10～10-11（多數 git 2026-08-30） | R | 操作程序 | 搬到 `docs/runbooks/`（連結更新）；`ai-team-payuni-sandbox-qa.md` 檔名與內容引用已刪除的 AI Team，需改寫改名 |
| 根目錄規劃／參考：`admin-mfa-hardening-plan`、`production-go-live-master-plan`、`production-infrastructure-plan`、`production-launch-task-breakdown`、`production-readiness-review`、`live-commerce-mvp-report`、`team-funnel-replication` | 7 | 2026-07-10～10-04 | R／P（混合） | 上線規劃與 MVP 範圍參考；內含「目前狀態」多為 7～8 月 | 核對後更新或標註「規劃參考，非現況」，建議併入 `docs/runbooks/` 或 `docs/research/` |
| `docs/operations/*`（3 份 SOP） | 3 | git 2026-10-04 | R | 客服／資料請求／商家 onboarding 營運 SOP | 保留 |
| `docs/product/funnel-operations.md` | 1 | git 2026-09-22 | R | Funnel 營運說明 | 保留，需對照 WP-01（#440）更新 |
| `docs/decisions/ADR-2026-08-13-solo-founder-owner-model.md` | 1 | 2026-08-13 | C | 單人創辦人 owner 模型決策 | 保留；此資料夾即新決策記錄的歸宿 |
| `docs/bombmy_analysis/`（md 5、PNG 15） | 20 | 2026-07-08 | P | 競品 Bombmy 後台拆解 | 搬 `docs/research/`；已被 2026Q4 市調部分取代 |
| `docs/codex_review/`（md 1、PNG 25） | 26 | 2026-07-09 | P | Codex 的 UX audit 與截圖 | 搬 `docs/research/`；PNG 列刪除候選 |
| `docs/market-2026Q4/`（**未追蹤**，工作樹） | 約 7 | 2026-10-18 | P | 本輪新市場調查（報告＋research_notes） | 保留；等 owner 決定是否 commit |
| `docs/goal-plan-review-research-skills-20261017.md`（**未追蹤**） | 1 | 內文 2026-10-17，2026-10-19 更新 | C（進行中計畫） | 本次 Review Goal 計畫書 | 保留；Goal 結束後轉入 `reports/archive/2026/` |
| `docs/live-feature-handoffs/`（gitignore，僅本機） | 60 | 2026-09-11～09-12 | H | 直播功能 QA 暫存 JSON／PNG | 刪除候選（本機檔） |

### 1.4 數量驗算

master 上 `docs/` 1,885 = ai-team/evidence 1,376 + remaining-capabilities 257 + branch-integration 91 + launch 60 + 根目錄單檔 35 + codex_review 26 + bombmy 20 + codex-goal 12 + ai-team 其餘 3 + operations 3 + product 1 + decisions 1。
分類占比（以檔案數）：H 約 1,720（91%）、C 約 8、R 約 40、P 約 46＋（市調）。其中「釘住」約 22 個。

---

## 2. 權威文件核對

### 2.1 `DOCUMENT_AUTHORITY.md` 指向的 canonical 文件逐一核對

DOCUMENT_AUTHORITY 的 12 份 canonical（`docs/codex-goal/*`）全部在 master 上存在，但**內容日期**如下，與「目前 revision」不符：

| 文件 | 檔內最後更新 | git 最後 commit | 是否仍反映現況 | 備註 |
|---|---|---|---|---|
| `PROGRESS.md` | 2026-08-10 08:00（內文狀態是 2026-07-25 快照，分支 `codex/payuni-sandbox-external-qa`、HEAD `35d8f593`） | 2026-08-30 | **否** | 自己也寫「current canonical readiness 以 `docs/launch/current-readiness-snapshot-20260802.json` 為準」，等於否定了 DOCUMENT_AUTHORITY 把它列第 1 順位 |
| `QUALITY_SCORECARD.md` | 2026-07-25 22:21 | 2026-08-30 | 否 | Q07 仍寫「51-model／9-migration」 |
| `REQUIREMENTS_TRACEABILITY.md` | 2026-08-13 | 2026-08-30 | 否（27 項需求，未含後續 Goal） | |
| `ARCHITECTURE_BOUNDARIES.md` | 2026-07-25 20:55 | 2026-08-30 | 未核對，推測過期 | `src/` 已從 187 檔增至 1,461 個 ts/tsx |
| `AUTHORIZATION_MATRIX.md` | 2026-07-25 19:25 | 2026-08-30 | 未核對，推測過期 | 路由已從 63 增至 122 個 `route.ts` |
| `API_CONTRACT_REGISTRY.md` | 檔頭 2026-08-25、基準 `9cd7473`；但檔尾有 2026-10-19 WP-05 段落 | **2026-10-19** | **部分**（持續被 PR 追加，被測試釘住） | 檔頭日期與基準 revision 沒更新 |
| `PRISMA_INVARIANTS.md` | 檔頭 2026-10-06、基準 `4ed3b463` | **2026-10-19** | **部分**（表格 148 models／108 migrations 正確，檔頭與註記過期） | 同一檔頭有兩行互相矛盾的 blockquote（「已增至 86」「已增至 87」），表內又說 66/71 套用 |
| `QA_REPORT.md`、`CODE_REVIEW_REPORT.md` | 2026-07-25 22:21 | 2026-08-30 | 否 | |
| `MANUAL_ACTIONS.md` | 2026-07-25（內文），08-13 | 2026-08-30 | 否 | |
| `DECISIONS_NEEDED.md` | 2026-07-25 22:05 | 2026-10-04 | 部分 | 後來有追加，owner 決策（如 10-17、10-18）未必回寫 |
| `ARTIFACT_INDEX.md` | 2026-07-25 22:21 | 2026-09-01 | 否 | |

另外：
- `CELEBRATEDEAL_PLAN.md`、`GOAL_RUNBOOK.md`（DOCUMENT_AUTHORITY 的「Execution contract」）被 `.gitignore`（第 113～120 行）排除，**只存在這台電腦**，clone 後是死連結。`README.md` 第 55 行的 `docs/codex-goal/README.md` 同樣是死連結。
- DOCUMENT_AUTHORITY「更新規則」要求新證據寫入 `reports/quality/<UTC>-*.md`，但 `reports/quality/` 在 `.gitignore`（第 23 行），那些證據永遠不進 git。
- DOCUMENT_AUTHORITY 完全沒有提到 `docs/launch/CURRENT.md`、`docs/domain-workflows.md`、`AGENTS.md`、`CLAUDE.md`、`.claude/skills/*`、`docs/decisions/`、`docs/operations/`。

### 2.2 互相矛盾的「現況」敘述

排序依對 11/01 封測決策的危害程度。

| # | 議題 | 說法 A | 說法 B／C | 較新者與判斷 |
|---|---|---|---|---|
| 1 | **文件權威鏈循環／失真** | `DOCUMENT_AUTHORITY.md`（內文 07-25）：現況先讀 `codex-goal/PROGRESS.md` → `QUALITY_SCORECARD.md` | `PROGRESS.md`（08-10）：現況以 `launch/current-readiness-snapshot-20260802.json` 為準；該 snapshot 自稱「目前唯一的 current readiness truth surface」；`launch/CURRENT.md`（09-29）又自稱 staging 現況，並說「文件更新或 CI 綠燈不能代替驗收」 | 最新的是 `CURRENT.md`（09-29），但它沒被任何 authority 文件指向，也比 master 落後約 95 個 PR。**沒有任何一份文件能被當作目前現況** |
| 2 | **readiness 分數** | `QUALITY_SCORECARD.md`（07-25）與 snapshot（updated 08-21）：canonical total **75.5**（CAT04=6.0、CAT10=4.5） | `solo-founder-launch-score.json`（asOf 08-21）：**68.65**，且 `scoreAppliedToCanonical=false`；ADR-2026-08-13 規定它不自動改寫 canonical total；`CURRENT.md`（09-29）不給分數，只說 `CORE_STAGING_READY` 尚未成立，Production「未評定」 | 同日 08-21 兩個數字並存；09-29 之後再沒有分數。結論：分數已無人維護，不要在封測溝通中引用 75.5 或 68.65 |
| 3 | **Migration／Model 數量** | `DOCUMENT_AUTHORITY.md` 與 `QUALITY_SCORECARD` Q07：**51 models／9 migrations**；`PROGRESS.md`（08-10）：53 migrations | `PRISMA_INVARIANTS.md` 檔頭：「已增至 86」「已增至 87」「66/71 套用」；`handoff-codex-to-claude-20261017.md`：#423／#424「調到 96」；`goal-plan-…`（WP-07 基準）：96 | **master 實際：148 models、108 migration 目錄**（本次以 `git ls-tree`／`grep -c '^model '` 驗證）。#427 已移除測試內寫死的總數，handoff 的「96」已無對應檢查 |
| 4 | **Staging 來源 commit** | `CURRENT.md`（09-29）：固定 alias → Preview `codex/staging-release-20260928`，來源 `5d5b8146`（#345）；master 核對基準 `43809aaf`（#349）；回復點 `29ba9f6a` | `goal-plan-review-research-skills-20261017.md` §2.4（未追蹤，10-19）：staging 已套用全部 migration 並部署 master `78621ca3`（#444）；`PRISMA_INVARIANTS` 基準 `4ed3b463`；`PROGRESS.md` HEAD `35d8f593` | 最新是 10-19 的說法，但它是未追蹤文件的單一來源，**repo 內沒有任何 tracked 收據證明**；`CURRENT.md` 對應的舊來源已落後 95 個 PR。需用受保護 runner 重新取得 staging 來源收據 |
| 5 | **Funnel 是否 BLOCKED／綁卡能力** | `CURRENT.md`、`NEXT-CYCLE.md`（09-29）：Funnel 核心旅程 **BLOCKED**（公開頁 404、合成專案 DRAFT）；付款方式綁定「程式缺口」，PayUni adapter 回 `provider_setup_unsupported`；mobile 未驗 | master 之後：#440 WP-01（10-18）把不可用公開頁改成明確 404/503 並提供商家診斷；#434 WP-02 拆分平台服務付款與客戶收款閘門；#444（10-19）修正綁卡 return redirect；NEXT-CYCLE 的 PayUni Token 契約申請狀態（「尚未申請」）無後續紀錄 | 最新是 master 的 PR 標題（10-19）。**BLOCKED 是否解除沒有任何收據**；404 現在是「刻意行為」而非失敗，原 BLOCKED 敘述的判定條件已失效 |
| 6 | **虛擬使用者／腳本角色規則** | `PRODUCT.md`（工作樹未 commit 修改，註明 2026-10-18 owner 決策）：商家可用腳本化虛擬使用者營造人氣，只限觀眾端聊天室，不計入商業統計；法律責任由服務條款規範，**需律師審閱** | `docs/domain-workflows.md` L20（commit `68df16d4`，10-18）：「官方／AI／system 互動角色必須揭露，不能假扮真人觀眾」；HEAD 版 `PRODUCT.md` 也寫「不把官方或腳本角色包裝成真人」 | 同日、同來源（owner）的決策只改了一份。`domain-workflows.md` 是 6 個 skill 的規則本體，**工程師與審查者目前會依它拒絕虛擬使用者功能**。需 owner 確認後同步改兩份，並登記到 `DECISIONS_NEEDED`／ADR（律師審閱為前置條件） |
| 7 | **Codex→Claude 交接紀錄過期** | `handoff-codex-to-claude-20261017.md`（10-17）：#423、#424「等 CI 與獨立審查」；#420 本機 merge commit 未推送；Codex 最後 Goal「14/20 完成，其餘 WP-04、13、14、16、17、18」 | master：#423（e5603bcf）、#424（de991b2b）已合；#420 由 #431 取代並合併；WP-01/02/03/05/06/07/08/09/12/15 已以 WP 編號合併（共 10 個），「14/20」中另 4 個（WP-10、11、19、20，tag 內有 evidence 與 migration）在 master **未見** | handoff 是一次性紀錄但被當成現況閱讀。已知需加頁首「已過期，現況見 master」 |
| 8 | **舊團隊路由仍被引用** | `CURRENT.md`／`NEXT-CYCLE.md`「交接」段、`README.md`（連到 codex-goal）、本機 `GOAL-AI-TEAM-PROMPT.md`：以 AI Team Pro、Luna／Sol／Astra、`ai-team-router`、`docs/ai-team/goal-protocol.md` 為流程 | `CLAUDE.md`、`AGENTS.md`（#428，10-18）：改為 Claude Code 四個 agent（engineer-hard／engineer／reviewer／docs）；`.ai-team/`、`.agents/skills`、`.codex/agents` 已刪 | master 上 **83 個 docs 檔案（不含 evidence）、133 個 scripts、117 個 evidence 檔** 仍含 `.ai-team`／`.agents/skills`／`.codex/agents` 字串；新工程師照著 CURRENT.md 會尋找不存在的工具 |
| 9 | **規模與路由數** | `DOCUMENT_AUTHORITY.md`：API registry「63 route contract rows」；`QUALITY_SCORECARD`：「27/27 route registry」、「187-file import graph」 | `goal-plan-…` §1.3：116 個 `route.ts`、`src/` 1,461 個 ts/tsx；本次驗證 master 為 122 個 `route.ts` | 數字全數過期；API registry 實際涵蓋範圍未核對（`scripts/api-contract-registry.test.ts` 會檢查，以測試為準，不要引用文件中的數字） |
| 10 | **證據寫入位置** | `DOCUMENT_AUTHORITY.md`：新證據進 `reports/quality/<UTC>-*.md` | `.gitignore` 排除 `/reports/quality/`；Codex 實際把 1,376 個 evidence 與 348 個 JSON 收據寫進 `docs/` | 文件說一套、實際做另一套；Claude 接手後尚未定義新規則（附錄 A 提案） |

### 2.3 其他需留意的不一致

- `AGENTS.md` 要求「在 `codex/*` 分支工作」，而 Codex 已退場；分支前綴是歷史命名，非衝突，但建議在 AGENTS.md 註明沿用 `codex/` 前綴或改成 `claude/`（需同步 branch protection 與 CI 觸發條件）。
- `AGENTS.md` 的審查觸發條件是「付款、checkout、退款、佣金、auth／權限或 migration」；`domain-workflows.md` 寫成「security／payment／DB」；`CLAUDE.md` 對 `engineer-hard` 另列「租戶邊界、併發、大型重構」。三者範圍措辭不同，未造成實際衝突，但審查者無法單看一份判斷是否必審。
- `docs/launch/NEXT-CYCLE.md` 第 5 點的 CI flaky（`direct-url-guard.ts`）：未見後續關閉紀錄。
- `docs/domain-workflows.md` 引用 `remaining-capabilities-work-matrix-20261005.md` 當「工作矩陣」，若未來把 `remaining-capabilities-*` 整批封存會產生死連結。

---

## 3. 仍然有效的規則清單（去重）

來源簡稱：**A**=`AGENTS.md`、**C**=`CLAUDE.md`、**D**=`docs/domain-workflows.md`、**S**=`.claude/skills/celebratedeal-*/SKILL.md`（六個皆為指向 D 的薄入口，無獨立規則）、**P**=`PRODUCT.md`。

### 3.1 流程與安全

| # | 規則 | 來源 | 與其他文件衝突？ |
|---|---|---|---|
| 1 | 所有回覆用自然的繁體中文（台灣用語） | A | 否 |
| 2 | 改 Next.js 程式前先讀 `node_modules/next/dist/docs/` 對應文件（此版本有 breaking changes） | A | 否 |
| 3 | 不讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、私鑰、正式 Secret、正式客戶／付款資料 | A | 否 |
| 4 | Production 部署、正式 DB、正式付款／退款、正式寄信與其他不可逆外部操作，需 owner 另外明確授權 | A、D | 否 |
| 5 | 本機、Preview、staging、PayUni Sandbox、可拋棄的 loopback `celebratedeal_*` PostgreSQL 可直接用於驗證，使用合成資料 | A、D | 否 |
| 6 | 不用 `reset`／`clean`／`stash`／`restore`／`checkout` 丟棄不明變更；禁止 force push 與直推 `master` | A | 否 |
| 7 | `master` 受保護：在 `codex/*` 分支工作，經 PR、`quality` CI 通過後 squash 合併 | A | 輕微：Codex 已退場，前綴待決（§2.3） |
| 8 | 依風險跑 targeted tests、`npm run typecheck`、`npm run lint`；沒跑的不能說通過 | A、D | 否 |
| 9 | 不降低 assertion／coverage 門檻，不用 skip 或假資料掩蓋失敗 | A、D | 否 |
| 10 | 付款、checkout、退款、佣金、auth／權限、migration 變更，合併前需一次獨立審查（`.claude/agents/reviewer.md`），不得自行核准 | A、C、D | 範圍措辭不一致（§2.3） |
| 11 | 主對話在 Fable 上不寫程式，程式修改派給 `engineer-hard`／`engineer`；Opus 與 Sonnet 都解決不了時先通知 owner 並經同意才交給 Fable | C | 否 |
| 12 | 派工須給明確目標、檔案範圍、完成標準與分支；每個檔案同時只有一個 writer；推送與開 PR 由主對話負責並親自檢查子代理結果 | C | 否 |
| 13 | 高風險（付款、checkout、退款、佣金、auth、租戶邊界、migration、併發、大型重構）用 `engineer-hard`（Opus high）；一般功能用 `engineer`（Sonnet medium）；文件用 `docs`（Haiku low） | C | 否 |
| 14 | 交付回報含 scope、已通過與失敗的 gate、證據、外部相依、forward migration 與可恢復方式、必要 review、下一步與 owner；不得把未驗證配置或 requested／resolved model 當成 observed | D | 否 |
| 15 | 證據綁目前 revision／head；保留所有失敗與歷史 checksum；外部 provider 缺證據就標 blocked，不以 mock 或本機 demo 代替真實 Sandbox | D | 否 |

### 3.2 程式與資料

| # | 規則 | 來源 | 與其他文件衝突？ |
|---|---|---|---|
| 16 | 每個輸入 ID 與 relation connect 都要在最後的 DB 操作綁定目前 vendor ownership（compound predicate 或 server-side check）；不可先全域查詢再於記憶體過濾；UI 隱藏不算權限 | A、D | 否 |
| 17 | 金額只來自伺服器紀錄；client 的 price／vendor／affiliate／rate 不可覆寫；歸因與價格由 checkout 伺服器綁定並凍結 | A、D | 否 |
| 18 | Migration 只能往前（forward-only）；新增 model 或 migration 同步登記到 `docs/codex-goal/PRISMA_INVARIANTS.md`（有測試檢查） | A | **文件本身過期**（§2.2 #3），但規則有效 |
| 19 | Schema 變更評估 tenant key、FK、unique、index、既有 RLS 與 forward migration；RLS 是額外防線，不取代 server guard 與 audit | D | 否 |
| 20 | 每個新增敏感 read／mutation／export／relation 都要有第二租戶負向回歸；拒絕時不洩漏存在性 | D | 否 |
| 21 | 未知訂單或未驗證 webhook 不可產生權威付款與佣金；provider＋event ID 冪等；結算鎖定後只追加 adjustment，不改舊 ledger | D | 否 |
| 22 | 對帳恆等式：`refundedAmount = Σ valid RefundRecord`；`net commission = 正向佣金 + void／負向 adjustment`；`settlement payable = collected − refunds − fees − commissions + adjustments`；以 ledger 驗證，不以文字公式取代 | D | 否 |
| 23 | Chargeback／拒付要核對原交易、佣金與結算調整，不可未經 provider 證據當成普通退款；click-through 不能宣稱收入 | D | 否 |
| 24 | 金流、角色、ownership、安全變更須有適當 audit | D | 否 |

### 3.3 瀏覽器 QA 與設計

| # | 規則 | 來源 | 與其他文件衝突？ |
|---|---|---|---|
| 25 | 瀏覽器 QA 使用固定非 Production 環境與唯一合成資料；驗證實際交付介面、可見結果、URL／state、API 回應及必要 DB 落地；輸入欄位仍有文字不能證明 POST 成功 | D | 否 |
| 26 | 視覺／responsive 變更檢查 Chromium 與 390×844、768×1024、1280×800、1440×900；重大 UI 另驗 keyboard、a11y、clipping／overlap | D | 否 |
| 27 | 證據格式 `scenario｜role｜viewport｜data state｜result｜revision/head｜evidence｜issue`；只存有界、去識別分類，不存 raw log、URL query、header、payload；敏感旅程不保留可能含 token 的 trace／screenshot／video | D | 否 |
| 28 | 不得停用 assertions、盲改 snapshot、以重試掩蓋固定失敗，或把 external-required 改成 PASS | D | 否 |
| 29 | 重用 `ui.tsx`／`globals.css` 的元件與 token；定義 default／hover／focus-visible／disabled／loading／empty／error／success／selected；不加無產品理由的紫藍漸層、玻璃效果、巢狀卡片、emoji icon | D | 否 |
| 30 | WCAG 2.2 AA 為目標：鍵盤操作、可見焦點、足夠對比、`aria-busy`／`role=status`／`role=alert`、reduced motion；沒實際驗證不能宣稱 a11y／responsive 完成 | P、D | 否 |

### 3.4 產品

| # | 規則 | 來源 | 與其他文件衝突？ |
|---|---|---|---|
| 31 | 商業狀態講真話：付款、退款、佣金、履約、通知只呈現系統實際確認的狀態；後台報名、訂單、付款、成效只呈現真實資料 | P、D | 否 |
| 32 | 所有非同步動作有 loading／pending／防重送／成功／可修正的錯誤；長流程逐步保存草稿並處理 revision conflict；草稿與發布分離 | P | 否 |
| 33 | 不以只填圖片／影片 URL 為主要媒體流程；不複製 Bombmy 等競品的品牌、文案、素材 | P | 否 |
| 34 | 官方／AI／system 互動角色必須揭露，不能假扮真人觀眾 | D（及 HEAD 版 P） | **衝突**：工作樹 `PRODUCT.md` 的 2026-10-18 owner 決策允許腳本化虛擬使用者（§2.2 #6） |
| 35 | 區分 live／scheduled prerecorded／VOD／preview／published，以及 visitor／lead／click／checkout／paid／refund／commission／payout；外部 storefront 只有 API、webhook、核准匯入或 reconciliation 的訂單證據可計入 conversion | D | 否 |
| 36 | 中文文案使用台灣常見用語，不要求使用者理解內部資料模型或供應商術語 | P | 否 |

規則本體集中在 `AGENTS.md`（流程）與 `domain-workflows.md`（領域）兩份；六個 skill 只有指向 D 的錨點（`#歸因與佣金`、`#瀏覽器-qa`、`#設計與互動`、`#租戶與權限`、`#產品與角色`、`#驗收與交付`），目前錨點全部有效，改標題時要同步檢查。

---

## 4. Codex 最後一個 Goal 的殘留

### 4.1 `archive/wip/product-audit-goal-plan-20261017` 內容

只列路徑統計（未 checkout）。tag 為單一 commit `a88a7c8e`（「preserve uncommitted Codex work」，基於 master `efb8b7e9`），共 **4,991 個檔案**：

| 範圍 | 檔案數 | 說明 |
|---|---:|---|
| `docs/ai-team/evidence/product-audit-20261011/**`（WP-01～WP-20 各自子目錄＋`decisions/`、`plan/`、`remaining-*-audit-*.json`） | 4,337 | WP-20 1,610、WP-05 786、WP-11 603、WP-08 285、WP-13 147、WP-03 129、WP-18 128、WP-01 127…（WP-16 無任何 evidence） |
| `src/lib/**` | 238 | 含 live metric、registration、order source 等 |
| `src/app/**` | 194 | |
| `src/components/**` | 56 | |
| `docs/launch/**` | 41 | `goal-plan-20261011-product-audit.md`、`product-audit-20261011-{blockers,progress}.md`、`product-audit-20261012-handoff.md`、`provider-decisions-research-20261016.md`、`policies-20261016-draft.md`、`line-notification-operations.md`、`wp02/03/04/09/12/13/19-*-handoff|blocker|setup-2026101x.md`、`wp11-entry-deployment.md`、`wp20-*.md`（約 20 份）等 |
| `prisma/migrations/**` | 37 | 含 `20261011_registration_form_retry_draft` 與 `20261014120000_live_metric_evidence`…`20261015170000_live_metric_registration_source_revision` 共約 10 個 live_metric 系列 |
| `scripts/**` | 72 | 幾乎全是 `wp20-*` disposable 探針 |
| `tests/e2e/**` | 7 | |
| 其他 | 6 | `.gitignore`（+285 行）、`.vercelignore`、`next.config.ts`、`package.json`、`vitest.config.ts`、`src/proxy.ts`、`src/proxy.test.ts` |

重點觀察：
- tag 本身**含 secret scan 命中**（handoff 記載已人工確認為 loopback／example 佔位 URL，合併前必須重做）。
- tag 的 migration `20261011_registration_form_retry_draft` 在 master 上已被重做為 `20261018110000_registration_form_retry_draft`（WP-05 #441），顯示 master 是「重新實作」而非 cherry-pick，tag 內程式碼不能直接合併。
- 十個 `20261014…20261015` live_metric migration 在 master **不存在**（已驗證），代表 WP-20 的資料層沒被收進來。
- 該 tag 的 `.gitignore` 加了 285 行，會放大 docs 收據進 git 的問題；**不要**從 tag 取回 `.gitignore`。

### 4.2 WP-01～WP-20 與 master 近 PR 對照

依 `git log --oneline origin/master -25` 的 PR 標題中的 WP 編號判斷。**「已合併」依標題字串；「未見」只代表近 25 個 PR（#418～#444）標題沒出現該編號，屬推測**（已另用 `git log -60` 與 `git ls-tree` 確認 live_metric migration 與 `request-client-ip.ts` 不在 master）。WP 名稱取自 tag 內 `goal-plan-20261011-product-audit.md`。

| WP | 主題 | 狀態 | 對應 PR（推測依據） |
|---|---|---|---|
| WP-01 | 發布鏈單一語意／缺項清單／諮詢路徑 | 已合併 | #440 `ab8e2ead`（標題 WP-01） |
| WP-02 | 商家扣款方式拆出銷售就緒閘門 | 已合併 | #434 `f8844cd1`（WP-02） |
| WP-03 | 政策頁與頁尾 | 已合併（需 owner 簽核） | #435 `460b6e6a`（WP-03，標題註明 needs owner sign-off，律師審閱未確認） |
| WP-04 | 排程註冊、心跳、外部 scheduler | **未見** | handoff：缺固定隔離的非 Production scheduler |
| WP-05 | 原生表單失敗回原頁／無障礙回饋 | 已合併 | #441 `357fded4`（WP-05） |
| WP-06 | 修死連結、補夥伴頁／LINE 入口 | 已合併 | #439 `9bf83f4f`（WP-06/08/15 合併一個 PR） |
| WP-07 | 修 seed、DB 落後自檢 | 已合併 | #438 `96b20e36`（WP-07） |
| WP-08 | 工作區／Dashboard 中文化 | 已合併 | #439（同上） |
| WP-09 | 銷講／課程主題模板 | 已合併 | #442 `afeff7e3`（WP-09） |
| WP-10 | platform_admin 未註冊 MFA 禁止進 `/admin/*` | **未見**（tag 有 15 個 evidence 檔，Codex 記錄為完成） | auth 類，合併前須 `reviewer` |
| WP-11 | 統一 IP 解析／magic link 兩段式／補限流 | **未見**（tag 有 603 個 evidence 檔，Codex 記錄為完成） | security／auth，合併前須 `reviewer` |
| WP-12 | 電子發票：明示尚未提供 | 已合併 | #433 `fc6b16f2`（WP-12，採「對外說明尚不可用」而非實作 adapter） |
| WP-13 | 報名→LINE 綁定→開播提醒 | **未見** | 需 LINE provider；#431 的四渠道通知是相關但範圍不同（推測不算 WP-13） |
| WP-14 | 報名後即時 LINE／行事曆提醒與 A/B | **未見** | 同上，需 LINE provider |
| WP-15 | 新商家首屏簡化、行動導覽 | 已合併 | #439（同上） |
| WP-16 | 拆分 `actions.ts`、layout 查詢合併 | **未見**（tag 無任何 WP-16 evidence，推測從未開工） | 大型重構，`engineer-hard` |
| WP-17 | 一場即上線 | **未見**（tag 有 55 檔進行中 evidence） | memory 記載 `one-stop-webinar-flow` 已被 master 取代，WP-17 範圍需重新定義 |
| WP-18 | 結帳未完成 trigger＋3 套追銷範本 | **未見**（tag 有 128 檔進行中 evidence） | 觸及 payment 事件，須 `reviewer` |
| WP-19 | SMS adapter 或明示僅 Email＋LINE | **未見**（推測）（tag 有 52 檔；Codex 記錄為完成） | #431 `e9d98995` learner notifications on four channels 與其主題相關但標題不含 WP 編號，無法確認等同 |
| WP-20 | 場次分析（報名率、到場率、完看率…） | **未見**（tag 有 1,610 個 evidence、10 個 live_metric migration；Codex 記錄為完成） | 最大的一包，未進 master；涉及 schema，須 `engineer-hard` ＋ `reviewer` |

統計：標題可驗證已合併 **10**（01、02、03、05、06、07、08、09、12、15）；Codex 自記完成但 master 未見 **4**（10、11、19、20）；Codex 自記未完成且 master 未見 **6**（04、13、14、16、17、18）。與 handoff 的「14/20」一致，**14 − 10 = 4 個「已做未合」是最大的遺漏風險**，其中 WP-10、WP-11 是安全修補，合併優先序應高於 UX 類。

---

## 5. 文件治理建議

### 5.1 目標結構

```
docs/                              ← 只放「現在要讀」與「操作程序」，目標 < 60 個檔案、< 3 MB
  README.md                        （新）索引：一頁說完去哪找什麼
  DOCUMENT_AUTHORITY.md            （改寫，附錄 A）
  domain-workflows.md              （保留）
  decisions/                       ADR 與 owner 決策（取代 DECISIONS_NEEDED.md 的分散狀況）
  reference/                       契約型文件
    API_CONTRACT_REGISTRY.md       （自 codex-goal/ 移入需同步 scripts/api-contract-registry.test.ts）
    PRISMA_INVARIANTS.md           （同上，並更新 AGENTS.md 與 prisma-invariant-inventory.test.ts）
  runbooks/                        production-*、staging-*、payuni-*、password-reset、admin-mfa、cloudflare、operations/*
  launch/                          CURRENT.md、NEXT-CYCLE.md、local-database-development.md、被測試釘住的契約 JSON
  research/                        market-2026Q4/、bombmy_analysis/、codex_review/（P 類）
  review-2026Q4/                   本輪 review 產出（Goal 結束後 → reports/archive/）
reports/
  archive/2026/                    （新，受版控，不加入 .gitignore）
    ai-team-evidence/              ← docs/ai-team/evidence/*（1,376）
    branch-integration/            ← 91
    remaining-capabilities/        ← 257
    launch-receipts/               ← docs/launch 的 35 個歷史檔
    codex-goal-snapshots/          ← 10 份 07～08 月狀態快照
    readiness-audits/              ← 根目錄 10 份單日報告
  quality/、lighthouse/、…         維持 gitignore（暫存輸出）
```

原則：
1. **一種現況來源**：只有 `docs/launch/CURRENT.md`（staging／readiness）與 `AGENTS.md`＋`domain-workflows.md`（規則）。其餘一律是參考或歷史。
2. **收據不進 `docs/`**：新的一次性證據（CI run 連結、Sandbox 收據、QA 報告）寫到 PR 描述或 `reports/archive/<年>/`；只有「契約型」文件（會被測試讀的）留在 `docs/`。
3. **每份保留文件頁首必有 `最後驗證日期` 與 `驗證基準 commit`**；超過 60 天未驗證的 runbook 在索引標「待驗證」。
4. **封存不等於刪除**：先打 tag `archive/docs-2026Q4`（包含全部 1,885 個檔案），再 `git mv`；PNG 截圖（518＋40 張）在 tag 保存後可從 working tree 移除。

### 5.2 執行順序與風險

| 步驟 | 內容 | 風險 | 建議 owner |
|---|---|---|---|
| 1 | 建立 tag `archive/docs-2026Q4`；`docs/README.md` 索引；改寫 `DOCUMENT_AUTHORITY.md`；修 `README.md` 死連結；`CURRENT.md`／`NEXT-CYCLE.md`／handoff 加「已過期」頁首或重寫 | 低（純文件） | `docs` agent ＋ 主對話審 |
| 2 | 處理 §2.2 #6（虛擬使用者）：owner 裁示後，同一個 PR 修改 `PRODUCT.md` 與 `domain-workflows.md`，並在 `docs/decisions/` 加 ADR（律師審閱前置條件） | 中（產品規則） | 主對話＋owner |
| 3 | 逐一替釘住的文件改引用（10 個 `scripts/*.test.*` 讀取 `docs/launch`／`docs/codex-goal`，35 個 scripts 寫入或引用 `docs/ai-team/evidence`），改完才搬 | 中（會動測試） | `engineer`（無金流邏輯） |
| 4 | 整批 `git mv` 到 `reports/archive/2026/…`；單獨一個 PR，`quality` CI 必須通過 | 低～中 | `engineer` |
| 5 | 刪除候選（PNG、`wp7`、`wp6`、本機 gitignore 檔）另開 PR | 低，但不可逆（靠 tag 還原） | 主對話，owner 同意 |
| 6 | 把「現況」維護變成週期任務：每次合併 staging 更新 `CURRENT.md` 的來源 commit 與 run 連結 | — | 主對話 |

**時程建議**：步驟 1、2 在 2026-11-01 封測前完成（資訊正確性）；步驟 3～5 排在封測之後，避免封測期間大量搬動引入非預期的 CI 或連結問題。

### 5.3 需要 owner 決定的事項

1. 虛擬使用者規則（§2.2 #6）：以 2026-10-18 決策為準，並同步 `domain-workflows.md`？
2. 是否同意封存／刪除 518 張 evidence PNG 與 25＋15 張研究截圖（tag 保存，repo 瘦身約 50 MB 以上）？
3. 分支前綴：沿用 `codex/*` 或改 `claude/*`？
4. 4 個「Codex 已做未合」WP（10、11、19、20）是否要重做並合併（建議 WP-10、11 優先，因屬安全項）？

---

## 附錄 A　`DOCUMENT_AUTHORITY.md` 新版草稿

> 以下為草稿，**未寫入原檔**。核准後以單一 PR 取代 `docs/DOCUMENT_AUTHORITY.md`。

````markdown
# CelebrateDeal 文件權威地圖

最後驗證：2026-10-19　驗證基準：`origin/master` `78621ca3`
維護者：主對話（Claude Code）。本檔只描述「哪份文件說了算」，不記錄任何進度或分數。

## 1. 先讀什麼（依用途）

| 我想知道 | 讀這份 | 它說了算的範圍 |
|---|---|---|
| 我可以做什麼、不可以做什麼 | `AGENTS.md` | 安全底線、分支與合併規則、驗證要求 |
| 怎麼分工、用哪個 agent | `CLAUDE.md` | 主對話與 `engineer-hard`／`engineer`／`reviewer`／`docs` 的分工 |
| 付款、佣金、租戶、瀏覽器 QA、設計的領域規則 | `docs/domain-workflows.md`（六個 `celebratedeal-*` skill 皆指向它） | 領域契約與驗收條件 |
| 產品定位與不可踩的線 | `PRODUCT.md` | 使用者、品牌、反參考、設計原則、無障礙 |
| staging 現在是什麼狀態 | `docs/launch/CURRENT.md` | 部署來源、每項驗收的 PASS／BLOCKED 與 run 連結 |
| 接下來做什麼 | `docs/launch/NEXT-CYCLE.md` | 下一輪工作與外部相依 |
| API 與資料庫的現行契約 | `docs/reference/API_CONTRACT_REGISTRY.md`、`PRISMA_INVARIANTS.md` | 由測試檢查；以測試為準，不以文件內的數字為準 |
| 怎麼安全操作 | `docs/runbooks/*`、`docs/operations/*` | 程序；存在不等於演練通過 |
| 為什麼這樣決定 | `docs/decisions/*` | ADR 與 owner 決策，依日期，後者覆蓋前者 |

衝突時的優先序：owner 在對話中的明確指示 > `AGENTS.md` > `CLAUDE.md` > `docs/domain-workflows.md` > `PRODUCT.md` > 其餘。發現衝突時不要自行選邊，記錄在 `docs/decisions/` 並詢問 owner。

## 2. 文件類別

| 類別 | 位置 | 可否當成「目前已通過」的證據 |
|---|---|---|
| Canonical current | 上表所列 | `CURRENT.md` 的 PASS 只對其標明的來源 commit 有效 |
| Runbook | `docs/runbooks/`、`docs/operations/`、`docs/launch/*runner*.md` | 否；需附演練收據才算 |
| 研究 | `docs/research/` | 否；進入產品需求前需轉成 ADR 或 PR |
| 歷史證據與收據 | `reports/archive/<年>/` | 只證明當日當 commit，不可推論現況 |

## 3. 更新規則

1. 每份 canonical 與 runbook 頁首必須有 `最後驗證日期` 與 `驗證基準 commit`；超過 60 天未驗證，索引標示「待驗證」。
2. 合併會改變 staging 現況的 PR 後，更新 `CURRENT.md`：來源 commit、受保護 run 連結、PASS／BLOCKED。沒有收據的項目寫「未驗證」，不沿用舊結論。
3. 一次性證據（CI run、Sandbox 收據、QA 報告）寫進 PR 描述；需要長期保存的放 `reports/archive/<年>/`，**不要放進 `docs/`**，也不要放在被 `.gitignore` 排除的目錄。
4. 新增 Prisma model 或 migration 時同步登記 `PRISMA_INVARIANTS.md`；新增或變更 route 時同步登記 `API_CONTRACT_REGISTRY.md`（測試會檢查）。
5. 不在任何文件記錄分數或「完成百分比」作為現況；readiness 以 `CURRENT.md` 的逐項 PASS／BLOCKED 為準。
6. 規則改動只改一處：流程在 `AGENTS.md`、分工在 `CLAUDE.md`、領域在 `domain-workflows.md`；skill 只放指向錨點的入口，不複製規則。
7. 搬移或封存文件前，先 `grep` `scripts/`、`tests/`、`.github/` 與 `README.md` 的引用並一併更新。

## 4. 已知容易誤讀的舊敘述

- 2026-07 至 2026-09 的 readiness 分數（75.5、68.65）與「51 models／9 migrations」是歷史數字；現行以 `git`／測試為準。
- 提到 `.ai-team`、`ai-team-router`、Luna／Sol／Astra、`gpt-5.x` 的流程已於 #428 移除，僅供歷史參考。
- 「External Required」代表需要外部證據，不代表失敗或通過。
- 「env 名稱存在」「Dashboard 分頁存在」「有 runbook」均不可當成外部 Gate 通過。
- 競品分析中的功能缺口先進 `docs/decisions/`，不得直接升格成 defect。
````

## 附錄 B　`CURRENT.md` 應補的最小欄位（供改寫參考）

1. 驗證基準：master commit、staging 實際部署來源 commit（以受保護 runner 收據為證，而非口述）。
2. 逐項表：固定 alias、Dashboard／商品／方案旅程、Funnel（含 #440 後的新判定條件）、R2、Stream、PayUni Sandbox 訂單閉環、綁卡（含 #444 後狀態）、通知四渠道（#431）、Meta tracking（#424，預設關閉）、政策頁（#435，待 owner 簽核）。
3. 每列：PASS／FAIL／BLOCKED／未驗證；證據連結；對應來源 commit；驗證日期。
4. 刪除所有「AI Team Pro／Luna／Sol／Astra」交接段落。
