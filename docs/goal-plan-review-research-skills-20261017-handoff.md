# Goal 交接：全站 Code Review、市場調查與 Skill 盤點（2026-10-19）

本文件是 Goal 的收尾交接，不是任何驗收證據。基線 `review-baseline-2026Q4` = `origin/master@78621ca3`；分支 `codex/goal-review-2026q4`。

## 先讀這三份

1. `docs/ROADMAP-v2.md`：一頁摘要、模組決策、重構 vs 重寫、封測前三條工作線、封測準備、治理。
2. `docs/DECISIONS-2026Q4.md`：46 項 owner 決策，依「本週／封測前／封測後」排序；本週截止 10-21。
3. `docs/review-2026Q4/23-remediation-backlog.md`：L0～L3 修復清單，L0 核心 18 項（11.75～22.25 人日）。

## 其餘產出

| 目錄 | 內容 |
|---|---|
| `docs/market-2026Q4/` | 市場研究報告與 6 份研究筆記 |
| `docs/review-2026Q4/` | 01～04 盤點、10 findings 總表、11～21 十一條軸線審查、22 架構債地圖、23 修復 backlog |
| `docs/skills-2026Q4/` | skill 盤點、agent 缺口、connector 方針、執行手冊、內容製作選項、7 份 SKILL.md 草稿（`drafts/`） |
| `reports/review-2026Q4/` | 每個 WP 的 receipt 與靜態掃描原始輸出 |

## 下一個 Goal 的啟動條件

1. owner 回覆 DECISIONS 的「本週」欄（至少 D-01、D-02、D-06、D-15）。
2. 主對話依 ROADMAP-v2 §3.1 建立三條工作線，每條一個 `codex/*` 分支、單一 writer；付款、auth、migration 的變更一律 engineer-hard 實作、reviewer 審查後才合併。
3. 第一天開工項目：F-037（PayUni TradeStatus）、F-101（結帳頁內部備註）、#436 rebase 與審查（F-024）。
4. Goal 狀態改記在 `docs/goal-2026Q4-beta/STATE.md`（依 `docs/skills-2026Q4/02-agent-gaps.md` 建議），不再使用已刪除的 `.ai-team/state`。

## 已知限制

- 所有審查為靜態閱讀加不需 DB 的單元測試；沒有連 staging 或 Production，RLS、grant、時區、連線池、Cloudflare 帳戶隔離都未實測。
- 市場研究缺台灣直播 GMV、幫賣定價、通路 CAC；法規條號未逐字核對，需律師與會計師確認。
- reviewer agent 目前無法寫檔，Critical 報告由主對話代為存檔；改善建議見 `docs/skills-2026Q4/01-skill-inventory.md`。
