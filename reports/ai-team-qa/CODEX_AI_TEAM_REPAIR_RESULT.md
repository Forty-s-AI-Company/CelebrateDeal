# Codex AI Team Repair Result

更新日期：2026-07-11

## 輸入對照

要求中的 `AI_TEAM_QA_REPORT.md`、`ai-team-issues.json` 與 `CODEX_AI_TEAM_REPAIR_PROMPT.md` 在執行時並不存在。本輪沒有偽造這三個輸入，改以同目錄的等價稽核鏈執行：

- `FINAL_DELIVERY.md`：總結與內嵌 Codex repair prompt。
- `ROLE_ROUTING_TEST.md`：P1 動態角色路由缺陷。
- `SECURITY_AUDIT.md`、`PIPELINE_GUARDRAILS_TEST.md`、`ADAPTER_AND_IMPORTER_TEST.md`。
- `CLI_VERIFICATION.md`、`HANDOFF_SMOKE_TEST.md`、`AI_TEAM_CURRENT_STATE.md`、`ROLE_COVERAGE_MATRIX.md`。
- `boundary_qa.json`：只作 importer 對抗 fixture，不是可信任 P0 issue。

## 修復矩陣

| 等級 | 問題 | 修復 | Regression evidence |
| --- | --- | --- | --- |
| P1 | 任務只路由單一角色，專項 reviewer/QA 不會進 DAG | 新增 domain-aware role DAG；支援 UI、API、RLS/RBAC、歸因、佣金、複合任務；未知 type fail closed | `test_routing.py`、`test_orchestrator.py` |
| P1 | Pipeline 只有規劃，缺乏可信 stage 完成證據 | 新增 schema v2 state、CAS revision、stage receipt、artifact SHA-256、依賴與失敗阻斷 | `test_pipeline_engine.py` |
| P1 | Release gate 信任可改寫 state，沒有驗證 artifact | Release check 重算 artifact hash、核對 run ID、required stage 與未解 P0/P1 | `test_pipeline_engine.py`、真實 `release-check` blocked evidence |
| P1 | Conditional provider fallback 與 blocked handoff 仍回傳 exit 0 | Provider requirement 未滿足、handoff blocked、release blocked/conditional 一律非零 exit | `test_dual_cli.py`、實際 exit-code smoke |
| P1 | CAS 只有順序 stale check，沒有跨程序互斥 | 新增 lock file、stale lock recovery、單 revision 遞增與 concurrent worker regression | `test_pipeline_engine.py` |
| P1 | Trust root 漏掉 JSON roles、Skills 與 validation inputs | 新增 committed canonical `trust-manifest.json`，Plan 前逐檔以 Git blob 驗證 roots/files 集合與內容；任何 dirty/untracked control input 拒絕 | trust manifest coverage/dirty-plan tests |
| P1 | Manifest 與 task write scope 沒有 runtime 強制交集 | 新增 canonical path、symlink、forbidden-path、scope intersection 與 workspace diff policy | `test_policy.py` |
| P2 | 未知角色/provider 可能回退預設值 | Registry、role、provider 全部 fail closed；manifest 必須位於受控 roles 目錄且 ID/provider 一致 | `test_routing.py`、`test_dual_cli.py`、`ai:validate` |
| P2 | Adapter 可把 exit 0 但缺少語意狀態當成功 | Codex/Antigravity 必須輸出可驗證 status；缺失或未知 status 失敗 | `test_dual_cli.py` |
| P2 | Antigravity fallback 可能被誤解為 provider 等價通過 | 結果新增 `provider_requirement_satisfied=false`、`capability_equivalent=false`，fallback 最高為 conditional | 真實 Antigravity smoke |
| P2 | QA importer 可攜入 assigned role、依賴或 server 控制欄位 | 只保留內容欄位；角色、reviewer、QA、dependency、status 與控制欄位由 server 重建 | `test_dual_cli.py`、boundary fixture |
| P2 | Role handoff metadata 可能自循環 | Manifest 統一改為 `dynamic-dag` 與單向 failure role；validator 檢查角色存在 | `ai:validate`、DAG cycle tests |
| P2 | Registry/schema/state/report 欄位漂移 | 更新 registry、adapter result、role DAG、pipeline state、stage receipt schemas；state 改為 v2/hybrid | `ai:validate`、JSON parse、`status` |
| P2 | `NEXT_ACTION` 依 stage 名稱猜 provider | 直接讀 stage provider/role | pipeline plan/status smoke |
| P2 | Model fallback 可洗掉第一次越權寫入證據 | 每個 attempt 獨立 snapshot/policy check；任何 policy violation 禁止 fallback；累積 attempt evidence | `test_dual_cli.py` |
| P2 | Receipt 只與可改寫 state 自洽 | 加入 coordinator-only HMAC；state/receipt 綁 trusted DAG digest、Git HEAD、dirty-tree fingerprint、pipeline revision、attempt 與 run/stage 專屬 artifact；key 不透傳 adapter | forged definition/source/identity/reuse/hash/signature tests |
| P2 | Duplicate untrusted issue 可降低 P0/P1 severity | 相同 ID 保留最高 severity 並合併 evidence/control flags | `test_dual_cli.py` |
| P2 | Blocked release-check 對 shell 顯示成功 | blocked/conditional/unsupported/hybrid-required 統一回傳非零 | `test_dual_cli.py`、實際 release smoke |
| P2 | Legacy executor 只擋 supply-chain paths | Legacy worktree execution 現在同時強制動態 DAG writer roles 與 trusted task write scope 交集 | `test_orchestrator.py` |
| P2 | 外部 Skills 可從浮動 main 取得指令 | Runtime remote fetch 已移除；`skills-lock.json` 記錄完整目錄 digest，validator 不一致即 fail closed | `test_validate_setup.py`、`ai:validate` |
| P2 | Commit gate secret scan 讀 working tree 而非 index | 新增 `--staged`，以 `git show :path` 掃描 staged blob；加入 index/working tree 不一致 regression | `test_secret_scan.py` |
| P3 | 靜態 new-feature pipeline 缺少獨立 security/human gate | 補 `security-review` 與 `await-human-approval`；實際 task 以動態 DAG 為準 | `ai:validate` |
| P3 | `antigravity` alias 優先於本機實際 `agy` | executable 順序改為 `agy`、`agy.exe` 優先 | `ai:doctor` |
| P3 | Git snapshot 看不到敏感 ignored files | 額外 hash `.env*`、cookies、npm/pypi config、PEM/key 與 Git HEAD/config；加入禁止規則 | `test_policy.py` |

## 實際驗證

- Automation：73 tests passed。
- Setup validator：11 native agents、14 Codex roles、10 Antigravity roles、9 skills，通過。
- Working-tree secret scan 與 189-file staged-blob secret scan：通過。
- ESLint、TypeScript、169 Vitest tests、Next.js 72 routes build、preflight：通過。
- Codex CLI read-only smoke：通過；設定模型 `gpt-5.6-sol` 不受 CLI 支援，明確 fallback 到 `gpt-5.4`；actual runtime model 維持未驗證。
- Antigravity CLI：`agy --print --sandbox` 45 秒無輸出並 timeout；Codex fallback 為 `conditional`，不滿足 Antigravity provider requirement。
- Handoff contract：通過；實際 handoff 為 `blocked/hybrid`，沒有把 planned role 報成 executed。
- Trust-root commit 後 deterministic regression：所有 8 個子命令通過，`coordinatorTrusted=true`、HMAC attestation 驗證通過且 regression exit 0。
- Release check：只因 12 個 required stages 尚未執行而 blocked/exit 2；沒有 coordinator、digest、fingerprint、revision 或 attestation blocker，`productionApproved=false`。

## 邊界與殘餘風險

- 本輪沒有修改 CelebrateDeal 產品功能。`reports/antigravity/qa-issues.json` 的 A11Y-001 是產品頁效能 P2，依本輪 scope 保留為 untrusted/unreviewed。
- Antigravity CLI 需要真人確認登入、quota 或首次啟動狀態，屬 External required。
- Staging/CI 需設定 coordinator-only `AI_PIPELINE_ATTESTATION_KEY`；未設定會 fail closed。外部 CI artifact signing/storage 仍是 deployment governance，不可由 repo 自行宣稱已完成。
- Automation trust root 已建立獨立 Git commit；commit identity 請以 `git rev-parse HEAD` 取得。Coordinator 已逐檔核對 committed manifest、control roots 與 validation inputs，工作樹中的產品變更不屬於本次 commit。
- Codex CLI 啟動時回報數個使用者全域/plugin skill description 超過 1024 字元；不影響本次 repo automation smoke，但不是本輪專案檔案修復範圍。
- Worktree 目前包含大量既有產品變更；本輪沒有還原或覆蓋那些變更。

## 判定

Repo 內可安全完成的 AI Team P0-P3 程式修復、trust-root commit 與 attested deterministic regression 已完成。雙 CLI 架構仍是 `hybrid`；release gate 只因 required stages 尚未執行而 blocked，其中 Antigravity stages 仍需 Desktop 外部複驗。不能宣稱 Antigravity 全自動執行或 pipeline release 已通過。
