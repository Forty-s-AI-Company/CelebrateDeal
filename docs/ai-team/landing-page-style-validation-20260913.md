# Webinar 網站設計與完整流程驗證

## 本次範圍

- 依 ai-team-style 整理網站列表、頁面設定與動作列，統一藍白色系、焦點及停用狀態。
- Webinar 起始模板加入講者、議程、FAQ，保留清楚標示的待填內容，未加入虛構見證。
- 公開頁加上內容寬度與區段留白，Hero／CTA 使用白底高對比按鈕；手機版保留單欄閱讀。
- 預覽切換保留編輯器，不卸載 Puck 歷史紀錄；預覽內容按需渲染。
- 儲存／發布期間停用頁面設定，長選單限制在欄位內。

## 驗證方式

`scripts/landing-page-disposable-qa.mjs` 建立全新、只綁定 loopback 的 PostgreSQL 16 容器，使用 tmpfs，未操作既有資料庫。
Prisma 只使用不含環境檔的 schema/migration 副本；Next.js 由不含環境檔的程式副本建置與啟動。子程序只得到允許的系統變數及合成測試設定。
每次執行重新建立測試資料庫；結束時確認本輪 label 後只移除本輪容器。未寄正式信件、未部署、未讀取或載入 `.env*`。

測試 `tests/e2e/landing-page-flow.spec.ts` 透過真實登入表單登入合成 owner 帳號，依序：

1. 建立專案內頁面並儲存草稿。
2. 發布，查核資料庫發布版本、表單及活動關聯。
3. 更新草稿並確認公開版本指標保持不變。
4. 開啟公開頁，確認桌機與 375px 手機沒有橫向溢出。
5. 點擊報名 CTA，確認 UTM、頁面來源及場次參數。
6. 送出固定表單，確認 HTTP 成功、成功提示及實際 FormSubmission 資料。

## 結果

- 85 個 migration 已在隔離資料庫成功套用，Prisma validate / migrate deploy / migrate status 通過。
- 截圖修正後的正式模式 Next.js build 與完整 browser journey 均通過。
- 最後一次 browser journey：1 項完整流程通過，未處理 pageErrors 為空，375px 手機橫向溢出斷言通過。
- 最終結果：[receipt](evidence/landing-style-20260913/receipt.json)、[管理編輯器](evidence/landing-style-20260913/landing-page-editor.png)、[公開桌機](evidence/landing-style-20260913/landing-page-public-desktop.png)、[公開手機](evidence/landing-style-20260913/landing-page-public-mobile.png)。
- Targeted Vitest：7 個檔案，75 個測試通過。
- TypeScript 檢查通過。
- Targeted ESLint：0 errors，3 個既有原生圖片效能 warnings，未停用規則。
- `git diff --check` 通過；模式切換腳本產生的檔尾空行已修正。
- 初期 E2E 等待條件與按鈕匹配失敗已保留在各次 receipt，修正測試同步後未減少斷言。

## 明確邊界

- Migration 實際套用對象是全新隔離測試資料庫，不是使用者日常開發庫或 staging；後者尚待指定目標。
- 報名驗證到資料入庫與驗證通知排程，不代表正式郵件送達或報名者已完成 email 驗證。
- 未部署、未 push。既有 push CI 已包含 ESLint 與測試，新 E2E 由既有 testDir 收錄。
- 不把單一模板的流程驗收擴大宣稱為全部模組、任意巢狀排版與多瀏覽器皆已通過。

## 回滾

可反向提交本次 checkpoint 回復樣式與測試腳本，保留前一版頁面功能。隔離資料庫已由本輪 runner 清理；未變更任何既有資料庫。
