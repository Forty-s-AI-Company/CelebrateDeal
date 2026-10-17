# WP05 返回路徑與舊錯誤網址修復

- UI-7：步驟頁使用 canonical page.slug / step.path；現有 slug 與 step 契約限 ASCII 英數及連字號，不新增非 ASCII 路徑能力。混合大小寫入口回歸通過。
- UI-8：空 redirectTo 與未指定時皆使用來源頁，明確指定仍保留。
- UI-3：無有效草稿時，提示「無法確認先前的送出結果」，不由網址推定失敗；提醒先查確認信避免重複。有效草稿維持原始錯誤。未實作一次性 flash。
- UI-5：既有 effect 在 Chromium / Firefox JS 失敗流程將焦點移到 alert；未執行人工 AT，不宣稱無 JS 自動報讀或欄位級錯誤關聯。

## 驗證

snapshot-ui-path-repair.json：原四檔 unit / lint / typecheck PASS。
snapshot-ui-feedback-repair.json：七檔 unit / lint / typecheck / browser-ui-feedback PASS；瀏覽器四案例涵蓋 JS/noJS 回填、成功、單筆資料、草稿清除、無寄信、分享假成功網址、分享及重整無草稿錯誤網址；JS另驗 alert 焦點。
本輪沒有重跑所有 Funnel / partner 入口，不移植舊完整矩陣為新驗收。最新獨立審查未執行，WP05仍IN_PROGRESS。

## 隔離與回滾

只在既有獨立 worktree 寫入；本機127.0.0.1:31026及固定 disposable PostgreSQL 64506，合成資料並清除本輪fixture。無正式寄信、正式資料或部署。只反向本輪 sourcePath、redirectTo、提示與對應測試patch，保留先前修復，不執行整檔 restore。
