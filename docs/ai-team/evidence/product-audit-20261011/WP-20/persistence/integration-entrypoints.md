# WP-20 應用程式整合入口與待辦

- 已閱讀本機 Next.js route handler 文件：node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md。
- 現有 admission 入口：src/app/api/live-admission/route.ts；token hash、active scope 檢查與 release 在 src/lib/live-quota-admission.ts。release 刪除短期 LiveViewerSession，因此歷史 metric session 僅保留 immutable provenance，不能 FK restrict/cascade 該來源。
- 已驗證報名 cookie 機制：src/lib/form-submission-chat-session.ts；聊天路徑從 src/lib/live-chat.ts 解析 claim，再檢查資料庫身份。統計不得信任 client personId；需要重用已驗證 claim 與 tenant/live/form/verifiedAt 綁定。
- 現有 API 同源／body 限額：src/lib/api-security.ts；限流依既有 trusted-entry-rate-limit 路徑。不要因分析資料而放寬既有安全檢查。
- 已新增 interval ingestion HTTP API，server 以報名憑證與 admission 綁定 session；重送檢查與寫入採同一交易，取得來源與 session 鎖後再複查 canonical authorization。詳見 ingestion-http evidence；不代表整包驗收。
- session issuance 已有 HTTP 入口：browser 只提供 UUID requestId，canonical runtime 決定 live/replay，stored source fingerprint 與 duration 必須符合既有 enabled version。鎖定 Live → FormSubmission → admission → Video → version，來源與 session 鎖等待後再次選版及授權。未找到合法版本就拒絕收集，不建立或啟用版本。resolveLiveRuntimeWindow 共用 canonical 判斷，將 session 截止時間限制於已知直播／重播期限；未知結束時間的 live input 仍須逐批複查。
- session issuance 已驗證重送／並行去重、跨 tenant/version、撤銷、過期、collection disabled、來源更換、server anchor、verification precision。每 admission 上限 16 open／64 total，每 registration/version 上限 256 total；舊 key 重送不新增額度。累計達上限回 terminal 409，open 額度暫滿才回 429 與 Retry-After。這是資源上限，不是正式 retention policy。
- 尚未完成：interval HTTP 也需複查目前 content fingerprint／mode，並實作 close/finalSequence；非正式版本 provisioning 與匿名瀏覽／報名歸屬、player 補送／結束、bounded worker、read adapter、UI、瀏覽器完整對帳。Fingerprint 辨識儲存的來源設定，不宣稱驗證遠端 media bytes。此文件只定位下一階段入口，不是測試或驗收證據。


## 最新整合狀態
- interval 已重新驗證 content/mode，close/finalSequence 已實作；上述「尚未完成」列為歷史定位，請以本段與 handoff 最新 checkpoint 為準。
- player 已接 collector/HTTP transport，pause/ended 尾段取樣通過本機 Chromium synthetic-video smoke；尚非完整 Next app/DB E2E。
- admission release 已比對 server-issued id/expiry，避免舊 release 刪續租資料；同 document owner registry 抑制 stale cleanup。跨分頁完整 ownership 尚未驗收。
- report lease 應用程式入口：src/lib/live-metric-report-lease.ts。只包裝 guarded claim/finish 並驗證 aggregate；尚無 bounded reader、isolated executor 或 scheduler，不宣稱已移除同步大量計算風險。
- 仍待：RTT uncertainty 的持久化與報表語意、第一方訪客／報名歸屬、非正式版本 provisioning、bounded worker/read adapter/UI、完整 browser/DB 對帳及合格深度審查。
