# WP-04 staging 排程接續範圍

狀態：獨立 Preview 曾完成遠端 build 與目標路由修復驗證；因資料隔離未證明且 staging 使用 PayUni 正式金流，新舊兩個 Preview 已在取證後移除。排程與送達仍未建立／驗證。原20WP目前10/20。本文件只處理原WP04，不新增共用runner、scheduler平台或監控框架。

## 已確認的本機來源

- `vercel.json` 沒有 crons；`vercel.staging.json` crons 為空陣列。
- `docs/launch/staging-cron-operations.md` 記錄 staging 使用 Hobby，每分鐘Cron曾遭部署驗證拒絕；這是既有紀錄，不是本輪查到目前帳號方案。
- `.github/workflows` 未找到 schedule/cron 宣告；無法據此斷言外部排程不存在。
- Vercel官方文件指出內建Cron針對Production deployment執行，Preview不會因放入cron配置就自動註冊。Hobby的每日限制不足以支援開播前提醒，不能改每日一次只求部署綠燈。

## 既有唯一協調入口

`POST /api/jobs/email-deliveries`：使用既有 `JOB_SECRET` 驗證。`GET` 是不同的 `CRON_SECRET` 邊界，不能混用或把端點公開化。

現有處理順序包括提醒cutover、到期直播通知、直播後追蹤、提醒reconciliation、Email派送、LINE materialization及LINE派送。`GET /api/cron/line-notifications`也會materialize及派送LINE；新增排程前應核對現有外部排程，對相同queue僅指定一個協調排程，不同來源遺留重疊須先移交，不另造第二套流程。

## 最小設定單（不含任何Secret值）

| 項目 | 所需設定／狀態 |
| --- | --- |
| 目標 | 經來源、非Production資料隔離確認的固定staging deployment，精確origin與固定POST path；目前未完成新排程目標認證 |
| 週期 | 候選每分鐘一次，UTC；先確認承載服務能滿足提醒時效，不自行改每日／每五分鐘 |
| 驗證 | 由平台secret provider注入既有job憑證；不讀.env*、不在設定單／命令／紀錄顯示憑證 |
| 同時執行 | 單一排程協調者；前次尚在跑時不另啟動相同工作，不在結果不明時盲目重送 |
| 保護 | 不追隨到未知主機的redirect；非預期401/403/redirect/503保持失敗，不以訪問Production繞過 |
| 起始狀態 | 先停用，核對重複來源、實際資料隔離與合成收件端，再啟動非正式排程 |
| 範圍外 | billing-cycle、正式扣款／退款、正式寄信、Production排程與資料庫操作全部不執行 |

## 心跳與驗收證據

沿用所選scheduler自身的執行紀錄與告警；目前還沒選定或驗證承載服務，不把文件當已啟用心跳。記錄固定job名稱、環境、開始／結束UTC時間、HTTP狀態、成功／失敗與必要的分類計數即可，不輸出請求header、原始response、recipient、payload或外部憑證。

HTTP200/ok=true不是送達證據：既有job回傳sent/failed/exhausted/suppressed等結果。判斷呼叫心跳與通知送達要分開，且只摘錄白名單分類。除本次執行結果外，須有下一次預定執行與缺失告警，才可宣稱排程持續運行；單次手動POST不是排程驗收。

原WP04驗收仍要求：固定Sandbox合成報名確認信與開播提醒有收件回執、時區正確、去重、失敗可見、重複排程排除及健康訊號。LINE／SMS供應商仍需各自實際能力與合成收件範圍，不用虛構送達。未執行項全部NOT_RUN。

## 復原

停用僅本WP新增的非Production schedule，保留必要分類回執與排程id；先核對是否有執行中工作，不刪除訂單／通知來源資料。沒有註冊的外部排程不宣稱已停用；不取消未知既有排程，不回退其他WP或使用者變更。

Preview deployment 的停止條件已成立：資料隔離尚未證明，staging 已確認使用 PayUni 正式金流，而且 edge deny 的規則、持續性與區域覆蓋都無法由目前方案查明。`dpl_GqfZQyS5N8EEFZDuywaqFhpnpXPS` 另缺少必要路由。依此條件，已用明確 deployment hostname 與 team scope 移除新舊兩個 Preview；兩次 remove exit code 均為 0，移除後兩次 inspect 均以非 0 回傳不存在。沒有移除或修改 staging 的其他 deployment、alias、正式站或資料。

唯讀 `vercel alias ls --scope a25814740s-projects` 沒有找到兩個精確 deployment hostname 的 matching alias，之後兩個 deployment 均已移除。Firewall overview 因目前方案權限回傳 402，無法識別實際規則；因此只記 `EDGE_MITIGATION_BLOCKED`，不把它推測成主機權限問題，也不嘗試關閉保護。排程前置條件新增：必須以最小路徑規則允許 scheduler request，同時維持其餘保護，而且先完成資料隔離與重複排程檢查。

為執行唯讀 Firewall 查詢，Vercel CLI 曾在獨立 Goal worktree 建立 `.env.local` 與 `.vercel` link metadata；沒有讀取或輸出 env 檔內容。查詢結束後已移除該 env 檔與經路徑檢查的 `.vercel` 目錄。

## 官方來源

- https://vercel.com/docs/cron-jobs
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/cron-jobs/manage-cron-jobs

## 2026-10-16 實際平台盤點補充

以 Vercel CLI 58.4.4 唯讀查明目標 `a25814740s-projects/celebrate-deal-staging`，project ID `prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn`。獨立worktree未連結，初次context檢查回link_required；未建立link，改以已知名稱查明project後，使用明確ID與scope列Cron。

實際回傳 `crons=[]`、`undeployed=[]`、`modified=[]`、`enabled=true`，exit0。這證明當時該Vercel專案未註冊任何Cron；enabled=true不代表有排程。既有deployment `dpl_6Nq2X1U9GDs5QVek7dTcdpmPM1hJ` target=preview、Ready，但不代表含目前修改或通知DB已隔離。

未查其他平台的external scheduler，不能斷言所有平台皆無排程；帳號當前方案也未查證。未讀Secret或env內容、未建立專案連結、未觸發job、未註冊Cron、未部署、未改alias。實際心跳與合成收件仍NOT_RUN。Evidence：`docs/ai-team/evidence/product-audit-20261011/WP-04/vercel-scheduler-live-inventory-20261016.json`。

## 人類發票／SMS決策後的唯讀重查

2026-10-16重新以相同明確project ID及scope執行Vercel Cron唯讀盤點，仍為0筆registered／undeployed／modified，enabled=true；不從此推論其他平台沒有排程。來源收據：`docs/ai-team/evidence/product-audit-20261011/WP-04/vercel-scheduler-recheck-after-decisions-20261016.json`。沒有觸發工作或修改平台設定；資料隔離、其他平台重複排程、固定Sandbox合成收件／注入方式、持續心跳與實際送達仍未驗證。

人類已說明staging與正式站皆走PayUni正式金流，staging方案價NT$1／2／3；不得以網站名稱或低價當作付款Sandbox。發票已選未開放分支、SMS已選EVERY8D＋額外點數而先不實作，不再將這兩個方向當成未回答的問題。WP04剩餘是上述實際環境／資料／通知驗收，非重新要求非Production開發許可。

後續人類已指定測試Email為a88221144@gmail.com，僅供合成通知驗證；不再等待選擇Email收件地址。LINE帳號公開資訊、Messaging API狀態／既有Webhook使用情況與安全注入尚待確認。此更新沒有寄信、LINE推播或改動外部服務，環境／資料隔離與實際送達仍未驗證。

## 2026-10-16 獨立 Preview 部署結果

依人類已核准的獨立 Preview 範圍，使用明確 project ID／team scope 建立修正版 deployment `dpl_8TvGjjmYQgKMNfSgU8oPjTXXtmxc`，target=`preview`，移除前 ready state=`READY`。部署來源是上傳當時獨立 Goal worktree 的未提交狀態，內容沒有保存 manifest，`efb8b7e9` 只代表基底；不能宣稱後續本機 revision 等同該遠端成品。Next.js production compile、TypeScript、189 個 static pages 通過，Vercel 遠端輸出共 570 項，並確認 `api/funnel/operations/reports` 與對應 RSC 路徑存在；build preflight 只證明必要設定名稱與靜態隔離斷言存在，未讀取或保存值，也未證明 runtime DB／資料隔離。

最初封包因本機 `.next` cache 單檔超過 100 MB 被拒；首次成功部署 `dpl_GqfZQyS5N8EEFZDuywaqFhpnpXPS` 又因 `.vercelignore` 的 `reports/` 未錨定根目錄，誤排除巢狀報表 API。該部署列為 superseded，不作驗收依據。修正為 `/reports/` 等 root-only 規則後重新部署，沒有刪檔或改產品路由，且遠端路由已恢復。

修正版部署完成後，以 Vercel CLI authenticated request 重查 `/api/health`、政策頁、`/settings/line` 與 `/projects`，五個回應仍皆為 403，且各自帶有 `X-Vercel-Mitigated: deny` 與 `hkg1` request region；因此 runtime routes、登入與 policy 內容仍標 `EDGE_MITIGATION_BLOCKED`，不寫 PASS，也不關閉保護或繞過 Firewall。只保存白名單分類欄位，未保存 Cookie、認證 header 或 response body。

這次部署前沒有保存完整的上傳檔案 manifest，因此 deployment ID 能定位遠端成品，卻不能反向證明它等於後續受審查的本機 revision；不補造事後 hash。封裝修正只標 `TARGETED_PASS`：證明先前遺失的報表 route 已恢復，不宣稱已完成全部 local-to-remote route manifest 比對。

同次重新確認 staging project 的 Cron 仍為 0。Vercel 官方文件（2026-09-16 更新）明示 Vercel Cron 呼叫 production deployment URL；本次授權與實際部署均為 Preview，所以不能把現有 Preview 當作持續排程。WP-04 仍缺：一個固定非正式 scheduler target、資料隔離確認、重複排程排除、至少兩次持續心跳，以及合成 Email 收件回執；LINE 實際送達另依測試帳號綁定狀態驗證。Evidence：`docs/ai-team/evidence/product-audit-20261011/WP-04/preview-deployment-20261016.json`。

上述兩個 Preview 已於證據收集後移除，因此目前不存在可供排程使用的 Preview target；build 與 targeted route 結果只作歷史證據，不代表 runtime 或 WP-04 通過。
