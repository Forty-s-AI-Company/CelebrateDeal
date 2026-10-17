# WP-19：目前通知通道分支完成

人類已決定未來採用 EVERY8D＋額外點數，基本方案不漲價，但本次 Goal 先不實作 SMS。依 Goal Plan 原始二選一驗收，本次採「UI／文件明示目前僅 Email＋LINE」分支；EVERY8D adapter、計量、退訂、費率、點數、Sandbox 送達與實際採購均留作後續工作，不冒充目前能力。

## 完成內容

- 訊息模板新增／編輯只允許 Email 與 LINE；SMS 顯示「尚未串接，不能啟用」。
- 伺服器在交易與資料寫入前拒絕 SMS；action test 證明不會 create、update 或寫 audit。
- 空清單說明改為 Email／LINE 可建立、SMS 未開放，不再誤稱 LINE 也要等待開放。
- 舊 SMS 或未知通道資料在列表顯示「通道不可用」，不會與「模板啟用」並列造成可寄送的錯覺。
- 編輯舊資料發生驗證錯誤時，明確提示通道必須改為 Email 或 LINE。
- 文件保留 WP-04／WP-13 對實際 Email／LINE 排程與送達的驗收，不把模板能力當成已送達。

## 驗證與複審

- Canonical `assess_acceptance`：READY，blockers `[]`。
- Revision：`sha256:4590c2259d4aee2c2ead67fa4e5d763c7689b7f778d2612224a81ed8dda7550c`。
- Targeted unit／action tests：PASS；涵蓋 React 通道控制、SMS normalizer 拒絕、server action 寫入前拒絕、空狀態及舊通道呈現。
- TypeScript、scoped ESLint、diff check：PASS。
- 三次獨立 Claude CLI review 均實際觀測 `claude-sonnet-5-5`，effort unknown；最終 0 BLOCKER／0 MAJOR。保留既有 trigger UX、較廣 Email／LINE 行為證據與額外 legacy 測試 MINOR／NIT，不阻擋本分支。
- Browser、Preview、staging、remote CI、EVERY8D Sandbox、實際 SMS／Email／LINE 送達：NOT_RUN。
- 第一次 Windows validation runner 直接啟動 `.cmd` 在 0.03 秒失敗；改由 Node 直接啟動 Vitest 後同一快照通過。失敗收據保留，未標 PASS。

## 改動與安全

本輪產品／測試／決策文件：

- `src/app/(app)/messages/templates/page.tsx`
- `src/app/(app)/messages/templates/page.test.tsx`
- `src/components/message-template-form-client.tsx`
- `src/components/message-template-form.test.tsx`
- `docs/launch/wp19-notification-channels-20261016.md`
- `docs/launch/provider-decisions-research-20261016.md`

所有工作都在獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，基底 `efb8b7e9`。沒有操作使用者 dirty 工作樹、推送、部署、正式付款、正式資料、正式寄送或 Secret。

Evidence：`docs/ai-team/evidence/product-audit-20261011/WP-19/completion-final-{acceptance,snapshot,unit,typecheck,lint,diff-check,sonnet-review,review-qualification,findings}.json`。

AI_TEAM_HANDOFF
CURRENT_TASK_STATUS: COMPLETE
CURRENT_WORK_ITEM: WP-19 目前 Email＋LINE、SMS 未開放的通知通道分支。
ACTUAL_RESULT: UI、文件與伺服器一致拒絕 SMS；legacy SMS／未知通道不顯示為可用；canonical acceptance READY。
EVIDENCE: 本文件及 WP-19 completion-final evidence。
NEXT_ACTION: 繼續下一個未完成 WP；EVERY8D 實作維持後續項目，不在本 Goal 自動啟用。
ROLLBACK: 僅反向上述六個本輪 owned 檔案增量，不覆蓋其他 WP 或原 dirty 工作樹。
SAFETY_STATUS: PASS
PLAN_REVIEW_STATUS: PASS
GIT_PROMOTION_STATUS: NOT_REQUESTED
PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED
COPY_TO_NEW_TASK: NO
