# Codex Repair Prompt

你好 Codex，請協助修復 CelebrateDeal 在全站 QA 驗收中發現的問題。

## 請先讀取以下報告
- `reports/antigravity/QA_LATEST.md`
- `reports/antigravity/qa-issues.json`

## Issue 修復順序
1. **P2 - A11Y-001**: `/admin/billing/affiliate-payouts` 頁面載入逾時 (Timeout)。
   - **問題描述**：在並行執行 Playwright 測試時，Platform Admin 存取聯盟出款頁面會因為資料庫鎖定或 N+1 查詢導致超時（>30000ms）。
   - **修復方向**：請檢查 `src/app/admin/billing/affiliate-payouts/page.tsx` 以及 `src/lib/billing.ts` 中的查詢邏輯。確認是否有 Prisma connection pool 耗盡問題、是否有未建立索引的關聯查詢，或是否需要在 Server Component 加上快取 / 避免 N+1 查詢。

## 必須新增的 regression tests
針對 `A11Y-001`，請在 `tests/e2e/` 增加針對該頁面的效能壓力測試（或在 `src/lib/billing.test.ts` 新增大量資料的查詢效能單元測試），確保在 1000 筆 affiliate commissions 的情況下，頁面仍能在 3 秒內完成 Server Side Render。

## 修復後的驗證命令
修復完成後，請執行以下命令以驗證功能：
```bash
npm run typecheck
npm run test
npm run e2e:a11y
```
請確保 `npm run e2e:a11y` 可以順利通過，不再發生逾時。

## 建議設定
- **建議 Codex 模型**：Claude 3.5 Sonnet 或 Gemini 3.5 Flash High
- **建議推理程度**：高 (High Reasoning)，因為此問題涉及資料庫效能調優與 Prisma 查詢最佳化，需要深入理解現有的資料表關聯與鎖定機制。
