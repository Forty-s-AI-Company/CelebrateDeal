# G7-22 Merchant onboarding ready-media checkpoint

日期：2026-08-09

封存時間：2026-08-09T02:24:37.7795990Z

狀態：`ACCEPTED_LOCAL`。本工作修正商家 onboarding 將「沒有可播放媒體的直播」誤算為可販售直播的 P1 launch-readiness 問題；沒有執行外部服務、正式環境或真人簽核。

## 產品問題與修正

- onboarding 原本只檢查直播狀態、商品、表單、Email 與互動腳本。直播即使沒有影片或媒體仍在處理中，也可能顯示 `5/5` 與 launch ready。
- sellable-live 查詢現在要求同商家、符合既有 `liveReadyVideoWhere` 的可播放媒體關聯。
- 候選結果再經 `isLiveVideoReady` 做 application-level 判定，避免只靠資料庫查詢宣告完成。
- Cloudflare URL、Stream ready 與 server-created Live Input 的既有可播放條件保留；缺少媒體或 processing 狀態維持未完成。
- onboarding 說明文字明確告知商家，第一場可販售直播需要可播放媒體。

## Ownership

- 本工作只涉及 source manifest 列出的四個 production／test 檔案，以及本 evidence、report、manifest 與後續 digest／index。
- worktree 原本已有大量未提交變更；沒有 reset、clean、stash、restore、checkout 或 rebase。
- 沒有 stage、commit、push、merge 或 deploy。

## Deterministic evidence

- Vitest：`3 files／10 tests PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- 測試涵蓋 ready-media query、缺少影片、processing 影片、URL／Stream／Live Input ready，以及 onboarding 缺少媒體時維持 `4/5`、`80%`、非 complete。
- scoped ESLint：`PASS`，exit code=`0`。
- scoped `git diff --check`：`PASS`，exit code=`0`。
- source lineage 與 SHA-256 收錄於 `.ai-team/reports/g7-22-onboarding-ready-media-20260809.json`。

## 尚未完成與人工 blocker

- 本工作沒有執行正式 Cloudflare 媒體、staging 或 Production；可播放條件沿用既有 provider readiness domain 與 deterministic fixtures。
- CAT04 的 PayUni Sandbox／staging 證據與 CAT10 的真人簽核仍維持獨立 blocker，不影響後續功能工作。
- 沒有需要使用者立即處理的事項。

## 分數判斷

- 固定功能 `商家 onboarding／設定` 維持 `8.0/10`。此修正關閉 P1 false-positive，提升分數可信度，但沒有足夠的新能力支持再加分。
- canonical 維持 total=`73.5`、CAT04=`6.0`、CAT10=`4.5`；本工作不冒充外部或真人證據。

## 回滾範圍

- sellable-live 的 ready-media relation query 與 application-level readiness 判定。
- onboarding launch step 的可播放媒體說明。
- 對應 readiness 與 onboarding tests。

## 下一個最高價值工作

完成 G7-21 Email 排程與直播提醒證據封存後，盤點已驗證報名者在直播排程、提醒模板或 offset 變更時，既有 reminder delivery 是否能安全更新。若現況未涵蓋，優先補 durable reconciliation、冪等 revision 與操作回饋。
