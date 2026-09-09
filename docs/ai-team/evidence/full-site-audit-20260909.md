# 全站程式審查、開發資料遷移與執行驗證

基準：43d5f27e。使用者要求 ai-team-pro 全站審查與修復，並明確要求保留既有開發資料。全站入口盤點：204 個 page.tsx／route.ts。此數字是入口清單，不代表每個登入角色與外部服務都已逐一實測。

本輪已確認缺陷與本地驗證失敗均已修正。最終應用 build、typecheck、ESLint、secret scan 通過；完整瀏覽器套件發現的 7 項失敗，在後續定向回歸中全部通過。既有開發資料已備份並遷移，2 筆舊報名的新版觀看權限對應仍保留待確認，未自行創造付款或授權紀錄。

## 已確認問題與修復

| 問題 | 修復／驗證範圍 |
|---|---|
| 開發庫缺少 TrackingSetting.facebookAccessTokenEncrypted | 實際資料庫只有 61 個既有表且存在 legacy 課程／通知結構；採備份、副本演練、資料守恆檢查，禁止直接刪表同步。 |
| 報酬 dialog 將 next/headers 引入 client bundle | 由 server page 傳入 CSRF React slot；真實 webpack build 重現，測試確認隱藏欄位仍在表單內。 |
| 加購頁將 node:crypto 引入 client bundle | 純顯示 formatter/type 拆至 post-purchase-offer；簽章與金鑰仍保留服務端，增加竄改 HMAC 測試。 |
| payout route 匯出 Next.js 不接受的 csvCell | formatter 移至純 lib，route 只保留合法 handler；typecheck 加入 next typegen，涵蓋 route 匯出契約。 |
| 兩個 use server 模組匯出狀態物件，頁面載入失敗 | student portal 與 team live share 初始狀態移至純契約模組；新增 AST 測試保護全部 37 個 Server Action 模組。 |
| 課程進度被延遲請求覆蓋；秒數／完課時間分開更新可能部分寫入 | 同一交易內條件式遞增觀看秒數、completedAt 只從 null 寫入；首次建立 P2002 在交易回滾後重試一次，不沿用 aborted transaction。 |
| 播放器 90% 後反覆送出請求，等待中播至結尾又會漏送完課進度 | 每單元一個 pending request，合併最新秒數與手動完成旗標；onEnded 補送最後區段，捕捉網路錯誤。 |
| 社群第 101 則留言永久不可見 | 預設最新 100 則，使用 tenant/post-bound 游標讀舊留言；非法游標阻擋。 |
| 購買提示輪播與卸載後回寫 | 修正單筆循環、背景輪詢重置動畫與取消過期請求。 |
| Pro model/profile/provider 不一致 | Astra worker 使用 astra_worker，planner 使用 native provider；low/high/pro 各 8 個 router tests。 |
| 全域 lint 23 errors | 保留門檻，以局部 helper 提取及 React 狀態生命週期修正通過。 |
| 推廣者小額待領款讓整個後台 500 | NT$12 小於 NT$15 固定手續費，原計算拋負實領例外；頁面保留餘額並說明不可提領，server 同樣阻擋零／負實領申請，歷史款不重算現行稅額。 |
| 完整 Browser axe 發現互動腳本與直播編輯頁無障礙缺陷 | 針對預覽元件非法 aria-label role 與低對比字色局部修正；保留 critical/serious 零違規斷言。 |
| Browser 測試沿用舊提領流程／文字與模糊定位 | 更新身分建檔、同意簽署與勞報金額快照斷言；保留小額款 regression fixture，異租戶款採可正常提領金額以真正驗證 IDOR 阻擋。Email／轉換漏斗改精確匹配，佣金結算可見及不可見斷言同步現行標籤。 |
| 權限清單仍只認得 75 頁與舊 guard | 逐頁核對 81 頁，增加精確 path → guard 清單與 ManagerContext 角色驗證；新頁涵蓋諮詢、CRM、電子發票與功能設定。僅測試商家明確啟用對應模組，以驗證實際角色 guard。 |
| 前輪加購測試 fixture 不符真實 DB 約束 | 使用 43 字元 base64url identity hash，商品單價／數量／小計一致；本輪真實 migration DB 的 5 項測試通過。前輪聲稱的 5 項 DB 通過無法以原 fixture 重現，已撤回其證據效力。 |

## 遷移邊界與保存

目標僅本機 Docker `celebratedeal-postgres` 中的 `celebratedeal_dev`。不開啟或輸出 .env 內容、資料列、PII 或金鑰。`pg_dump` 在容器內建立完整備份，再 restore 到獨立演練庫；最終操作前備份 `/tmp/celebratedeal-dev-immediately-before-upgrade.dump`，另保存於忽略版控的 `.ai-team/tmp/celebratedeal-dev-before-upgrade.dump`，SHA-256：`A2ACF1CEFE4DD8DDBDB6D777012556DB5089464D34406CFC0FA448B2096A05FD`。

橋接在單一交易內記錄每個原始表所有原始欄位的 row checksum 與筆數，驗證一致才 commit；保留所有舊表／舊欄位，status 原位轉型保留狀態。回填同租戶 LiveProduct、CourseLesson 與影片；歷史商品不默認確認實體履約；佣金採 canonical identity 與 opening ledger backfill。額外補回 migration 中的 check constraints、functions、triggers 與 partial unique indexes。

第四演練副本與實際開發庫均完成橋接並 COMMIT；Prisma 差異只剩保留的 legacy 結構，沒有缺失的現行 table／column／index／FK。現有 130 個表（含 8 個保留 legacy 表與 migration history）、136 個 check constraints、17 個應用 triggers。Prisma 認列 79 個現行 migration 全部 up to date；另保留 20 個歷史 migration 名稱。history 明確標示 bridge baseline，並未宣稱逐一重播歷史 SQL。

2 筆 confirmed/course_page Enrollment 原樣保留；尚未獲得付款或既有觀看權限證據，未創造付款紀錄或新觀看權限。既有資料保留／結構遷移已完成，這兩筆的新版權限對應仍待業務確認。

一次性橋接 SQL：[full-site-local-dev-bridge.sql](./full-site-local-dev-bridge.sql)，SHA-256：`35BA6F344214000BACB2FBBCFAA0C08C061FDA91FAAB80CD286DD0B61195F985`。回滾方式是將上述完整備份還原到新的本機資料庫並切換本機連線；不對現有庫執行刪除或覆寫。AGY Claude 對 bridge generator 的窄範圍複審實際回覆 `REVIEW_COMPLETE NO_P0_P1_IN_SCOPE`，其信任的補充 SQL 不在該次複審範圍內。

## 驗證紀錄

- 初次完整 Vitest：568 files，4057 passed／5 failed；5 項失敗為上述 fixture，修正後定向 5/5 通過。
- 第二次完整 Vitest：570 files、4066 tests 全數通過；924 項 Node TAP 契約測試全部通過。之後 route/state/player 修正另以相應回歸測試驗證，未把這次全套結果宣稱成更晚版本的全套執行。
- 第三次完整 Vitest：570 passed／1 conditional skipped files，4073 passed／1 conditional skipped tests（485.13 秒）。條件項是既有 `RT01_D2_DISPOSABLE_DB` opt-in 的真實聊天競態測試，另以本機測試庫、明確開啟旗標與固定合成簽章金鑰執行，1/1 通過。後續小額款修正另有 22 項定向測試通過；沒有新增 skip 或降低任何門檻。
- 第一次／第二次 webpack build 分別重現 CSRF server import 與 node:crypto client import；後續還找到 route／Server Action 非法匯出，均已修復。最終應用來源的 `next build --webpack` 完成編譯、型別、153 頁產生與輸出追蹤，exit 0。
- 各代理 targeted tests：401、104、15、9、7、64 項，非互斥集合，不加總成全套測試數。
- 原生 reviewer 校核遷移指出商品／影片回填缺漏，已補正；未將保留 Enrollment 誤稱成新 portal 權限自動延續。
- 後續獨立原生複審確認課程進度非交易寫入 P2，已以交易修正並通過失敗回滾回歸；結帳／佣金 helper 提取未發現金額或授權語義差異。
- 隔離 production-mode webpack build 已成功；30 項 Chromium smoke 全數通過（1.3 分鐘）。瀏覽器測試使用隔離副本與 loopback 31033、`celebratedeal-pro-audit` 測試庫的 `pro_audit_migrations` schema，僅合成資料／固定測試金鑰；未使用互動開發庫當測試清理目標。
- 完整 Chromium 套件：142 項執行，135 通過／7 失敗（9.9 分鐘），包含無障礙、效能、跨租戶／角色矩陣、付款回呼、退款／發票、買家 PII 投影、恢復付款與直播播放不中斷。7 項失敗均已定位；修正後定向重跑失敗與受影響測試，結果另記，不把原失敗覆寫為全套一次通過。
- 修正後 16 項定向 Browser：14 通過／2 失敗；兩項為分析頁的舊標題及 guard fixture 未啟用諮詢。再修正後，分析／PII 遮罩／異租戶 canary 1/1 通過（5.1 秒），81 頁 guard 矩陣 1/1 通過（18.4 秒）。未刪除、略過或放寬原本的權限與敏感資料斷言。
- 最終 `npm run typecheck`、`npm run lint`、`npm run secret:scan` 全部 exit 0；lint 零警告。`.ai-team/tmp` raw logs／備份不提交，公開證據為本報告、合成回歸測試與不含資料列的橋接 SQL。
- 互動式 `npm run dev` 的 `/`、`/login`、`/api/health` 實際回傳 HTTP 200，使用遷移後的開發庫。
- GitHub Actions 既有 `.github/workflows/ci.yml` 已於 push 執行 ESLint、單元／coverage、契約與 Browser gate，本輪保留其驗證門檻。
- 最新課程交易修正版經 AGY `claude-sonnet-4-6`／`model-default` Thinking 實際複審；三項候選經補上 Schema、全域 lesson 主鍵、交易最後重讀與同客戶資格邊界後，Claude 逐項 `RETRACTED`，結尾 `REVIEW_COMPLETE`。此結果只適用於該課程交易與權限範圍，不把工具程序 `PASS` 等同全站無漏洞。
- 小額提領 guard 的追加 Claude 複審實際回覆 `REVIEW_COMPLETE NO_FINDINGS_IN_SCOPE`，原費率、扣繳政策與簽署要求未更動。

## 前一輪 Claude 審查補記

43d5f27e 提交後，AGY `claude-sonnet-4-6`、model-default Thinking 實際回覆核心修補 diff review；後續針對三項候選提出交易／呼叫點／整數公式證據，Claude 回覆 REVIEW_COMPLETE 並撤回三項 finding。這是該次金流、加購與稅額的窄範圍複審，不是本輪全站簽核。前份報告未即時補記，先前「報告包含最新 Claude 結果」的說法不精確。

本輪未執行正式服務、實際寄信／付款、部署或全量 coverage 收集；既有 CI coverage 門檻未變。本地通過範圍不代表正式環境或所有可能使用情境均無缺陷。
