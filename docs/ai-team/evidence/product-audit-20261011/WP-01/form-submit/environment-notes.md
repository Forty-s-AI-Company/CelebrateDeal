# 執行限制與失敗保留

- 僅使用獨立 worktree、127.0.0.1:31024 與 goal-owned disposable PostgreSQL 127.0.0.1:64505/celebratedeal_ci。
- Next 僅注入固定合成設定；沒有讀取 .env 內容、列舉 secret、寄送信件或啟動 delivery worker。
- 第一輪 Next 程序提前終止，原因尚未證實。initial-* 保留 timeout 與已完成清理證據。
- 明確改用 Webpack / 4096 MB heap runner 後程序存活。webpack-initial-* 記錄第二次失敗：瀏覽器收到成功 HTTP 後 redirect 使 response.json 無法讀取；清理的 FunnelSubmission 外鍵順序錯誤。
- 最終腳本保留 HTTP200 assertion，改驗證實際跳轉與持久化 UNVERIFIED 狀態、Funnel provenance、queued delivery/zero attempts、重送去重。未降低資料驗收；沒有宣稱信件送達。
- 第二輪自建的 1 個殘留專案已依精確合成 slug prefix + fixture name 查找，先刪除其專屬 email delivery/FunnelSubmission，再移除自建報名、頁與專案；清理成功。未操作其他資料。
- 這份 evidence 不等同整包 WP-01 READY；仍須重新核對整包 scope、來源 snapshot 與 acceptance。
