# 使用者可見詞彙表

講師與買家看到的畫面不使用工程術語。下表是「工程詞 → 畫面用語」的對照；`src/lib/ui-copy-glossary.test.ts` 會掃描 `src/components/**` 與 `src/app/**` 的可見字串，出現左欄詞彙就會失敗。

| 工程詞 | 畫面用語 | 備註 |
|---|---|---|
| provider／payment provider | 付款服務（金流）／影片服務／串接服務 | 依語境選擇 |
| reference（付款方式 reference） | 付款方式紀錄 | |
| ledger／append-only／immutable | 帳目／只增不改 | 避免直接說 ledger |
| session（登入） | 登入狀態 | 「撤銷 session」寫成「結束登入狀態」 |
| 播放 session／admission | 觀看人次／成功進入直播間 | |
| F／G 分潤 | 課程分潤 | 課程內容所有人、課程推廣者；欄位只在選「課程」時出現 |
| basis points | 萬分比 | 並附例子（2000 = 20%） |
| slug | 網址 | |
| webhook | 系統通知 | 僅 LINE 設定頁保留英文並加說明 |
| payload | 原始資料 | |
| token／Access Token | 登入憑證／連結碼 | LINE 設定頁因對照 LINE 後台保留 |
| ref 追蹤 | 推薦連結來源追蹤 | |
| VOD／Live Input | 預錄影片／即時直播 | |
| streamKey／streamKeyRef | 直播串流金鑰（不顯示給講師時整段拿掉） | |
| fail closed／heartbeat | 不使用，改寫成結果 | 「額度用完時會暫停播放」 |
| release gate／release owner／SLA | 上線前確認／上線負責人／回覆時限 | |
| Workspace | 商家工作區 | |
| CTA | 按鈕 | |

## 例外

- 平台營運人員專用的 `src/app/admin/**`、封測期間隱藏的 `src/app/(app)/billing/**` 與 `src/app/(app)/affiliates/**`，暫列於測試的 EXEMPTIONS（含理由），開放給講師前要一併改寫。
- LINE 官方帳號設定頁需對照 LINE Developers Console 的英文欄位名稱，保留 Webhook／Provider／Token 並附說明。
- 單行例外可在該行或上一行加註解 `glossary-allow: 理由`。
