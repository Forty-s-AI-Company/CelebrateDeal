# WP-20 事件契約盤點（唯讀）

狀態：受影響指標 WAITING_AUTHORIZATION；未改事件寫入或產品程式碼。

| 指標 | 已觀察來源 | 不能直接當成要求指標的原因 |
| --- | --- | --- |
| 報名率 | FormSubmission 的總數/VERIFIED 數；目前 analytics page 的 admitted page_view | page_view 是已取得播放 session 的瀏覽，不是報名前報名頁的獨立訪客分母；不能將既有漏斗百分比重新命名為報名率 |
| 到場率 | AnalyticsEvent.visitorId 為 viewer token hash；verified form submissions | session 與報名者沒有穩定可核對 join；多 session 不能當多位報名者 |
| 完看率 | play_progress 固定 30/60/120/300/600 秒 checkpoint | 沒有播放完成事件、精確個人累計或已核准完看門檻；十分鐘 checkpoint 不能當看完整場 |
| 平均觀看時長 | StreamUsageLedgerEntry.watchSeconds | ledger 目前 create data 未写 viewerKeyHash/customerKeyHash；個人分母與重疊/重播語意不完整。既有 aggregate 可證明用量，不能直接當每人平均 |
| 看完下單率 | 付款 metadata sourceLiveId/formSubmissionId，可歸屬場次 | 缺少可連接到同一報名者的完成觀看事件，不能把場次訂單率稱為看完下單率 |

核對來源：src/app/api/analytics/route.ts（admitted guard、payload allowlist、visitor identity）；src/components/live-playback.tsx（checkpoint）；src/lib/stream-usage.ts（ledger create）；prisma/schema.prisma（AnalyticsEvent、LiveViewerSession、FormSubmission、StreamUsageLedgerEntry）；src/app/(app)/lives/[id]/analytics/page.tsx（現有查詢）。沒有查詢真實客戶／付款資料。

需要 owner 核可：報名者/訪客/session 的分母定義、live/replay 時窗、完看門檻，以及穩定身分連接與完成/時長事件的資料契約。若要補事件寫入，超出 WP-20 原 scope，須另提精確範圍與重路由；現階段不新增寫入、不捏造比率。可先呈現「不可計算＋缺少資料原因」，但不能將這種呈現標成五項指標都已實現。
