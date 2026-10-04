# #210 LINE 圖文選單：草稿段落整合

來源：PR #210 `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`。實作基準：master `fc28e1b8dcdba9ca3926f11d27153de048f597da`。

## 可交付行為

店家擁有者在 `/settings/line` 可選 6 格或 4 格範本，編輯按鈕文字與連結、預覽、儲存、重新載入、修改及刪除草稿。讀寫均採登入店家，Server Action 先檢查 CSRF 與 owner；每個店家最多一份草稿，更新與刪除同時比對 ID 與 revision，拒絕過期分頁與刪除後重建的舊 reference。資料庫只有新增 draft table，啟用 RLS，沒有公開 policies。

原分支的範本與 bounds/URI contract 保留，新增 discriminated action validation、拒絕 URL credentials、文字空白檢查。預覽只呈現文字，不開啟使用者輸入的網址。草稿完整保存 size、selected、name、chatBarText 與 areas；原分支僅存 areas 而遺失其他設定的情況已避免。

## 衝突取捨與剩餘工作

保留 master 的 LINE encrypted credentials、推播稽核與 tenant scope；不覆蓋為舊版頁面。新的草稿表與 provider publication 分離。舊分支的 create/upload/set-default/delete 網路流程本次未開放，介面明確說明同步尚未開放。#210、#211 仍未整體合併。

後續同步段落需要：租戶級發布序列化/lease、先驗證草稿擁有權再呼叫 provider、provider 與 DB 狀態補償/重試、維持原預設選單直到 replacement durable、provider 回應驗證與 timeout、受限 PNG/JPEG 解碼、已完成學員入口才能解析 portal/voucher 等代碼。不得直接回收舊版 publish action；不得執行正式 LINE 操作驗證。

## 驗證與審查

- 本機單元/SSR：42 tests PASS；TypeScript 與 scoped ESLint PASS。
- 獨立 disposable PostgreSQL：原 82 migrations 成功套用，後續 RLS 修正 SQL 在同一合成容器套用；3 tests PASS，含並行建立、CAS、跨店家、ABA、RLS 與 cascade。最終 migration 的全新套用另由 CI 驗證。
- 新增 Playwright 真實互動測試至既有 smoke suite；本機 production build/start + 獨立資料庫實際執行 PASS（1 expected、0 skipped、0 flaky）；最終 head CI 待執行，此文件不預先宣稱通過。
- 獨立 Critical review 未發現 BLOCKER/MAJOR；RLS MINOR 已修正並由獨立複審關閉，無新 findings。安全檢查如上；效能為單列唯一索引與有界 JSON/20 個區域；完整 payload/schema 共用改善可維護性；失敗訊息不輸出內部資料。
- requested team=auto、effective=ai-team-pro；router resolved implementation=gpt-6.1-sol xhigh，review=gpt-6-astra high（Opus unavailable，critical_review_no_equivalent）；observed model/effort=unknown。主代理唯一 writer，唯讀 reviewer=/root/pr351_review，depth=1，active helper=1，dispatch=4。
- 原始 dirty checkout 未更動。未部署 Production、未呼叫 LINE provider、未存取正式資料。沿用既有每次 push/PR 執行 ESLint、unit/coverage、資料庫及 browser 的 quality CI，完成後經 canonical gate 與 protected squash merge。

## Migration inventory 相依修正

新增表後 canonical inventory 精確更新為 122 models／82 migrations；保留全清單相符檢查。歷史 staging replay 的 58／79 prefix 與 21 條重播不变，另明確檢查新候選總數 82 與 LINE migration 名稱。付款 staging adapter 維持原 79→81 DDL 授權範圍；用真實歷史來源驗證其原契約，新增測試要求完整 82 條來源必須 fail closed，不能偷偷套用 LINE migration。6 個 Node contract 與 5 個 Vitest inventory/adapter tests PASS；既有 adapter runtime 未修改、未執行外部 migration。

完整本機重現中 583 個 Vitest 檔案／4,210 tests 通過；找到 G7-55 歷史 browser runner 的另一份固定清單，精確更新為原 79 + 3 並列出三條 additive migrations，runtime 仍拒絕 82 條來源。11 個相關 Node contracts 已通過，獨立增量審查無 findings。Windows 文件 CRLF 造成的本機雜湊差異已核對 Git blob 並在本機恢復相同 LF bytes，Git 文件內容未變更；完整重跑與新 head CI 仍待結果。
