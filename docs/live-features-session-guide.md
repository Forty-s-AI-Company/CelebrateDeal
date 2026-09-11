# 直播功能新 Session 執行規範

本文件供 2026-09-10 使用者要求的各功能新 session 提示詞引用。使用者已要求以 ai-team-pro 製作上述功能；本次交付提示詞，功能實作由收到個別提示詞的新 session 執行。原始想法文件的「先不寫程式」屬前一階段，不阻止新 session 明確指定功能的實作。每個 session 只執行當次指定範圍。

## 啟動與模式

1. 使用專案 C:\Users\eden\Downloads\AI\CelebrateDeal。先讀 AGENTS.md、docs/ai-team/workflow-policy.md、本文件與 docs/live-experience-ideas-2026-09-10.md，再按需讀取適用的子目錄規範。
2. 執行 .ai-team/scripts/Switch-AiTeamMode.ps1 ai-team-pro，確認實際設定與工具能力。切換腳本只設定專案，不保證切換目前 session 的模型；不宣稱已使用未提供的模型或已動態更改推理程度。
3. 2026-09-10 本次切換在寫入 .codex/config.toml 時遭權限拒絕，router 可能已先更新；後續須確認完整狀態。不可繞過權限。若仍受限，回報後使用可用能力推進已授權且不受阻的工作。
4. 主代理端到端規劃、實作與驗證。只有獨立專業工作能實質提升品質時才委派，宣告唯一工作、最小上下文與單一 writer ownership；不得向子代理複製完整歷史或全專案內容。高風險權限／資料隔離依專案審查階梯執行；工具不可用需誠實記錄。

## 實作界線

- 先檢查 git status 與相關現有功能，保留所有既有變更；優先補齊與復用，不另建第二套直播、訊息、問題或腳本系統。
- package.json 已有 test:interactions，以及 live-question、live-interaction、interaction-script-form、live-playback 等測試線索；用 rg 追蹤當次所需入口，不一次讀取全部檔案。
- 修改 Next.js 前先讀對應本機 Next.js 文件；涉及其他技能時依實際任務載入。
- 必須完成真實 UI、資料流、權限與儲存，不能以靜態畫面或只連 mock 宣稱功能完成。外部服務缺口需明列，mock 證據不能替代端到端整合。
- 不讀取 .env* 或秘密，不操作 Production 或正式資料，不自動部署、push 或 merge。資料結構只做必要向後相容擴充；可新增 migration 檔，但不得擅自套用到外部資料庫或執行破壞性 migration。
- 新增功能與既有直播、預錄、聊天、下單流程保持相容；程式的重要邏輯加入簡潔註解。
- 每個 session 依賴前一功能時先核對實際檔案與證據；若缺少依賴，只補該功能必要的最小合約，不順便實作另一整個功能，也不以假資料掩蓋。

## 驗證與交付

- 自查安全性、效能、可讀性、可維護性並修正具體問題。
- 執行 typecheck、相關 ESLint 與有意義的 targeted tests；UI 變更增加瀏覽器驗證，權限變更測試兩名觀眾、講師及跨租戶／跨活動隔離。
- 檢查現有 GitHub Actions；已涵蓋每次 push 的 ESLint 與單元測試就沿用，缺少才補足，不能引入 Production 自動部署。不得降低既有 assertions 或 coverage 門檻。
- 未執行的真機、外部服務或跨瀏覽器測試明列為未驗證，不標 PASS。
- 保存簡潔交接文件 docs/live-feature-handoffs/<功能代號>.md：完成範圍、相關檔案、資料／事件合約、實際測試、限制、回滾方式、下一功能依賴。
- 依適用 Git 規則建立僅涵蓋已確認 ownership 的本地 checkpoint；不得納入未知既有變更。若 .git 權限受限，不繞過、不捏造 commit，回報文件已保存及 commit 未建立。
- 最終回報實際完成結果、測試證據、commit hash（若成功）與剩餘限制。除真正授權或外部阻擋外，持續到指定範圍完成。

## 建議執行順序

01 私密聊天室 → 02 互動卡片 → 03 預錄時間觸發 → 04 講師排版 → 05 橫直式與手機體驗 → 06 去背 → 07 彈幕 → 08 預設互動角色。

各 session 依序在同一專案接續，避免同時修改播放器或共用資料結構。最後另做整合驗收。
