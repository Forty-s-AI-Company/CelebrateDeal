---
name: celebratedeal-evidence-receipt
description: 完成任何 Work Package、審查、掃描、測試或驗收後要寫收據（receipt）時使用；規定欄位、存放在 reports/<goal>/、模型 observed/unknown 與未完成項的誠實寫法，禁止把未執行標為 PASS。
---

# CelebrateDeal 證據收據

## 何時用
每個 WP 或子任務結束時；回報「通過」「完成」之前；彙整多個子代理結果時。與 `celebratedeal-release-gate` 搭配：release-gate 判斷能不能合併，本 skill 規定收據怎麼寫。

## 必讀文件
- `docs/goal-plan-review-research-skills-20261017.md` §8.3。
- `reports/review-2026Q4/` 下既有收據（如 `B-03-receipt.md`、`A-04-receipt.md`）作格式範例。
- `docs/domain-workflows.md`「驗收與交付」。

## 檢查清單
- [ ] 檔名 `reports/<goal>/<WP>-receipt.md`，一個 WP 一份，只寫自己的輸出。
- [ ] 基線：分支與 commit（完整 SHA）、日期。
- [ ] 已執行：每條命令原文、exit code、耗時、原始輸出檔路徑（大輸出存成檔，收據只放摘要）。
- [ ] 沒有執行：逐項列出與原因（缺 DB、缺授權、工具失敗標 `TOOL_BLOCKED`）。
- [ ] 使用模型與 effort：實際觀測到就寫；觀測不到寫 `unknown`，不得由 routing 推測。
- [ ] 結果：BLOCKER／MAJOR／MINOR／NIT 計數，或 PASS／FAIL／BLOCKED，並指向證據檔案與行號。
- [ ] 未完成項與下一步，需 owner 決策者明標。
- [ ] 範圍聲明：是否修改既有檔案、是否有 git 寫入、是否讀 `.env*`、是否連外部服務。
- [ ] 內容 sanitized：環境變數只列名稱，SQL 不含正式資料，競品只摘要，無卡號、Token、Cookie。

## 禁止事項
- 不把未執行或只在本機契約測試的項目標 PASS；不用「應該通過」代替輸出。
- 不降低 assertion、覆蓋率門檻或用 skip／假資料掩蓋失敗後仍標綠。
- 不在收據內貼 secret 或正式客戶資料。
- 不編造耗時與模型。

## 完成證據
收據檔本身即為證據；回報給主對話時附收據路徑，並抽查至少一條命令可重現（命令與 exit code 吻合）。
