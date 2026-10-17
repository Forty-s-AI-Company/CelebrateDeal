# WP-13：Project 共用 LINE 官方帳號

依 2026-10-16 使用者要求，商家集中管理多個官方帳號，每個 Project 選擇一個，允許跨 Project 共用。這是 WP-13 的新增子項，不能以此宣告原始 Goal 完成。

- 單一 writer：主代理；獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`。未修改使用者原始工作樹。
- Requested/effective team：ai-team-pro；router 建議 Sol xhigh，實際主代理 model/effort unknown；automatic spawn=false、parallel=1、writer=1。Auth/Permission/Migration 需獨立深度審查。
- Scope：帳號管理、Project 選擇、OAuth state/identity、帳號專屬 webhook、outbox 發送路由、圖文選單草稿、向後相容 migration。禁止修改發布／付款閘門或實作 SMS。
- 驗收：同商家多帳號；跨商家 ID 拒絕；共用帳號的多課程各自綁定；切換帳號後舊 OAuth／身份／待發訊息不可轉送新帳號；unfollow 不影響其他帳號；舊帳號及 Project 保留原對應。
- 驗證：targeted unit、TypeScript、lint、disposable PostgreSQL migration／關聯約束、獨立 critical review。真實 LINE 授權與送信未執行，不標 PASS。
- 風險與停止條件：租戶、帳號或 OAuth channel 無法證明一致時 fail closed；provider 結果不確定沿用現有鎖；不得接觸正式憑證／資料。
- 回滾：本次編輯前快照 `.ai-team/reports/line-multiaccount-before-20261016/`，僅回復本次增量；資料庫僅 disposable 驗證。未授權正式 migration，不能將刪欄 rollback 套用到真實資料。
- 外部輸入：真實官方帳號與 channel 安全注入仍 WAITING_AUTHORIZATION；不阻擋本機合成資料開發。
- 狀態：本機子項 READY；128 units、18 PostgreSQL cases、132 migrations、1 條實際瀏覽器流程、tsc／lint／獨立 Critical review 通過。完整 WP13 仍 IN_PROGRESS，不增加已完成 WP。詳見 `wp13-project-line-handoff-20261016.md` 與 WP13/project-accounts-acceptance.json。

既有去重語意採同帳號同事件至多一次：A→B→A 不補發已停止的 A 舊事件，後續新事件正常處理。共用帳號有任何送出中訊息時，暫停變更所有共用課程的帳號，租約由既有 worker 回收。LINE OAuth 同瀏覽器同時僅保留最近一次發起的流程；其他分頁需重新開始。這些限制不影響跨 Project 共用已儲存帳號。

Prisma 6 無法在 schema 表達本 migration 的 partial unique indexes 與 CHECK constraint。它們是必須保留的 SQL 約束，未來 migration 不得刪除：`LineOfficialAccount_one_default_per_vendor`、`LineRichMenuDraft_unbound_per_vendor`、`LineUserIdentity_unbound_subject_key`、`LineUserIdentity_unbound_revoked_check`。本次以 disposable PostgreSQL 的實際約束與 legacy backfill 測試驗證；未新增共用驗證框架。
