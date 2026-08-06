# AI Team Workflow Mode

目前模式：`PRELAUNCH_DEV`

`PRELAUNCH_DEV` 是 CelebrateDeal 本機開發與驗證的預設模式。除非使用者明確要求，任何角色不得自行切換到 `RELEASE_HARDENING`。

## PRELAUNCH_DEV

- 以 Git ownership、可分離 hunks 與產品保護邊界驗證 working tree；不以固定 dirty path 數量當 hard gate。
- living Master Plan、checkpoint、sanitized evidence、reports 與 runtime metadata 屬於 mutable control plane，不納入產品 source-integrity manifest；Master Plan self-hash 僅作資訊性 integrity metadata。
- 同一 WP、同一驗收目標、根因與 ownership 可控時，Terra 可採取合理、可回滾的診斷與修復；不以固定 remediation 輪數、full run 次數或直接相關檔案數量作為強制邊界。
- 仍必須保留適用的 deterministic tests、integration gate、sanitized evidence、Git diff/status 檢查、checkpoint 與 rollback 說明。完成實作後預設進行唯讀 AGY QA，再由 Sol 做 acceptance review；只有 `ACCEPT` 可 finalize。

## RELEASE_HARDENING

僅能由使用者明確切換，用於正式部署前的精確 scope、hash、migration、rollback、production evidence 與人工授權。此模式不會由 PRELAUNCH_DEV 自動啟用。

無論模式為何，正式 DB、正式 Secret、正式外部服務、部署、付費操作、未核准破壞性 migration，以及 Git 的 push、merge、rebase、amend、reset、clean、stash、restore 或 checkout 丟棄未知變更，一律禁止。
