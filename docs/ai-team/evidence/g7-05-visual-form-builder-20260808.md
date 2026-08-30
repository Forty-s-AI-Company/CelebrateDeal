# G7-05 視覺化報名表單 builder checkpoint — 2026-08-08

## 結論

- 狀態：`PASS_LOCAL_DETERMINISTIC_BROWSER_EXTERNAL_ACCEPTANCE_PENDING`。
- 「報名表單／名單蒐集」由 provisional `4/10` 調整為 local-evidence candidate `8/10`，已達本 Goal 的功能門檻 `>=7/10`。
- canonical total 仍維持 `73.5`、delta `0`。本文件不取代 `RELEASE-RECONCILIATION`，也沒有把 candidate 分數偽裝成已完成的 CAT04／CAT10 release acceptance。
- 本輪完成的是實際產品功能，不是用 coverage 漲幅替代功能：商家不再編輯 raw JSON，公開提交端也會依同一份欄位 schema 驗證並 fail closed。
- Closure review 沒有未關閉的 P0／P1；一個 P1 與一個跨流程 P2 已修正、補測並關閉。
- 本工作包已達可安全停下的 checkpoint；依使用者指示，本輪不啟動下一個 WP。

## 實際完成的產品閉環

### 商家視覺化建構器

- 移除商家介面的 raw JSON textarea；JSON 僅保留為隱藏傳輸與既有資料相容層。
- 支援新增 `text`、`email`、`tel`、`number`、`url` 欄位，並可編輯標籤、型別與必填狀態。
- 支援鍵盤可操作的上移、下移、移除與單步復原；欄位 key 穩定，最多 32 欄。
- 核心 `name` 與 `email` 欄位鎖定必要型別與必填條件，不能被移除或弱化。
- 提供即時預覽、公開網址、按鈕文字、成功文字與啟用狀態設定；桌機與手機採合理堆疊，不出現水平 overflow。
- 新增與編輯共用 server action；執行 CSRF、商家管理權限、vendor scope、欄位／metadata 上限與資料庫錯誤分類。
- `useActionState` 會在驗證、CSRF 過期、slug 衝突、跨租戶／不存在或暫時性資料庫錯誤時保留畫面內容並顯示可復原訊息；送出期間具 pending、disabled、`aria-busy` 與 live status。

### 既有資料與公開提交 fail closed

- 合法 legacy fields 會載入視覺化建構器；格式損壞的 legacy JSON 不會被靜默覆寫，儲存先停用，必須由商家明確重建安全預設欄位。
- `/form/[slug]`、`/live/[slug]` 與團隊漏斗都使用同一份 `parseRegistrationFormFields`；損壞規格只顯示不可提交警示，不再渲染一張 API 必然拒絕的假表單。
- 公開提交端依欄位型別驗證文字、email、電話、數字與僅限 HTTP(S) URL，拒絕未宣告欄位並正規化答案。
- 一般公開表單的空 `shareCode` 不再被送入 API；有 attribution 時仍保留既有 share/team 歸因，不覆蓋共享 dirty worktree 的既有邏輯。
- 提交失敗時保留使用者輸入，提供可見且可操作的錯誤訊息；mobile autocomplete／input mode、鍵盤與 pending accessibility 均保留。

## Bombmy Terra High 唯讀觀察

- 使用 Terra High 搭配已登入 Chrome 進行唯讀觀察；沒有使用 Sol。
- 可安全確認 Bombmy 將報名管理與直播管理分開，採列表、明顯新增入口，以及既有項目的獨立編輯／刪除操作。
- 受「不得修改競品資料、不得接觸私人內容」限制，未實際建立或送出 Bombmy 表單，因此沒有把其欄位排序、草稿、預覽、loading 或錯誤行為臆測成已驗證事實。
- 本輪只採用可泛化的產品原則：列表與編輯分離、視覺化欄位、即時預覽、可恢復錯誤與明確操作回饋；未複製品牌、文案或受保護內容。

## Fresh deterministic evidence

### Unit／component／route matrix

- 命令：`npx vitest run <16 explicit G7-05 test files>`。
- UTC：`2026-08-08T05:54:04.9191407Z` 至 `2026-08-08T05:54:15.5283958Z`。
- 結果：`16 files / 127 tests PASS`，failed `0`、skipped `0`、exit `0`。
- 範圍：表單列表／新增／編輯、visual builder、public LeadForm、公開表單／直播、team funnel、server action、submission API、fields／input／answers parsing。

### Production build、disposable PostgreSQL 與 Browser

- Canonical receipt：`docs/ai-team/evidence/g7-05-form-builder-browser-qa-83f85920016f8556.json`。
- Receipt SHA-256：`9DE1F30584365165910567B389480142975789EA74CB5CFBFB930FE715DB9438`；sidecar 核對一致。
- Source digest：`C553AB11779BC5F51E54F32546CB51348C075D80BA9C0581DD07CC292CF39FB8`；涵蓋建構器、公開提交、公開表單、直播、團隊漏斗、安全依賴、schema 與 committed migrations。
- UTC：`2026-08-08T06:01:04.956Z` 至 `2026-08-08T06:03:42.089Z`。
- Temp mirror、Prisma generate／validate／migrate deploy／status、Next production build、loopback server 與 Playwright 全部 `PASS`，所有命令 exit `0`。
- Browser：`5 passed / 0 failed / 0 skipped`；desktop `1440×1000`、mobile `390×844` 均無水平 overflow，Axe critical/serious `0`。
- 驗證：視覺 builder、preview sync、新增／移動／移除／復原、鍵盤、pending disabled、資料庫 JSON／metadata、valid／invalid legacy、foreign tenant 404 全部 `PASS`。
- Desktop screenshot SHA-256：`18C83AC20A174A84D02BC7C57A57117E32914E0E5377C318A373C21B54B8B712`。
- Mobile screenshot SHA-256：`9AFBB06AF50365040405BB12E091B07300B57090CAD1FEDAB26BB421F1F88814`。
- Cleanup：synthetic rows、server、container、temp root 全部 `PASS`。
- Safety：不讀 `.env*`，temp mirror 排除 dotenv；只使用 loopback、PostgreSQL tmpfs、synthetic fixtures 與既有 Playwright browser cache；沒有讀使用者 Chrome profile／Cookie，沒有外部或 Production 操作。

### Static、runner 與 source attribution

- Scoped ESLint UTC `2026-08-08T05:54:46.8756764Z` 至 `2026-08-08T05:55:04.3254947Z`，exit `0`。
- `npx tsc --noEmit --pretty false --incremental false`：exit `0`。
- 三個 form authorization E2E spec 可被 Playwright 正確列出，共 3 tests；spec scoped ESLint `PASS`。
- Browser runner：`node --check` exit `0`；`node --test scripts/g7-form-builder-browser-qa.test.mjs` 為 `4/4 PASS`，涵蓋 unsafe／incomplete fail closed、dotenv／profile／external operation guard、screenshot promotion 與 sanitized diagnostics。
- 39-entry source manifest：`docs/ai-team/evidence/g7-05-source-manifest-20260808.txt`，mismatch `0`。
- Source manifest SHA-256：`47056DC0C03EF3CA9E736D3414A24169AA347C702ACCFC2BC6070C2AA29E3694`。
- Scoped `git diff --check`：exit `0`，沒有 whitespace error。

## Reviewer findings 與 closure

1. `P1`：一般公開表單送出 `shareCode: ""`，與 API schema 衝突，會讓正常表單必然失敗。改由 request builder 只在有值時送出 shareCode，並補測。`CLOSED`。
2. `P2`：公開 form 已 fail closed，但 live 與 team funnel 仍可能渲染損壞 legacy fields，形成畫面可填、API 必拒的死路。三個入口改用同一 parser，損壞時顯示不可提交警示，並補跨入口測試。`CLOSED`。

Closure matrix 最終為 `16 files / 127 tests PASS`，Browser `5/5 PASS`，沒有未關閉 P0／P1。choice／checkbox／textarea、條件分支與 server-persisted autosave 可作後續 P2 增強，但不影響目前文字型名單蒐集的核心販售閉環。

## 失敗與 superseded evidence

- `g7-05-form-builder-browser-qa-1f44f16331a848ca.json`：`BLOCKED_OR_FAILED`，Axe 揭露 preview helper text 的 serious color contrast；產品樣式修正後才續跑，未把失敗改標 PASS。
- `g7-05-form-builder-browser-qa-51c4da33eed81aaf.json`：`4/5`，Next route announcer 與產品 alert 造成 runner locator strict-mode 衝突；改用精確 locator 後才續跑。
- `ce3f1a4373cb4cc6` 與 `57f676c33bf42436` 雖為 `5/5 PASS`，但 source digest 未涵蓋後段 public-flow 修正，因此均標記 `SUPERSEDED_NOT_CANONICAL`。
- 只有 `83f85920016f8556` 的不同 source digest 綁定完整 runtime 範圍，作為本 checkpoint canonical Browser evidence。所有舊 receipts 保留，沒有刪除、覆寫或偽造。

## 已知限制與人工 blocker

- G7-05 本身沒有要求使用者立即手動處理的功能 blocker。
- 進階選項欄位、條件分支與跨裝置 server draft autosave 尚未實作，列為 P2 產品增強；目前資料只有按「儲存」後才持久化。
- CAT04／CAT10 的外部 route-manifest／真人法律、財務、客服、release owner evidence 仍未完成；本工作包不代替真人簽核，也不重試 FIN-08AA terminal no-go。
- 兩份指定報告已在本 Goal 盤點並納入 attribution：`docs/report-1-affiliate-and-course-revenue-logic.md` 用於維持分潤 domain 邊界；`docs/report-2-current-implementation-readiness.md` 只作歷史缺口索引，當前判斷以 fresh source／DB／Browser evidence 為準。

## Ownership、回滾與下一步

- Source HEAD：`1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`。
- Final worktree：662 dirty entries（208 tracked dirty、454 untracked）、staged `0`；所有未知 ownership 維持 `PRESERVE_ONLY`。
- 保留所有既有 dirty worktree 變更；共享的 submission、live、team funnel 與 registration field 檔案只加入 G7-05 所需精確 hunks，未覆蓋既有歸因、commerce 或 interaction-role 工作。
- 未 stage、commit、push、merge 或 deploy；未操作 Production DB、付款、退款、寄信或外部 provider mutation。
- 未降低 coverage threshold、assertion 或資料驗證；未新增 skip、exclude 或縮減 inventory。
- 未重跑 FIN-08AA、WP-196、WP-197 的 terminal no-go endpoint、probe 或失敗命令，也未將其誤分類為 schema drift。
- 回滾只能依 39-entry manifest 與本文件列出的 G7-05 ownership，反向套用本 WP 精確 hunks並移除 G7-05 新檔、runner 與 evidence；禁止以 reset／restore／checkout 覆蓋共享 dirty files。
- Disposable container、schema temp root 與 loopback server 均已清理；沒有正式外部狀態需要回滾。
- 下一個最高價值工作是 `G7-06 — 互動角色既有實作 reconciliation + Terra High desktop／mobile Browser evidence closure`。依使用者「執行到一定段落停下」指示，本輪不啟動；Goal 保持 `ACTIVE`。
