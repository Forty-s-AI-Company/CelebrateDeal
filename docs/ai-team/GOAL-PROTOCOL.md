# Goal Protocol

## 長程 Goal

CelebrateDeal 的 Goal 是持續任務，不以固定時間或單一 Work Package 結束。主代理可依 roadmap 持續完成：

1. product feature closure
2. product security hardening
3. disposable／staging／sandbox verification
4. quality and coverage improvement
5. release evidence and scoring

每完成一項就保存 checkpoint，然後自動挑選下一個已核准且有最高產品價值的工作。只有 Goal 的所有目標已完成，或遇到安全／授權阻擋，才停止。

## 自主執行

- 一般 Worker／Luna 可以修改、測試、建立 evidence、checkpoint 與本地 commit；Worker Deep／Terra 負責複雜跨檔與困難診斷。
- Sol 可以在需求改變、scope 擴大、根因改變或需要 acceptance 時重新規劃。
- AGY Fast、AGY Deep 與 native Luna 可依需要自動使用，不要求固定順序或固定次數。
- Sol 完成 complex／critical 或安全、金流、migration、release plan 後，可選擇一次 Claude Sonnet 4.6 thinking advisory review；額度不足時直接跳過。
- 一般實作固定使用 `gpt-5.6-luna max` Worker；Reviewer 固定使用 `gpt-5.6-terra` read-only。Explorer／Analyst 在 `complex`／`critical` 時可升級至 Luna read-only。
- 同一檔案或資料資源維持單一 writer；不相交 scope 可並行。
- 測試、coverage、Browser、Preview、staging、sandbox 與 disposable DB 依價值與風險選擇，不必每個 WP 全部執行。

## 必須保留的安全規則

- 禁止讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- 禁止正式資料庫、正式付款、正式退款、正式寄信與正式服務操作；Production deploy 需明確授權。
- 禁止未核准破壞性 migration、資料刪除、廣域 Docker cleanup 與不可逆操作。
- 禁止偽造 evidence、虛報測試 PASS、降低 assertion／threshold 或以 skip／exclude 掩蓋失敗。
- 必須保留使用者既有變更，不得使用 destructive Git 操作。
- 外部與 disposable 操作必須有 ownership、最小 scope、cleanup 與 sanitized evidence。
- Git 可自動 push `codex/*` 分支並透過受保護 PR merge；Production deployment 不得由 merge 自動觸發，仍需人工核准。

## Goal state

Goal state 位於 `.ai-team/state/goal-state.json`；進度可記錄於 `.ai-team/logs/goal-progress.md`。這些是 control-plane metadata，可由主代理在每個 checkpoint 更新，不必等待 Sol 或停止 Goal。

建議狀態：`IN_PROGRESS`、`WAITING_AUTHORIZATION`、`BLOCKED_ENVIRONMENT`、`COMPLETE`。`BLOCKED` 只代表目前路徑停滯，主代理可以在保留證據後改走另一個已授權路徑。

## 迴圈停止

- 同一命令或根因沒有改善時，不重試原命令；改用不同診斷或轉往下一個產品工作。
- `LOOP_DETECTED` 只標記該路徑，不阻止整個 Goal 持續推進。
- AGY 工具阻擋不能偽造成 PASS，也不能觸發無限重試；可自動使用其他模型或 deterministic evidence。

## 完成條件

只有以下全部成立才可將長程 Goal 標記 `COMPLETE`：

- 所有核准功能與必要產品風險已處理。
- 所有指定 launch score 與 canonical CAT01～CAT10 達標，或明確記錄仍需人工／外部 owner 的部分。
- 必要 deterministic、integration、staging、sandbox、監控與人工證據均可追溯。
- 沒有未揭露的安全阻擋，且 release decision 已由授權 owner 作出。
