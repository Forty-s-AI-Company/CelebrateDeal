# Streamed not-found 與 D-1 驗證

本機 Next.js `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md` 明示串流 notFound 可回 HTTP 200。`loading.md` 說明 root loading 包住巢狀 layout，若要嚴格 HTTP404，須在串流前完成資源檢查；可在 proxy 回應。

現有 `src/app/loading.tsx` 是全站 boundary。禁止為局部 Funnel 修正移除全站 loading；也不以新語意測試覆蓋嚴格 HTTP404 失敗。原 `browser-smoke.cjs` 及 browser-result.json 保留 FAIL。

外部 reviewer `review-cli.json` 的 MAJOR 尚未解決。新增 semantic-browser 只證明商家原因、匿名不可見內容、noindex、正常表單呈現、多步驟及取消發布即時更新，不能證明嚴格404。

下一步評估 `/lp/*` 專用的串流前檢查：只在 GET/HEAD 讀既有發布／資源條件，與公開 loader 共用判斷，避免改 gate、避免跨租戶資訊與全站 loading 變更；評估 DB 查詢成本與短暫失敗503。若採用，精確新增 scope、tests 與獨立深度 review；本輪尚未修改 proxy。

未執行正式部署、外部排程或正式資料查詢。其他不依賴 D-2～D-6 的工作仍可持續。
