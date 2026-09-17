# CelebrateDeal 自動化 Webinar Funnel

## 產品範圍與參考差異

實作前已閱讀 `systeme-reference` 全部九份 Markdown。systeme.io 只驗證過四種 Goal 入口；Webinar 建立被帳戶方案阻擋，未驗證其預設步驟、模板、排程或播放行為。以下是 CelebrateDeal 自行定義的行為，不宣稱 Webinar parity；不採用參考站配額、品牌或方案限制。

四種 Goal 同時可用：建立名單、銷售、自訂、自動化 Webinar。Webinar 建立四個步驟：`registration`、`thank-you`、`broadcast`、`inactive`。前三個可改名稱、URL、模板、內容與排序；Inactive 保留既有系統頁的唯讀與固定尾端規則。每一步均保存獨立 PageDocument，模板展開為一般節點。必要三種步驟須各一個才能發布。

## 既有能力盤點與整合

| 能力 | 既有入口／資料 | 本次使用方式 |
| --- | --- | --- |
| Landing Page | LandingPage draftContent、immutable LandingPageVersion | 沿用儲存、版本比對、發布、取消發布與回復，不新增資料表 |
| Funnel editor | FunnelStepPages、PageDocument、頁面／流程 history | 四頁獨立內容、Undo/Redo、Save/reload、模板替換 |
| Registration Form | 同 vendor/project 的啟用表單、既有欄位 schema | 真實表單欄位，POST `/api/form-submissions`，不自建名單寫入通道 |
| Live | 同 vendor/project 的既有 scheduled/live/ended 場次 | 綁定外層 draftLiveId；表單必須等於 Live.formId |
| Video | Live.videoId、影片 readiness | 選單只提供目前專案 Live 已綁定來源；影片無 projectId，透過 Live 限定專案 |
| 公開播放 | `/live/[slug]` 與既有 admission／播放檢查 | 伺服器 handoff 路由重新檢查後導向，不輸出媒體 URL 或憑證 |
| 常青排程 | `evergreen-webinar.ts` 的 JIT／每日場次及 Live Studio | 保留原有獨立能力；本次 Funnel 使用固定場次導向，不自行產生 cohort 或假 Live |

## 時程與公開行為

`flow.webinar` 保存 IANA `timezone`、UTC ISO `startsAt`、`endsAt`、`replayEndsAt`。日期可以是 null 以便先保存草稿；無效時區、非 UTC 日期與逆序區間會被拒絕。發布需要開始與結束時間。重播截止留空表示不提供 Funnel 重播入口。

狀態區間為左閉右開：開始前 waiting；開始至結束 live；結束至重播截止 replay；之後 expired。未設定或未授權資源為 missing。預覽與公開頁共用 `FunnelWebinarExperience` 及原有 `FunnelPageDocumentRenderer`，支援 desktop/mobile；預覽不送出報名。

這些時間控制 Funnel 入口，並不改寫 Live 的場次、觀看權限與重播設定。實際播放仍以 Live 為權威。已結束且未啟用重播或已過 Live 重播期限的資源不可發布；已發布資源失效後不顯示可用播放入口。

播放頁禁止一般影片節點直接嵌入 URL（包含隱藏節點、popup 與 viewport override）。發布時拒絕，公開 renderer 也會攔截既有或異常快照並提示移除直接影片、綁定授權 Live，避免繞過既有觀看權限。

Webinar 必須使用包含獨立頁面的 FunnelStepPages 容器；單一 PageDocument 不能只附加 Webinar flow 來繞過多頁與播放檢查。此類異常資料在寫入與公開讀取時均會被拒絕。

`/lp/[slug]/[stepPath]/play` 只接受已發布 Webinar 的播放步驟。伺服器重新驗證目前資源與時間，live/replay 才 303 導向既有 `/live/[slug]`。尚未開始 409、已過期 410、缺資源 503，皆 no-store，不回傳播放 Location。這是新的 Funnel 導向檢查，既有 Live 直接連結仍遵守原有 Live 權限。

報名提交使用現有同源檢查與欄位驗證；成功才 303 至目前 Funnel 的感謝頁，標記 `submitted=verification_required`。名單仍為 UNVERIFIED，需 Email 確認；感謝頁不宣稱已驗證。公開頁不把任意 query 當作授權或報名成功憑證。

## 驗證與回滾

測試涵蓋 schema、四 Goal、獨立快照、history、日期邊界、時區、保存重載、資源歸屬與失效、必要步驟、公開路由與 server handoff。Browser runner `scripts/webinar-funnel-disposable-qa.mjs` 從不含 `.env*` 的 source-only mirror 建置，使用具唯一 identity 的 loopback disposable PostgreSQL 與 synthetic fixtures。沒有複製正式資料、建立正式場次、寄送正式信件或部署。

驗證結果與 sanitized receipt 位於 `docs/ai-team/evidence/webinar-funnel-20260917`。既有 CI 在每次 push／PR 執行 ESLint、單元測試及 E2E。回滾可撤銷本次 checkpoint；資料使用既有 JSON 欄位，無資料庫 migration write。若回到尚未支援 Webinar 的舊版程式，Webinar JSON 會被拒絕讀取，應先取消發布相關 Funnel，再回滾應用程式。
