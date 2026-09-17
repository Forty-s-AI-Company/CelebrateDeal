# Webinar 一頁式網站編輯器：第一版交付紀錄

本文件保留第一版交付時的驗證狀態。後續視覺設計、隔離 migration 與真實登入報名流程結果，請見 [設計與完整流程驗證](landing-page-style-validation-20260913.md)。

## 範圍

- Puck 固定使用 0.22.4，新增 `/landing-pages` 管理與 `/lp/[slug]` 公開頁。
- 支援基本排版、主視覺、講者、亮點、議程、輪播、影片、價格方案、倒數、見證、FAQ 與 CTA。
- 支援草稿、發布快照、取消發布、複製頁面、將歷史版本還原為草稿；還原後需另外發布。
- 按鈕連接既有固定報名表、外部網址或頁內區段；保留 UTM 與 landing page 來源。
- 活動及表單必須同租戶且關聯一致。公開內容快照獨立於草稿，但活動時間與表單可用狀態即時檢查。
- 新建報名表採固定欄位；保留既有表單與原 `/p/[slug]` TeamFunnel。

## 實際驗證

- TypeScript：`tsc --noEmit --pretty false` 通過。
- Targeted Vitest：15 個檔案、126 項測試通過，包含 landing content/service/actions/attribution、公開頁、既有報名與 TeamFunnel 回歸。
- Targeted ESLint：exit 0；3 項 Puck 預覽原生 img 最佳化警告，未停用規則。
- Prisma Client 6.19.3 由隔離 schema 副本產生成功；沒有載入專案環境檔或連線資料庫。
- Playwright + Chrome，隔離 Vite 測試頁、合成表單資料：拖拉新增、undo、redo、375px 手機預覽通過；無 pageErrors。
- 測試連結結果：`/form/fixture?utm_source=browser-test&lp=page1`。
- 截圖：`evidence/landing-page-editor-20260913/editor.png`、`public.png`。

## 尚未驗證與啟用條件

- Migration 尚未套用；未執行真實資料庫端到端、併發發布、production build 或部署。單元測試中的資料庫為 mock。
- 瀏覽器測試驗證隔離編輯器及渲染器，未驗證登入後管理頁與真實資料庫的完整操作。
- 尚未逐一瀏覽器驗證全部模組、巢狀拖拉、跨預覽切換的歷史紀錄與所有手機樣式組合。
- 最終互動腳本回報 pageErrors 為空，但 Vite 累積日誌曾出現 ResizeObserver loop 通知；尚需在實際 Next.js 管理頁確認是否重現。
- 啟用前先於核准的非正式資料庫審查並套用新增 migration，再執行租戶隔離、發布版本與完整報名整合測試。
- `lp` 是訪客可修改的行銷來源資訊，不作為授權、付款或分潤依據。
- 圖片目前以網址提供；尚未新增素材庫或圖片上傳流程。
- 既有 GitHub Actions 已包含 push 的 ESLint 與測試，本次未修改 CI。
- 前次 checkpoint 曾因 `.git/index.lock` 權限不足受阻；本次接續建立本地 checkpoint，未 push。

## 接續驗證

- 再次執行 TypeScript 檢查，exit 0。
- 再次執行 10 個 targeted Vitest 檔案，共 101 項測試通過。
- 新增功能的 targeted ESLint：0 errors、3 項原生圖片效能 warnings；未停用規則。
- `git diff --check` 通過。
- 並發發布的唯一鍵錯誤已轉為版本衝突，並有 mock service 回歸測試；仍未宣稱真實資料庫並發驗證通過。
- 本輪未重跑瀏覽器驗證，前述截圖與瀏覽器結果為先前執行紀錄。

## 回滾方式

尚未套用 migration，可透過反向提交本次 checkpoint 回復程式。若之後已建立頁面資料，回滾應先停用入口並保留新增資料表；不得直接刪表或修改既有報名資料。
