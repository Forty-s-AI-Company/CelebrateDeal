# AI Team Workflow Mode

目前模式：`PRELAUNCH_DEV_AUTONOMOUS`

## PRELAUNCH_DEV_AUTONOMOUS

這是尚未對外營運專案的自主開發模式：

- Goal 可以跨多個 WP 連續執行，不受固定時間、固定檔案數或固定 remediation 輪數限制。
- 允許本機、loopback、disposable、Preview、staging、sandbox、Docker、Browser 與 PayUni Sandbox。
- 允許精確 scope 的 local checkpoint commit；可自動 push `codex/*` 分支並透過受保護 PR merge。
- Production deployment 不會由 push／merge 自動觸發，仍需獨立 workflow 與人工核准。
- 可依產品價值選擇 targeted tests、完整測試、coverage、E2E 或外部 sandbox evidence。
- 不需要每個 WP 都執行相同的 planner、AGY、acceptance 與 finalize 流程。

## RELEASE_HARDENING

只有使用者明確要求時才切換。此模式會增加 production deployment、release rollback、migration、外部服務、監控與人工簽核的精確 Gate。

## 永遠有效的安全底線

- 正式 DB、正式 Secret、正式付款、正式退款、正式寄信與正式服務一律隔離；Production deployment 需額外授權。
- 未核准破壞性 migration、資料刪除、廣域 Docker cleanup 與不可逆 Git 操作一律禁止。
- 不偽造 evidence，不把未執行測試標成 PASS，不降低 assertion／threshold，不以 skip／exclude 掩蓋問題。
- 保留使用者既有變更；同一資源保持單一 writer；外部操作保存 sanitized evidence。
