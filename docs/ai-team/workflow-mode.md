# AI Team Workflow Mode

目前模式：`PRELAUNCH_DEV`

`PRELAUNCH_DEV` 是 CelebrateDeal 本機開發與驗證的預設模式。除非使用者明確要求，任何角色不得自行切換到 `RELEASE_HARDENING`。

## PRELAUNCH_DEV

- 以 Git ownership、可分離 hunks 與產品保護邊界驗證 working tree；不以固定 dirty path 數量當 hard gate。
- living Master Plan、checkpoint、sanitized evidence、reports 與 runtime metadata 屬於 mutable control plane，不納入產品 source-integrity manifest；Master Plan self-hash 僅作資訊性 integrity metadata。
- 同一 WP、同一驗收目標內，Terra 可進行最多 3 輪 bounded remediation、最多 2 次 canonical full run，並在符合 policy 時擴張至最多 8 個直接相關檔案。
- 仍必須保留 targeted tests、適用的 integration gate、sanitized evidence、精確 stage、staged diff review、secret scan、`git diff --cached --check`、獨立 commit、checkpoint 與 rollback 說明。

## RELEASE_HARDENING

僅能由使用者明確切換，用於正式部署前的精確 scope、hash、migration、rollback、production evidence 與人工授權。此模式不會由 PRELAUNCH_DEV 自動啟用。

無論模式為何，正式 DB、正式 Secret、正式外部服務、部署、付費操作、未核准破壞性 migration，以及 Git 的 push、merge、rebase、amend、reset、clean、stash、restore 或 checkout 丟棄未知變更，一律禁止。
