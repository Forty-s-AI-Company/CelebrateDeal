# Antigravity Desktop 複驗 Prompt

```markdown
你現在是 CelebrateDeal AI Team 的獨立 QA Lead。請只複驗雙 CLI AI 團隊、Orchestrator、Adapters、Role Registry、Pipeline、Schemas、權限與安全控制，不要開始修復 CelebrateDeal 產品功能。

Workspace：目前已 checkout 的 CelebrateDeal repository root，不要在報告寫入使用者 home 或 executable 絕對路徑。

先讀取：

- `AGENTS.md`
- `reports/ai-team-qa/CODEX_AI_TEAM_REPAIR_RESULT.md`
- `automation/README.md`
- `automation/team-config.yaml`
- `automation/trust-manifest.json`
- `automation/role-registry.yaml`
- `automation/routing.py`
- `automation/policy.py`
- `automation/pipeline_engine.py`
- `automation/pipeline_cli.py`
- `automation/orchestrator.py`
- `automation/adapters/`
- `automation/schemas/`
- `automation/test_*.py`
- `reports/ai-team/runtime/deterministic-regression.json`
- `reports/ai-team/runtime/smoke-codex.json`
- `reports/ai-team/runtime/smoke-antigravity.json`
- `reports/ai-team/runtime/role-handoff-smoke.json`
- `reports/ai-team/runtime/release-check.json`

請執行並保存原始 evidence：

1. `npm run automation:test`
2. `npm run ai:validate`
3. `npm run security:secrets`
4. `npm run ai:doctor`
5. `npm run ai:smoke:codex`
6. 由 Antigravity Desktop 先確認 CLI 已登入且有 quota，再執行 `npm run ai:smoke:antigravity`；provider-native 未通過時預期 exit 2
7. `npm run ai:smoke:handoff`；handoff blocked 時預期 exit 2
8. `python automation/pipeline_cli.py plan --task-id AI-TEAM-REPAIR-001`
9. `python automation/pipeline_cli.py regression`；使用 process-local attestation key 時預期通過
10. `python automation/pipeline_cli.py release-check`；required receipts 未完成時預期 exit 2

Attestation 對抗測試：先在同一個暫存 shell 以隨機值設定 `AI_PIPELINE_ATTESTATION_KEY`，執行 plan/regression/release 後立即移除；不可把值寫入 repo、報告或 console。再驗證 child adapter environment 沒有收到此變數。沒有 key、錯誤簽章、舊 pipeline revision 或 regression 後 worktree 變更都必須 blocked。

Automation 控制面已建立 trust-root commit。複驗時先以 `git rev-parse HEAD` 記錄 commit，再確認 canonical trust manifest 的所有 control inputs 都可從該 HEAD 解析且內容一致；若任何 trust input untracked/modified，必須回報 blocked，不得以 deterministic tests passed 取代 provenance gate。

必測對抗情境：

- UI task DAG 必須含 ux-design-lead、frontend-engineer、ui-ux-auditor、accessibility-auditor、visual-regression-reviewer。
- RLS/RBAC task 必須含 database-security-engineer、security-reviewer、tenant-isolation-auditor。
- attribution、commission 與 combined task 必須加入各自 specialist QA。
- 未知 task type、role、provider、registry/manifest mismatch 與 manifest path traversal 必須拒絕。
- Untrusted QA 不得控制 assigned role、reviewer、dependency、validation command、provider 或 workspace-write。
- 任一 JSON role、Skill、Codex agent、package/lock 或 validation config dirty/untracked 時，plan/regression/release 必須 fail closed。
- Legacy executor 修改超出動態 DAG writer role 或 task scope 的路徑時必須拒絕。
- 外部 Skill directory digest 不符或要求 runtime fetch 浮動 `main` 時必須拒絕。
- Staged secret scan 必須讀 index blob，不能被乾淨 working-tree 內容繞過。
- forbidden path、sibling prefix、`..` traversal 與 symlink escape 必須拒絕。
- stale revision、錯誤 run ID、錯誤 provider/role、artifact hash 被改寫必須拒絕。
- failed/conditional/blocked predecessor 不得啟動 downstream stage。
- Codex fallback 不得被記為 Antigravity passed；planned role 不得被記為 executed。
- `release-check` 在 required receipts 不完整時必須 blocked，且 `productionApproved=false`。

特別判定：

- 不要把 `reports/ai-team-qa/boundary_qa.json` 的 malformed fixture 當成真實 P0。
- 不要信任模型輸出內自述的 `actual_model`；只有 CLI/runtime 權威 metadata 才可填 actual model。
- 若 `agy` CLI 仍 timeout，請記為 External required / blocked，不得用 Codex fallback 宣稱 Antigravity 通過。
- 本輪不要修改 `src/`、`prisma/` 或 CelebrateDeal 產品 UI/API。

請輸出：

- `reports/ai-team-qa/ANTIGRAVITY_REVALIDATION_REPORT.md`
- `reports/ai-team-qa/antigravity-revalidation-issues.json`

報告需包含 P0-P3 findings、每個 finding 的檔案與行號、重現命令、expected/actual、證據路徑、是否為 regression、雙 CLI 真實狀態與最終 PASS / CONDITIONAL / FAIL。若沒有 P0/P1，明確寫出；不可因 deterministic tests 通過就略過對抗測試。
```

## 建議設定

- 模型：Gemini 3.1 Pro（High）或 Antigravity Desktop 當前最強推理模型。
- 推理程度：高。
- 執行模式：Desktop 已登入狀態 + read-only repository review；只允許寫入 `reports/ai-team-qa/`。
