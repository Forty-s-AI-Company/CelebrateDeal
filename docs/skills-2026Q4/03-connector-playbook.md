# 03 Connector 與 MCP 使用方針（D-04）

- 基線：`review-baseline-2026Q4` = `origin/master@78621ca3`；日期 2026-10-19（Asia/Taipei）
- 方式：只做唯讀探測；每一次呼叫都列在 §8。**沒有**呼叫任何寫入工具、沒有讀取環境變數的值、沒有呼叫 Supabase 與 Spaceship 的任何工具。
- 輸入：本 session 的 `session_connectors_status`、Goal Plan §6.1／§9（Q6b、Q6c）、B-09 `19-observability-ci-supply-chain.md`、`gh api` 唯讀結果。
- 用途：讓後續的審查、修復與封測維運，知道每個外部能力「能拿來做什麼、不能做什麼、哪裡要 owner 點頭」。

## 0. 結論先講

1. **Goal Plan §6.1 寫「Supabase MCP 未授權」只對了一半。** 本 session 有兩個 Supabase 入口：`plugin:supabase:supabase` 確實是 `needs_auth`；但 claude.ai connector「Supabase」（id `f5a39e15…`）狀態是 **connected，29 個工具**，其中包含 `execute_sql`、`apply_migration`、`deploy_edge_function`、`reset_branch`、`pause_project`、`restore_project`、`create_project` 等寫入工具。Q6c 的決定（「不要求授權」）不再等於「不能用」：能力已經在，所以需要的是**白名單政策**，而不是等待授權。我沒有呼叫它（不知道它連到哪個專案），§3 把規則寫死。
2. **Vercel MCP 只通一半。** `list_projects` 成功（回傳 15 個專案，與 CelebrateDeal 無關的有 12 個，同一個 Vercel team 內還有個人其他專案，所以任何 Vercel 呼叫都必須指定 `projectId`）；但 `list_deployments` 與 `get_runtime_errors` 對 `celebrate-deal-staging` 回 **403**（scope `a25814740s-projects` 未授權）。同一件事改用本機 `vercel` CLI（已登入）成功。依「同一根因失敗兩次就停」的規則，我沒有再重試 MCP。**因此 B09 提到的「用 Vercel MCP 自動抓 runtime errors 取代人工收據」目前做不到，要靠 CLI 或由 owner 重新授權 MCP scope。**
3. **GitHub 是目前最完整的能力**，但有 3 個缺口：沒有 `project` scope（Projects v2 不可用）、沒有 `workflow` scope、repo 的 `allow_auto_merge` 是 false（Claude Code 的 `set_auto_merge` 不會生效）。
4. **沒有 Cloudflare、Sentry 的 connector。** MCP registry 有 Cloudflare Developer Platform（`bindings.mcp.cloudflare.com`）與 Sentry（`mcp.sentry.dev`），皆 `connected: false`。連線需要 owner 做 OAuth。是否連線的建議在 §6。
5. **staging 在 2026-11-01 之後不再是拋棄式環境。** `AGENTS.md` 允許直接對 staging 做開發驗證，這在封測前成立；封測開始後 staging 會有真實的人輸入的資料。`vercel.staging.json` 的 `buildCommand` 內含 `db:migrate:deploy`，**每次 staging 部署都會對 staging 資料庫套用 migration**。因此封測期間：任何帶 migration 的 PR 合併前要先確認備份、並通知 owner。本文件所有「staging 可做」的項目，都以此為前提做了封測前／封測中的區分。

## 1. 能力總覽

狀態來源：`mcp__ccd_connectors__session_connectors_status`（2026-10-19）。

| 能力 | 狀態 | 工具數 | 與本專案的相關度 | 本文章節 |
|---|---|---|---|---|
| Vercel（claude.ai connector） | connected，但 deployments／runtime errors 讀取 403 | 237 | 高：staging／production 專案、部署、錯誤、環境變數名稱 | §2 |
| Supabase（claude.ai connector `f5a39e15…`） | **connected** | 29 | 高：RLS、advisors、logs、migration 對照 | §3 |
| Supabase（`plugin:supabase:supabase`） | needs_auth | — | 同上；與上列重複，不需要授權 | §3 |
| GitHub CLI（`gh`，帳號 `a25814740`，SSH） | 已登入；scope `repo`、`read:org`、`gist`、`admin:public_key` | — | 高：PR、CI、設定、Issues | §4 |
| `ccd_pr` 監控（`bind_pr`、`get_status`、`set_monitor`、`set_auto_merge`、`unbind_pr`） | 可用（尚未綁定 PR） | 5 | 高：PR 開出後看 CI，不必輪詢 | §5 |
| `claude-code-remote`（含 `subscribe_pr_activity`、`create_trigger`） | connected | 27 | 中：PR 事件推送、排程 | §5 |
| `scheduled-tasks` | connected | 6 | 中：封測每日例行 | §5 |
| Vercel CLI 58.4.4（已登入 `a25814740`） | 可用 | — | 高：MCP 403 時的替代 | §2 |
| Claude Docs、visualize | connected | 8／2 | 低～中：私人文件、圖表 | §7 |
| Spaceship（網域、DNS） | connected | 12 | 低：含 DNS 寫入與網域購買 | §7 |
| Claude in Chrome、Browser pane | 可用 | — | 中：本機頁面 QA；staging 登入受限 | §7 |
| Cloudflare MCP（registry） | 未連線 | — | 中：B-09 的 Stream 隔離驗證 | §6 |
| Sentry MCP（registry） | 未連線 | — | 高：封測 bug triage、B09-04 | §6 |

## 2. Vercel

### 2.1 專案與環境事實

- team 內有 `celebrate-deal`（production 專案）、`celebrate-deal-staging`（staging 專案）、一個名為 `celebrate-deal-staging-deploy-<hex>` 的殘留專案（疑為某個 workflow 建立的暫存專案，建議列入 B-10 清理），以及 12 個與本專案無關的專案（`resume`、`inboxpilot` 等）。**結論：永遠帶 `projectId`，禁止「列出全部再逐一操作」。**
- `vercel list celebrate-deal-staging`（CLI）顯示最近 9 筆部署皆 Ready、環境為 **Preview**（staging 專案以 Preview 類型部署），最新的在 5 小時前。部署與 master 提交的對應沒有逐筆核對（CLI 輸出沒有 SHA），要核對需 `get_deployment`（MCP 目前 403）或 `vercel inspect`（本次未執行）。
- `vercel.json`（production）設 `git.deploymentEnabled.master: false`：master 合併**不會**自動部署 production。`vercel.staging.json` 的 `crons` 為空陣列（B09-01 的排程缺口在此再次可見）。

### 2.2 可用於審查與維運的動作（唯讀）

| 動作 | 工具（MCP） | CLI 替代 | 用途／對應 finding |
|---|---|---|---|
| 列專案與設定 | `list_projects`、`get_project` | `vercel project ls` | B06-03：核對 function 區域與 Supabase Tokyo 是否同區；B05-12：Skew Protection |
| 部署清單與狀態 | `list_deployments`、`get_deployment` | `vercel list <project>` | 取代人工「staging 現在跑哪個 commit」收據；RC 凍結前核對 |
| 建置紀錄 | `list_deployment_events` | `vercel logs <deployment>` | 部署失敗診斷 |
| Runtime 錯誤 | `get_runtime_errors`（先用）→ `get_runtime_logs` | `vercel logs --project` | 封測每日上午檢查；B09-02～04 驗證排程與告警 |
| 排程是否真的被呼叫 | `get_runtime_logs` 依路徑過濾 `/api/jobs/*`、`/api/cron/*` | 同上 | B09-01：證明「沒有人呼叫」或修復後「有被呼叫」 |
| 環境變數**名稱** | `filter_project_envs` | `vercel env ls` | B02-05／B04-03：確認 `RATE_LIMIT_PROVIDER`、`JOB_SECRET`、`CSRF_SECRET` 是否各環境獨立（只看名稱與所屬環境，不要求值） |
| 防火牆與攻擊狀態 | `get_firewall_config`、`get_active_attack_status` | — | B01-04：速率限制是否依賴 Cloudflare |
| 網域與別名 | `list_project_domains`、`list_aliases`、`get_domain_config` | `vercel domains ls` | B01-04：正式網域是否經 Cloudflare 代理 |
| 觀測查詢 | `get_observability_schema`、`create_observability_query` | — | 成本／請求量的量測（B-06 的假設驗證） |
| 文件 | `search_vercel_documentation` | — | 查平台行為 |

### 2.3 禁止與需 owner 授權

| 等級 | 動作 | 工具 | 規則 |
|---|---|---|---|
| **禁止**（任何階段） | 解密或印出環境變數的值 | `get_project_env`、`get_shared_env_var`（可能回傳值）、`vercel env pull` | 違反「不讀取、輸出或傳送 secret」。`env pull` 會把值寫成 `.env*`。需要確認某變數存在時只用名稱列表 |
| **禁止** | 任何 Production 寫入 | `create_deployment`（target production）、`request_promote`、`request_rollback`、`assign_alias`、`start_rolling_release`、`complete_rolling_release`、`pause_project`、`unpause_project` | 需 owner 另外明確授權 |
| **禁止** | 設定與金鑰變更 | `create_project_env`、`edit_project_env`、`update_project`、`update_project_protection_bypass`、`patch_url_protection_bypass`、`create_kms_*`、`issue_cert` | 需 owner 明確授權；環境變數寫入同時是「持久設定」 |
| **禁止** | 防火牆／網域／DNS／購買 | `put_firewall_config`、`update_firewall_config`、`update_attack_challenge_mode`、`buy_domain`、`create_or_transfer_domain`、`add_project_domain`、`replace_domain_dns_records`、`create_record`、`update_record` | 影響流量與費用，需 owner |
| **禁止** | 資料外送與沙箱 | `create_drain`、`update_drain`、`create_sandboxes_*`、`run_session_command`、`write_session_files`、`upload_file`、`upload_artifact` | 會把 log／檔案送到外部或執行任意指令 |
| **需確認** | staging 寫入 | 對 `celebrate-deal-staging` 的 `cancel_deployment`、`create_deployment`、`invalidate_by_tags` | 封測前可在 AGENTS 許可範圍內做；封測開始後先通知 owner。優先使用 repo 內既有 workflow（`staging-*.yml`），因為會留下可稽核的 run 紀錄 |
| **需確認** | 受保護預覽的存取 | `get_access_to_vercel_url`、`web_fetch_vercel_url` | 只對 staging 預覽網址；回應若含使用者資料，不寫進任何檔案 |

### 2.4 修好 MCP 的 403

這是 owner／帳號動作，不是程式問題：MCP 回報「You must re-authenticate to this scope or use a token with access to this scope」。需要 owner 在 claude.ai 的 connector 設定重新授權 Vercel，並確認授權的 team 是 `a25814740s-projects`。在此之前，所有 Vercel 唯讀檢查走 CLI：

```bash
# 以下皆為唯讀；必須帶 --scope 與專案名稱
vercel --scope a25814740s-projects list celebrate-deal-staging
vercel --scope a25814740s-projects logs --project celebrate-deal-staging   # runtime logs（輸出可能含個資，不要貼進文件）
vercel --scope a25814740s-projects env ls                                   # 僅變數名稱
```

注意：`vercel logs` 的輸出在封測期間可能含真實客戶的請求資訊；只把「路由、狀態碼、錯誤類型、次數」摘進 Issue，不貼原始 log。

## 3. Supabase

### 3.1 事實與風險

- 已連線的 claude.ai connector 有 29 個工具，寫入面很大（見 §3.3）。我不知道它連到哪些 Supabase 專案，也不知道 staging／production 各是哪個；B-02／B-04 都註明「沒有連任何 Supabase 專案」。
- 專案使用 **Prisma** 管理 schema（`prisma/migrations`、`db:migrate:deploy`）。Supabase 的 `apply_migration` 會寫入 Supabase 自己的 migration 紀錄，**繞過 Prisma 歷史**，直接製造 B04-04 要擋的「schema 與 migration 漂移」。因此 `apply_migration` 對本專案是永久禁止，不是「需授權」。
- 封測開始後，staging 資料庫會有真實客戶資料。`execute_sql` 與 `query_logs` 都可能讀到個資。

### 3.2 可用於審查與維運的動作（唯讀白名單）

先決條件：用 `list_projects` 取得專案**名稱清單**（不要輸出 URL 或金鑰），請 owner 確認哪一個是 staging，再把該專案 ID 寫進 `STATE.md` 的備註；之後的呼叫只對這個 ID。

| 動作 | 工具 | 用途／對應 finding | 封測期間 |
|---|---|---|---|
| 專案資訊（區域、狀態） | `get_project` | B06-03：區域與 Vercel function 區域是否同為東京 | 可 |
| 安全 advisors | `get_advisors`（type: security） | B02-03、B04-08：直接列出 RLS 未啟用的表與缺失的政策；比靜態 grep 更接近實況 | 可 |
| 效能 advisors | `get_advisors`（type: performance） | B04-18：缺索引、重複索引、未使用索引 | 可 |
| 表結構與 RLS 旗標 | `list_tables` | 驗證 148 張表中 77 張未啟用 RLS 的結論 | 可（只含結構） |
| 擴充套件 | `list_extensions` | 確認 `pg_cron` 是否可用（B09-01 排程方案之一） | 可 |
| migration 紀錄 | `list_migrations` | 注意：Prisma 不寫此表，預期為空；真正的 Prisma 歷史在 `_prisma_migrations` | 可 |
| 日誌 | `query_logs`（api／postgres／auth 等服務） | 封測 triage 輔助；B09-03 | **僅在 S0／S1 事件、且只看錯誤層級；結果不得貼進 repo** |
| 文件查詢 | `search_docs` | 查 RLS／pooler 行為 | 可 |
| 讀取資料 | `execute_sql` | 僅允許 `pg_catalog`／`information_schema`／`_prisma_migrations` 這類**中繼資料查詢**，且只對確認為 staging 的專案；例：核對 `relrowsecurity`、`has_table_privilege('anon', …)`、`select migration_name from _prisma_migrations order by finished_at desc limit 20` | 封測前可；封測開始後只允許中繼資料，禁止查業務表 |

建議的 RLS 實況核對（只讀；範例，需在 staging 專案、確認專案 ID 後才可執行，本任務**未執行**）：

```sql
-- 未啟用 RLS 的 public 表
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1;

-- anon／authenticated 對 public 表的權限
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
order by 1, 2, 3;
```

### 3.3 禁止與需 owner 授權

| 等級 | 工具 | 規則 |
|---|---|---|
| **永久禁止** | `apply_migration` | 繞過 Prisma 歷史；schema 變更只走 `prisma/migrations` 與既有 staging migrate workflow |
| **禁止** | `execute_sql` 的任何寫入（INSERT／UPDATE／DELETE／DDL／GRANT／REVOKE／`CREATE POLICY`） | RLS 與 GRANT 的修正要寫成 forward migration（見 B02-03 建議），經 PR 與 reviewer 落地，不直接在遠端執行 |
| **禁止** | `deploy_edge_function`、`create_branch`、`merge_branch`、`rebase_branch`、`reset_branch`、`delete_branch` | 本專案沒有使用 Supabase 分支與 Edge Function；`reset_branch`／`delete_branch` 具破壞性 |
| **禁止** | `create_project`、`confirm_cost`、`pause_project`、`restore_project` | 會花錢或中斷服務，需 owner |
| **禁止輸出** | `get_publishable_keys`、`get_project_url` 的結果寫入文件或 PR | 雖屬公開金鑰，仍不進 repo 與回報；用名稱描述 |
| **需 owner 確認** | 對 **Production** 專案的任何呼叫（含唯讀） | Production 狀態在 B-04 為「未評定」；先由 owner 指定專案與允許範圍 |

### 3.4 與 Q6c 決定的關係

Goal Plan Q6c 決定「不要求授權」是因為當時以為尚未連線。現況是 connector 已連線，所以：

1. B-02／B-04 標為「需驗證」的資料庫層項目（B02-03 GRANT／RLS 實況、B04-08 `anon` 權限）現在**可以**用 §3.2 的唯讀白名單驗證，不需要新的授權，只需要 owner 指認 staging 專案。
2. 這是 B02-03 從「MINOR（需驗證）」升級或結案的最快途徑（B04-08 已註明：若查到 anon 或 authenticated 有 grant，立即升為 BLOCKER）。
3. 驗證結果只寫「表名、旗標、數量」，不寫連線字串。

## 4. GitHub CLI

### 4.1 已確認的設定（唯讀 `gh api`）

| 項目 | 觀察 | 影響 |
|---|---|---|
| 帳號與 scope | `a25814740`；`repo`、`read:org`、`gist`、`admin:public_key`；git 協定 SSH | 沒有 `project`、`workflow`（透過 SSH 推送 workflow 檔案的限制未實測） |
| `master` 保護 | required check `quality`（strict）、`enforce_admins: true`、禁止 force push、必要 review 數 0 | 合併條件只有 CI |
| repo | public；允許 squash／merge／rebase；`allow_auto_merge: false`；`delete_branch_on_merge: false` | 見 01 §1.2 |
| Environments | `Preview – celebrate-deal`、`Preview – celebrate-deal-staging`、`Production` | B09-14 |
| Workflows | 25 個檔案，24 個含 `workflow_dispatch` | 見 §4.3 |

### 4.2 動作分級

| 等級 | 動作 | 說明 |
|---|---|---|
| 自動 | `gh pr list／view／diff／checks`、`gh issue list／view`、`gh run list／view`、`gh api`（GET）、`gh repo view` | 審查與狀態查詢 |
| 自動（主對話） | `gh pr create`、`gh issue create`、`gh pr comment`（作者自己的 PR 的狀態說明） | 依 CLAUDE.md，推送與開 PR 由主對話負責 |
| 需確認 | `gh pr review --comment`／`code-review --comment`（公開留言）、`gh issue create` 內含任何客戶相關描述 | 公開內容；客戶資料一律不可 |
| 需 owner | `gh pr merge`（H 類 PR）；一般 E／D 類在 CI 綠且審查完成後由主對話合併，H 類先把審查摘要交 owner（#436 已有此先例） | 與 `T3` 一致 |
| 需 owner | repo 設定變更：只允許 squash、`delete_branch_on_merge`、`allow_auto_merge`、secret scanning、push protection（B09-15）、fork PR 核准政策（B09-10）、environment 保護規則（B09-14）、branch protection 調整 | 屬系統／安全設定 |
| 需 owner | 刪除遠端分支（B-10 提案的 branch cleanup） | 不可逆 |
| **禁止** | `gh secret set`、`gh variable set`、`gh workflow run payuni-live-probe.yml`、`git push --force`、直推 `master` | live probe 檔頭寫明「dispatch requires separate authorization」，會觸發真實付款 |

### 4.3 Workflow 派發規則

- 封測前：`staging-*`（browser smoke、funnel smoke、R2 image smoke、stream resource smoke、provider readonly probe、backup recovery）屬 staging 驗證，AGENTS 允許；每次派發前確認該 workflow 使用的 environment 是 `Preview – celebrate-deal-staging`（例如 `payuni-live-probe.yml` 也掛這個 environment，**所以光看 environment 名稱不足以判斷是否安全，必須讀 workflow 內容**）。
- 會改 staging 資料的：`staging-migrate.yml`、`staging-migration-apply.yml`、`staging-qa-finance-bootstrap.yml`、`staging-issued-trade-recovery.yml`、`q1-*` 系列。封測開始後都要先通知 owner 並確認備份。
- 永遠需要 owner 授權：`payuni-live-probe.yml`（真實金流）。

### 4.4 建議的 owner 設定（附指令；本任務未執行）

```bash
# 只允許 squash、合併後刪分支、關閉 merge commit 與 rebase
gh api -X PATCH repos/Forty-s-AI-Company/CelebrateDeal \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true

# 查看 secret scanning 與 push protection 現況（唯讀）
gh api repos/Forty-s-AI-Company/CelebrateDeal --jq '.security_and_analysis'
```

## 5. PR 監控與排程

| 工具 | 用法 | 規則 |
|---|---|---|
| `ccd_pr.bind_pr`／`get_status` | `gh pr create` 後綁定該 PR，用 `get_status` 看 CI 檢查數、失敗檢查名、review 決策、可否合併 | 取代輪詢 `gh pr checks`；每個修復 PR 開出後立即綁定 |
| `ccd_pr.set_monitor` | 開啟 CI 監控 | 建議開 |
| `ccd_pr` 的 `auto_fix` | 讓 CI 失敗時自動修 | **H 類 PR 關閉**：自動修會在未經 reviewer 的情況下改動付款／授權程式碼；E 類可開，且仍須人工看 diff |
| `ccd_pr.set_auto_merge` | 自動合併 | **不用**：repo 的 `allow_auto_merge` 為 false，且 H 類需 owner 確認 |
| `claude-code-remote.subscribe_pr_activity` | 讓 PR 的留言、review、CI 事件推進本 session | 適合 #436 這種等 owner 與等 CI 的 PR；PR 合併後 `unsubscribe_pr_activity` |
| `scheduled-tasks`／`schedule`／`loop` | 封測每日例行檢查（見 02 §4.5） | 持久設定，需 owner 同意；內容限唯讀 |

## 6. 尚未連線但建議評估的 connector

| 候選 | 價值 | 風險／限制 | 建議 |
|---|---|---|---|
| Sentry（`mcp.sentry.dev`，registry） | 封測 triage 的主要資料源：`find_issues`、`get_issue_details`；可直接驗證 B09-04（PII scrubbing 缺口）與 B06-12（取樣率） | 錯誤內容可能含個資；需 OAuth | **建議連線**（封測前）。規則：只讀 issue 摘要，不把 event payload 貼進 repo |
| Cloudflare Developer Platform（registry） | Q6b／B-09 的 Stream 隔離判定、Stream library 內是否有非合成資源 | 工具含 KV／Workers 的寫入；工具清單未完整顯示（16 個被省略）；需 OAuth | 暫不連線。Q6b 的決定是「由受控 runner 以不輸出 token 的名稱級探測處理」，沿用；若 owner 要更快，再評估唯讀 scope |
| GitHub Projects | 看板 | 無 `project` scope | 不需要，見 02 §2 |

## 7. 其他已連線但低相關

- **Spaceship**（12 個工具）：含 `dns_records_save`、`dns_records_delete`、`domain_set_nameservers`、`domain_purchase_link`。唯讀的 `domains_list`、`dns_records_get` 可用於核對正式網域 DNS（B01-04）；任何 DNS／網域寫入都是 Production 變更，需 owner。
- **Claude Docs**：若 owner 同意，可作為**私人**的封測 triage 記錄（因為 repo 與 `docs/` 是公開的）。建立文件需要 owner 明確要求。
- **Claude in Chrome／Browser pane**：可做本機開發頁面 QA。依安全規則，代理不得在 staging 等非本機頁面輸入密碼登入，所以 staging 的登入流程只用既有 Playwright 受控 runner（使用 workflow secret），或由 owner 手動操作。
- **visualize**：圖表，與本 Goal 無關。

## 8. 本任務實際呼叫紀錄

| # | 呼叫 | 類型 | 結果 |
|---|---|---|---|
| 1 | `session_connectors_status` | 唯讀 | 8 個 server，狀態如 §1 |
| 2 | `gh auth status`（token 已遮蔽） | 唯讀 | 已登入；scope 如 §4.1 |
| 3 | `gh api repos/{owner}/{repo}/branches/master/protection`、`…/environments`、`…/{repo}`（欄位過濾） | 唯讀 | 如 §4.1 |
| 4 | `gh pr list --state open`、`gh pr view 428` | 唯讀 | 僅 #436 開啟；#428 已合併 |
| 5 | `search_mcp_registry`（cloudflare、sentry） | 唯讀 | 皆未連線 |
| 6 | Vercel `list_projects`（limit 20） | 唯讀 | 15 個專案（僅記錄名稱） |
| 7 | Vercel `list_deployments`（staging，limit 3） | 唯讀 | **403**，未重試 |
| 8 | Vercel `get_runtime_errors`（staging，7d） | 唯讀 | **403**，未重試 |
| 9 | `vercel --version`、`vercel whoami`、`vercel --scope a25814740s-projects list celebrate-deal-staging` | 唯讀 | 成功；9 筆 Ready |
| 10 | 讀 `.github/workflows/payuni-live-probe.yml` 前 40 行、`vercel.json`、`vercel.staging.json` | 唯讀 | 如 §2.1、§4.2 |
| — | 未執行：Supabase 任何工具、Spaceship 任何工具、`vercel inspect`、`vercel logs`、任何寫入 | — | — |

## 9. 給 ROADMAP 的三句結論

1. Supabase connector 已經連線且含寫入工具，必須以「唯讀白名單＋`apply_migration` 永久禁止」的政策管起來；有了政策之後，B02-03／B04-08 的 RLS／GRANT 實況可以在封測前用 `get_advisors` 與中繼資料查詢結案，只需要 owner 指認哪個專案是 staging。
2. Vercel MCP 的 deployments 與 runtime errors 目前對 staging 專案 403，需要 owner 重新授權 scope；在那之前用已登入的 `vercel` CLI 做唯讀檢查，封測每日例行才有資料來源。
3. 封測開始後 staging 不再是拋棄式環境，而且每次 staging 部署都會自動套用 migration；所有「staging 可直接操作」的許可，到 11-01 起要改為「先通知 owner、先確認備份」。
