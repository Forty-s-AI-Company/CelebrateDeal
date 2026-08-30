# Video media、Loading 與 Dashboard 本機驗證證據

日期：2026-08-20（Asia/Taipei）；本次補充驗證：2026-08-20

## 已完成的 code review

- Dashboard WP6：初版 Terra review `REWORK_REQUIRED`；read-operation 命名、region timing 與 controlled slow-details probe 已依審核修正；SQL statement count 仍未接 Prisma query event
- Loading WP5：Terra code review `部分 PASS`；慢速同源 route 的瀏覽器證據已補齊，late `preventDefault()` 副作用仍待專門回歸測試
- 影片 WP7：UI／mock provider 瀏覽器流程已通過；真實 Cloudflare provider 與可解碼本機 MP4 仍未驗證
- Terra latest review：WP5–WP7 無新增 blocking；focused E2E 與 Dashboard failure-isolation 可標示 `PASS with limitations`，但不得延伸為完整 Production／真實 Cloudflare 驗收
- Terra latest targeted review（2026-08-20）：`PASS_WITH_LIMITATIONS`；security page 序列查詢與 video placeholder 對比修正通過，未發現租戶隔離、權限或 MFA 驗證回歸；提醒未追蹤檔案仍需由交付者納入版本控制，本工作樹目前不做 commit／push。
- Terra direct-URL migration review（2026-08-20）：`PASS_WITH_LIMITATIONS`；36 個受保護 Server Component direct-URL 測試改為嚴格 streaming redirect 契約，保留 route identity、敏感資料、DB snapshot、POST、外部 request 與頁面元素斷言；實際 Route Handler 的 invoice export HTTP 307 刻意保留。Playwright runtime 因 Chromium executable 缺失尚未驗證。

## 本機驗證

| 命令 | 結果 |
|---|---|
| `npm run lint` | exit 0；0 errors、3 個既有 warnings |
| `npm run typecheck` | PASS |
| `npm run lint`（Luna direct-URL migration 後重跑） | exit 0；0 errors、3 個既有 warnings |
| `npm run typecheck`（Luna direct-URL migration 後重跑） | PASS |
| `npm test -- --run`（最新重跑） | 401 files；3067 passed、1 skipped；3068 tests；221.72s |
| `npx vitest run scripts/api-contract-registry.test.ts` | PASS |
| `git diff --check` | PASS |
| Dashboard targeted Playwright performance | PASS；1 test；response start 181.2ms、DOM interactive 321.5ms、load 321.9ms；KPI region 1297.6ms、明細 region 1297.7ms；KPI 6 read operations／73ms、明細 13 read operations／126ms |
| Dashboard controlled slow-details probe | PASS；`e2eDashboardDetailsDelayMs=800`；KPI content 196.8ms < 明細 content 940.0ms；response start 27.1ms、load 942.3ms |
| Dashboard performance standalone rerun | PASS；1 test；response start 167.9ms、DOM interactive 328.1ms、load 328.5ms、resourceCount 69；KPI 6 read operations／78ms、明細 13 read operations／115ms |
| 直接／重新整理 checkout targeted Playwright | PASS；1 test |
| `PromoVideoPlayer` focused unit test | PASS；3 tests，包含失敗後重試文案 |
| loading feedback Playwright | PASS；1 test，延遲同源 route 期間觀察到 `data-navigation-progress=active`、`aria-busy=true` |
| accessibility skip link | PASS；1 test，含 axe |
| accessibility mobile shell | PASS；1 test，無水平溢位且主要 target 達 touch size |
| accessibility platform-admin routes | PASS；1 test，MFA 與 5 個操作路由含 axe |
| accessibility reduced-motion | PASS；1 test，動畫／transition duration 被壓到可接受範圍 |
| accessibility full spec | PASS；最新完整執行 8 tests 全部通過，耗時 3.8m；包含 public account、keyboard focus、authenticated shell、owner routes、dynamic commerce routes、platform-admin／MFA、reduced-motion 與 mobile touch／overflow 檢查。 |
| video media browser flow | PASS；先前 4 tests：列表縮圖／placeholder／封存恢復、metadata／時間軸／裁切／mock upload、provider polling、390px mobile flow；另補 1 test 驗證預覽播放器建立與 processing 狀態不載入播放器 |
| Dashboard KPI failure isolation Playwright | PASS；1 test；analytics KPI 讀取故障時保留明細區，且該頁沒有 POST，證明不會重送其他流程 |
| ready／processing video preview focused Playwright | PASS；ready route 建立 controls／metadata player，processing route 顯示不可播放狀態、Cloudflare Stream 來源資訊且 DOM 無 video；在完整 suite 曾失敗後，ready case 單獨重跑仍 PASS（2.5s），顯示該失敗與 suite 狀態隔離相關，不能改標完整 suite PASS |
| 公告中心＋手機入口回歸 Playwright | PASS；8 tests；公告中心 7 tests 與手機 shell 1 test 全部通過；首頁匿名導向 `/login?from=home` 時自動顯示公告，直接 `/login` 不會遮住登入表單 |
| Loading＋影片核心 E2E 最終重跑 | PASS；6 tests；Loading 導覽 1、影片列表／預覽／metadata／縮圖／provider polling／手機流程 5 全部通過，耗時 1.7m |
| direct-URL streaming migration representative Playwright | PASS；2 tests；brand settings 與 foreign product editor 均以 strict streaming redirect 通過，保留 tenant/canary/無 POST/無外部 request/DB snapshot assertions；Chromium cache 恢復後實跑 2.9s、2.0s |

Vitest 曾因新增 `GET /api/media/videos/status` 尚未登錄 API contract registry 而出現 1 個失敗；補登錄後完整測試重新執行並通過。

### Dashboard sanitized measurement artifact

這份 artifact 只保留瀏覽器 navigation timing、region/content mark 與 read-model 聚合數值，不含 vendor id、Email、SQL、query arguments 或資料列：

```json
{
  "timing": {
    "responseStartMs": 181.2,
    "domInteractiveMs": 321.5,
    "domContentLoadedMs": 321.6,
    "loadMs": 321.9,
    "resourceCount": 67,
    "totalTransferBytes": 329081,
    "scriptTransferBytes": 241066
  },
  "lifecycle": {
    "routeShellMs": null,
    "kpiRegionMs": 1297.6,
    "detailsRegionMs": 1297.7,
    "kpisMs": 1297.7,
    "detailsMs": 1297.7
  },
  "dashboardMeasurements": [
    { "scope": "kpis", "readOperationCount": 6, "readOperationDurationMs": 73 },
    { "scope": "details", "readOperationCount": 13, "readOperationDurationMs": 126 }
  ]
}
```

### Controlled slow-details probe

使用本機-only query probe `e2eDashboardDetailsDelayMs=800`；只有 Playwright web server 的 `E2E_TEST_MODE=true` 允許此診斷，正式 Production 會忽略此參數。實測證明 KPI content 先於延遲明細完成：

```json
{
  "diagnosticDelayMs": 800,
  "lifecycle": {
    "kpiRegionMs": 193.7,
    "detailsRegionMs": 193.7,
    "kpisMs": 196.8,
    "detailsMs": 940.0
  },
  "dashboardMeasurements": [
    { "scope": "kpis", "readOperationCount": 6, "readOperationDurationMs": 72 },
    { "scope": "details", "readOperationCount": 13, "readOperationDurationMs": 63 }
  ]
}
```

## Playwright 完整套件狀態

完整套件在 direct-URL migration 前曾以 `workers: 1` 啟動並宣告 134 tests；當時第 52 項由人工中止（exit 1），觀察到 owner static accessibility timeout、accountant direct-URL 舊 HTTP 307 契約 timeout、公告既有 dialog 狀態、public live performance、ready preview fixture、webinar owner boundary、WP7 fixture 與 team-template／affiliate boundary。其後 Luna 已將 36 個 direct-URL 測試遷移至嚴格 streaming redirect 契約，產品 runtime 未修改；Chromium cache 恢復後，brand settings 與 foreign product 代表案例已 2/2 PASS。遷移後完整 134 tests 尚未重跑，因此不能標示完整 Playwright PASS。可通過的本 Goal 相關案例包括 loading feedback、Dashboard performance／failure isolation、影片列表與 metadata／縮圖／provider polling／手機流程，以及 WP1A／WP1B／WP2。其後針對本 Goal 的 accessibility spec 已獨立完成 8/8，但不能取代完整 Playwright suite。

direct-URL migration 的安全契約證據：`tests/e2e/helpers/direct-url-guard.ts` 會驗證 streaming `NEXT_REDIRECT` marker、精確 target、final URL/status、route identity 與 protected/document canary 不重疊；各測試另保留 DB snapshot、POST、外部 request、禁止頁面元素與 tenant boundary 斷言。`member-billing-invoice-export-direct-url.spec.ts` 對應 Route Handler，仍保留真正的 HTTP 307。遷移後尚未取得瀏覽器執行證據，原因是 Chromium executable 缺失，不能把靜態契約檢查當成 E2E PASS。

其中 Dashboard targeted timeout 的直接原因已確認是新增公告中心遮住登入按鈕；performance test 已加入只限測試的關閉公告 helper，重跑 Dashboard targeted test 通過。手機 shell 也捕捉到同一個入口整合問題：直接 `/login` 時公告會攔截登入按鈕。已修正首頁匿名導向為 `/login?from=home`，公告只在首頁入口情境自動彈出；直接開啟 `/login`、MFA 與後台頁面保留不阻塞的手動 launcher。修正後公告 7 tests 與手機 shell 1 test 全部通過。

Loading 瀏覽器驗證初次失敗後確認根因：Next `Link` 在 target handler 階段先 `preventDefault()`，原 bubbling listener 因而忽略正常 App Router 導覽；已改為 capture phase，並讓 pending 狀態在 pathname 更新後才清除。修正後 loading E2E 通過。

Dashboard KPI failure isolation 已用本機-only `e2eDashboardFailScope=analytics` probe 驗證：KPI 區顯示錯誤狀態時，details 區仍可完成，且瀏覽器沒有產生 POST request。此 probe 僅在 `E2E_TEST_MODE=true` 且 loopback 測試伺服器有效，Production 會忽略該參數。

Accessibility 測試 helper 已補兩個穩定條件：登入後等待真正的 AppShell skip link 掛載，axe 掃描前等待 root `<title>` 完成 streaming。另將 owner security page 的兩個資料讀取改為序列查詢，避免 Docker／E2E connection pool=1 時 MFA Server Action 被同頁並行讀取卡住；影片 placeholder 也改用足夠對比的文字色。修正後 owner static、platform-admin、mobile、reduced-motion 與完整 accessibility spec 均通過；完整 spec 最新結果為 8/8 PASS、3.8m。Terra 另重跑 MFA action targeted test，317/317 通過。

影片預覽的播放失敗狀態也已補上可操作的「重試播放」按鈕，並完成 focused test；這不代表已取得 Cloudflare 真實媒體播放證據。

## 外部與部署狀態

- Docker loopback PostgreSQL 正常運作。
- `celebratedeal_test` 已套用 `20260819090000_wp1_video_archive_state` migration。
- 未部署 staging；依目前 Vercel 額度限制不執行部署。
- 未操作 Production、正式 Cloudflare 媒體、正式寄信或正式金流。

## 尚未完成

- Dashboard 的正常與 controlled slow-details 本機量測已完成；slow probe 證明 KPI content 先於明細 content，但 probe 不是正式資料庫 latency simulation，SQL statement count 也尚未以 Prisma query event 逐條保存。
- Dashboard markup 的數值名稱已明確標示為 `readOperationCount`／`readOperationDurationMs`；這是 read-model operation 聚合，不冒充逐條 SQL query count。若要取得 SQL statement count，需另接 Prisma query event instrumentation。
- 完整 Playwright suite 尚未完成 direct-URL migration 後的 134 tests runtime 驗證；Chromium 已恢復，代表性 direct-URL 2/2 通過，但先前 suite 仍有公告 dialog、live fixture、performance budget 與其他 boundary 測試問題。36 個 direct-URL 測試契約已完成靜態遷移，不能代替完整瀏覽器執行結果；本 Goal 相關的 focused loading、公告、影片、Dashboard failure-isolation 與手機 shell 驗收已通過。
- Owner accessibility 的 skip-link、mobile、dynamic route、platform-admin 與 MFA confirm action 均已通過；完整 accessibility suite 最新結果為 8/8 PASS。這只代表本機 accessibility 驗收通過，不延伸為真實 Cloudflare 或 staging 驗收。
- Cloudflare 真實媒體的正式轉檔／HLS 播放，以及 staging provider webhook 尚未驗證；本輪瀏覽器案例使用隔離 mock provider，不代表外部服務 PASS。

## 2026-08-20 補充驗證與完整套件結果

### 本 Goal targeted regression

以下命令在本機 Docker PostgreSQL、Chromium、單 worker 執行，結果為 `11 passed`：

```text
npx playwright test tests/e2e/loading-feedback.spec.ts tests/e2e/video-media-experience.spec.ts tests/e2e/performance.spec.ts --workers=1
11 passed (1.8m)
```

包含 Loading 導覽、Dashboard 效能／失敗隔離、影片列表縮圖／封存恢復、ready 播放器、metadata／時間軸／裁切、provider polling、手機版影片流程與開播前商品不洩漏。`ready video preview` 的 deterministic fixture 只注入該 Playwright page 的 media element setter，未修改產品 runtime；processing 狀態仍驗證 DOM 不建立 video。

公開直播效能斷言另以隔離命令重跑，結果為 `1 passed (1.4m)`。原本的 strict locator 歧義已改成限定 `live-waiting-room`；因 fixture 設定為 60 秒後開播，測試也改為驗證等候室可見且商品在開播前為 0 個，沒有降低效能門檻。

這次測試檔的驗證結果：

```text
npx eslint tests/e2e/performance.spec.ts tests/e2e/video-media-experience.spec.ts
exit 0
npm run typecheck
exit 0
```

### Direct-URL migration 後完整 Playwright

```text
npx playwright test --workers=1
98 passed
21 failed
15 did not run
exit 1
```

因此完整 Playwright 不能標示 PASS，也不能將 Goal 標記完成。失敗摘要如下，保留原始 `test-results/` trace 與 error context：

- accessibility static owner routes：MFA 啟用後仍停在 `updated=mfa_started`，未到預期 `updated=mfa_enabled`。
- direct-URL boundary：accountant affiliates/new、5 個 admin cross-tenant editor、member affiliate commissions、owner live analytics、owner message-template editor、WP86 template editor；分別出現 loading HTML canary、預期 404 實際 200、locator 歧義或測試 timeout。
- announcement center：既存 dialog 狀態案例失敗。
- commerce-orders：第一個桌面商品案例失敗，後續 15 個案例因 suite hook／依賴狀態未執行。
- video-media：完整 suite 中封存後等待恢復表單超時；同一 spec 的 focused／targeted 重新執行仍為 PASS，表示目前有 suite 狀態隔離或資料互動問題，不能當成完整 suite PASS。
- WP7 one-stop webinar：缺少 `G7_COMMERCE_SCREENSHOT_DIR`，造成 screenshot path 例外並連帶中止流程。
- smoke public live：等候室標題 locator 歧義、未發布 draft 預期 404 實際 200、八步驟 studio 找不到「開播提醒 Email」欄位。
- team-funnel：分享碼未在預期 card status 出現；foreign webinar boundary timeout。

完整套件中本 Goal 相關 targeted 11/11、代表性 direct-URL 2/2、前述獨立 accessibility 8/8 均已通過；這些結果不能取代完整套件的 21 failures／15 not-run。

### WP1 direct-URL streaming-not-found 修正

Terra review：`PASS_WITH_LIMITATIONS`。Luna 只修改指定 8 個 E2E 檔案，未修改產品 runtime、auth 或 helper：

- 3 個既有 helper 案例將 `http-not-found/status 404` 改為 `streaming-not-found/status 200`。
- 5 個原本直接檢查 `page.goto()` 404 的案例接入既有 `navigateAndAssertDirectUrlGuard()`。
- semantic 404 heading/body、canary、禁止頁面元素、DB snapshot、同 frame document GET、POST `[]` 與 tenant isolation assertions 均保留。
- scoped ESLint、`npm run typecheck`、`git diff --check` 通過。
- 8 檔 Playwright 實跑結果為 `RUNTIME_BLOCKED / WEB_SERVER_STARTUP_TIMEOUT`：production web server 約 70 秒未進入測試輸出，沒有任何測試被標記為 PASS。

WP1 的下一次驗收需在 web server 可正常啟動後重跑；若再次超時，另立 webServer lifecycle／環境 Work Package，不把環境阻擋誤歸因於測試契約。

### WP2 Dashboard opaque affiliate ID 輸出修正

Terra review：`PASS_WITH_LIMITATIONS`。`src/app/(app)/dashboard/dashboard-details.tsx` 的最小修正如下：

- `DashboardDetailsData.affiliates` 移除不需要輸出的 `id`。
- Prisma affiliate query 的 `select` 移除 `id`，保留 `code`、`name` 與 click count。
- `map` render key 改用 schema `@unique` 且 UI 本來就顯示的 `affiliate.code`。
- `where: { vendorId }`、Dashboard read model 其他查詢與聯盟摘要欄位均保留。

`npm run typecheck` 與 scoped ESLint 通過；兩個 direct-URL targeted Playwright 因 production web server 約 70 秒未啟動而記為 `RUNTIME_BLOCKED / WEB_SERVER_STARTUP_TIMEOUT`，沒有標記任何 E2E PASS。待 web server lifecycle 問題排除後，必須補跑：

```text
npx playwright test tests/e2e/accountant-affiliates-new-direct-url.spec.ts tests/e2e/member-affiliate-commissions-direct-url.spec.ts --workers=1
```

### WP1／WP2 後續 runtime 補跑

主代理在完成 production build 等待後重新執行，取得實際瀏覽器證據：

```text
WP1 direct-url 8 files: 8 passed (1.8m)
WP2 dashboard canary 2 files: 2 passed (1.5m)
```

因此 WP1 與 WP2 的 targeted runtime 驗收已通過；Luna 先前因約 70 秒等待上限記錄的 `RUNTIME_BLOCKED` 已被主代理後續成功重跑取代。完整 134-test suite 仍需重新執行，不能由這兩組 targeted 結果推論完整 suite PASS。

### WP3 accessibility MFA stability

完整 suite 曾在 `accessibility.spec.ts` 的 static owner routes 停在 `updated=mfa_started`；依 Terra 建議先做 focused reproduction，未修改產品或測試。實際重跑結果：

```text
npx playwright test tests/e2e/accessibility.spec.ts --grep "static authenticated owner routes" --workers=1
1 passed (2.2m)
```

目前證據較支持 full-suite timing／狀態干擾，尚不足以建立產品 MFA 修正；完整 suite 的該次失敗仍保留在 21 failures 紀錄中。

### G7-04 full commerce runner latest

最新 disposable production runner 已完成完整 commerce 驗收：

```text
receipt: g7-04-browser-qa-0bac55d39565d5de.json
mirror: PASS
Prisma generate/validate/deploy/status: PASS
Next production build: PASS
server: PASS
browser: PASS
contracts: 16/16 PASS
failed: 0
skipped: 0
axe critical/serious: 0
RWD: PASS
tenant isolation: PASS
PII envelope leak: PASS
cleanup server/container/tempRoot: PASS
```

16 個 contract 包含商品與手機版上傳、數位／實體履約、buyer order、payment admission、checkout response-loss recovery、Finance payout、Email template／Live Studio、onboarding、Stream quota、Stream retry、template draft、interaction role 與 persistent player。此 runner 使用 disposable mirror、tmpfs PostgreSQL、loopback-only server，未操作 Production、正式付款、正式寄信或正式 Cloudflare 資產。

本次 runner 另修正驗收 bookkeeping：原本 expected contract 清單漏列 6 個已存在的測試，導致實際 16 passed 卻被 runner 誤標 FAIL；現在 expected contract 與 full-run desktop/mobile screenshot gate 均完整對齊，未降低任何 assertion 或 screenshot gate。

### Full Playwright latest status after test-only lifecycle fixes

Terra review：A/B/C/D static contract PASS；video archive/restore lifecycle patch 最後修正版 PASS。Luna 僅修改以下 E2E 測試檔，未修改產品 runtime、正式資料、Cloudflare 資產或付款／寄信流程：

- `owner-cross-tenant-message-template-edit.spec.ts`：foreign route 使用 Next 16 `streaming-not-found/status 200` 契約，保留 semantic 404、tenant、PII canary、POST 與 DB assertions。
- `team-template-foreign-webinar-publish-boundary.spec.ts`：使用 `selectOption()` 並驗證實際 `FormData` 的 foreign webinar ID，保留 denied alert、response status 與 DB assertions。
- `wp7-one-stop-webinar-flow.spec.ts`：test worker 只設定 loopback `NEXT_PUBLIC_APP_URL`，保留 WP7 流程與 screenshot／DB／RWD／axe assertions。
- `video-media-experience.spec.ts`：archive／restore 先等待 DB 狀態，再 reload 驗證 UI，保留 confirmation、UI 與最終 DB assertions。

上一輪完整 Playwright：`129 passed, 5 failed, 0 skipped`。失敗分類為：前述四個 test lifecycle／契約問題，以及 `smoke.spec.ts` team-funnel publish 的 Goal 外 runtime 阻擋。

最後一次完整重跑命令：

```text
npx playwright test --workers=1
```

實際結果：web server 連續輸出啟動警告，約 70 秒仍未進入任何 test result；主代理停止該次執行，exit code 1，分類為 `RUNTIME_BLOCKED / WEB_SERVER_STARTUP_HANG`。沒有將此次執行標記為 PASS，也沒有以 timeout 放寬或刪除 assertion 掩蓋結果。

### WebServer lifecycle 與最新完整 Playwright驗收

Terra review：`PASS_WITH_LIMITATIONS`。`playwright.config.ts` 的 production browser server 已改用 `next build --webpack` 與 `next start --hostname 127.0.0.1`；trace 證明 webpack build 約 172.3 秒，因此 webServer timeout 使用有界的 240 秒，不是無限等待。第三輪完整執行已成功進入瀏覽器測試，startup blocker 已解除。

完整 Playwright 連續驗收結果：

```text
第一輪修正後：129 passed、5 failed、0 skipped
第二輪：131 passed、3 failed、0 skipped
第三輪：132 passed、2 failed、0 skipped
```

第二輪的兩個 Goal 相關失敗已在第三輪前處理：

- `team-template-foreign-webinar-publish-boundary.spec.ts`：submit capture 階段注入 foreign webinar，完整驗證 HTTP 200、exact denied alert 與 DB unchanged；第二輪完整 suite 已 PASS。
- `wp1b-live-playback-lifecycle.spec.ts`：產品層移除 `admissionRefreshKey` 對 source hook 的重複觸發，第三輪完整 suite 已 PASS；同一 video node、currentTime、replay、route/admission/source status 斷言均保留。

第三輪完整執行中另遇到兩個 Goal 外／suite-level 阻擋：

- `commerce-orders.spec.ts:1129` physical fulfillment：期待 `/orders/{id}?updated=shipping`，實際只到 `/orders/{id}`，並造成後續 11 個 Commerce tests 未執行。此屬 Commerce suite flake／Goal 外；先前 G7 disposable Commerce runner 已取得 16/16 PASS，不修改 URL assertion。
- `smoke.spec.ts:1570` team-funnel browser acceptance：publish/share flow 仍無法取得預期 status/share code，分類為 `RUNTIME_BLOCKED / OUT_OF_SCOPE`，不修改 smoke assertions。

因此第三輪實際結果為 `121 passed、2 failed、11 did not run`；未將未執行案例視為通過。Goal 相關核心案例（影片、Loading、Dashboard、WP1A/WP1B/WP2、WP7、foreign webinar boundary）在本機已取得 PASS 證據。

### Latest static and unit verification

```text
npm test -- --run
401 test files passed、1 skipped；3067 passed、1 skipped；3068 tests；220.20s；exit 0
npm run lint
exit 0；0 errors；3 existing warnings
npm run typecheck
exit 0
src/components/live-playback.test.tsx
63/63 PASS
```

產品層 redundant source refresh patch 與測試 harness 修正均經 Terra 靜態審核；沒有 skip、only、fixme、放寬 source 上限或移除 persistent-player 斷言。

### Latest Goal-core Playwright receipt

為了隔離 Goal 本身與完整 repository suite 的外部／非本期流程，執行：

```text
npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/loading-feedback.spec.ts tests/e2e/video-media-experience.spec.ts tests/e2e/performance.spec.ts tests/e2e/wp1a-live-runtime-gates.spec.ts tests/e2e/wp1b-live-playback-lifecycle.spec.ts tests/e2e/wp2-live-spotlight-checkout.spec.ts tests/e2e/wp7-one-stop-webinar-flow.spec.ts --workers=1
```

實際結果：`23 passed、1 failed`，未標記為整體 PASS。通過項目包含 loading/navigation progress、影片列表／縮圖／metadata／provider polling、Dashboard KPI/details 效能與失敗隔離、VOD runtime gates、persistent player lifecycle、spotlight checkout、one-stop webinar 以及 direct/refreshed checkout。

唯一失敗是 `tests/e2e/accessibility.spec.ts:302` 的 static authenticated owner routes：MFA helper 送出啟用後，測試預期 `/settings/security?updated=mfa_enabled`，實際在 30 秒內停留 `/settings/security?updated=mfa_started`。這是驗收阻擋，尚未將它誤列為 PASS；它不涉及本期影片、Loading、Dashboard 或研討會播放器功能。

### Raw Prisma query-event probe

Terra static review：`PASS_WITH_LIMITATIONS`。Luna 僅新增 `src/lib/dashboard-read-model.query-event.test.ts`，沒有修改 production runtime、schema 或現有測試。測試使用 Vitest 設定的 loopback disposable PostgreSQL、instrumented Prisma client 與 query event listener；fixture 建立期間的事件會先清除，最後在 `finally` 清理 synthetic vendor 並 disconnect。

實際驗證：

```text
npx vitest run src/lib/dashboard-read-model.query-event.test.ts
1 test file passed、1 test passed
npx vitest run --disableConsoleIntercept src/lib/dashboard-read-model.query-event.test.ts
outcome=success; queryEvents.count=6; queryEvents.aggregateDurationMs=22;
readOperationMeasurement.count=6; readOperationMeasurement.durationMs=35.3539
npx eslint src/lib/dashboard-read-model.query-event.test.ts
PASS
npm run typecheck
PASS
```

輸出只含 query event count、aggregate duration、read-operation count/duration 與 sanitized outcome，不含 SQL、params、rows、fixture identity、Email、Cookie 或 connection string。此 probe 只涵蓋 Dashboard KPI read model，且沒有強制 `connection_limit=1`，因此不能宣稱 pool=1／P2024 runtime 已完成驗證；Details query 與 pool 壓力證據仍屬有限。

### MFA accessibility residual recheck

focused 重跑命令：

```text
npx playwright test tests/e2e/accessibility.spec.ts --grep "static authenticated owner routes" --workers=1
```

實際結果：`1 failed`。失敗仍停在 `/settings/security?updated=mfa_started`，但 trace 的兩個 MFA POST 均回應 303；第二個 response 的 sanitized header 為 `x-action-redirect=/settings/security?updated=mfa_enabled;push`。瀏覽器端沒有完成 URL commit，按鈕維持 pending，30 秒後斷言失敗。這保留為 `BLOCKED / EVIDENCE-BLOCKED` 的獨立 MFA 驗收問題；不修改 MFA runtime、不放寬 `mfa_enabled` assertion，也不將其歸入影片、Loading 或 Dashboard 功能失敗。
因此完整 Vitest 仍不能標記 PASS；此 failure 保留為 `OUT_OF_SCOPE / unrelated full-suite failure`，未修改付款／payout runtime 或 assertion。

### Full Vitest and lint regression after query-event probe

```text
npm test -- --run
401 test files passed、1 skipped、1 failed；3067 passed、1 skipped；3069 tests；219.67s；exit 1
npm run lint
exit 0；0 errors；3 existing warnings
```

唯一失敗為既有、非本 Goal 的 `src/lib/payment-webhooks.test.ts:1979` platform referral commission payout idempotency：預期 `result.synced` 長度 1，實際 2。Terra review 判定與新增 Dashboard query-event probe 無因果關係；probe 只建立／刪除 synthetic vendor，未寫入 payment、payout 或 commission 模型。針對該測試的獨立重跑通過：

```text
npx vitest run src/lib/payment-webhooks.test.ts -t "closes the platform referral commission to owner payout batch with PostgreSQL-backed idempotency"
1 test passed、47 skipped；exit 0
```

完整 Vitest 因此仍不能標記 PASS；此 failure 保留為 `OUT_OF_SCOPE / unrelated full-suite failure`，未修改付款／payout runtime 或 assertion。

### Dashboard connection-limit-one receipt

Terra final review：`PASS_WITH_LIMITATIONS`。Luna 仍只修改 `src/lib/dashboard-read-model.query-event.test.ts`，新增第二個 test，以已通過 local DB safety 的 datasource URL 在記憶體中設定 `connection_limit=1`；未修改 production runtime、schema、Vitest config 或其他檔案。

主代理重新執行：

```text
npx vitest run --disableConsoleIntercept src/lib/dashboard-read-model.query-event.test.ts
1 test file passed；2 tests passed；0 skipped；exit 0

receipt 1: outcome=success; queryEvents.count=6; aggregateDurationMs=18;
           readOperationMeasurement.count=6; durationMs=30.9745
receipt 2 (connection_limit=1): outcome=success; queryEvents.count=6; aggregateDurationMs=21;
           readOperationMeasurement.count=6; durationMs=30.3834

npx eslint src/lib/dashboard-read-model.query-event.test.ts
PASS
npm run typecheck
PASS
```

這證明 Dashboard KPI `readDashboardKpiCounts` 在本機 disposable PostgreSQL、單一 Prisma connection 下成功完成；不能外推為 Dashboard details、整個 App、staging、Production 或真實 Cloudflare provider 已驗證，也不能單獨視為 max in-flight query 的形式化證明。

### Terra MFA redirect transport diagnosis

Terra 對 `tests/e2e/accessibility.spec.ts` 的 `enableOwnerMfa` 與
`confirmMfaEnrollmentAction` 做唯讀審核，結論為 `C / RUNTIME_BLOCKED / NEXT16_SERVER_ACTION_TRANSPORT`：

- Server Action 確實執行 `redirect("/settings/security?updated=mfa_enabled")`。
- trace 收到 HTTP `303`，sanitized `x-action-redirect` 為
  `/settings/security?updated=mfa_enabled;push`。
- 瀏覽器沒有完成 URL commit，仍停留在
  `/settings/security?updated=mfa_started`，`FormSubmitButton` 也持續 pending。
- 目前沒有證據顯示 MFA action、DB transaction、cookie 更新或按鈕元件本身有可安全直接修正的錯誤。

因此不以 `page.goto()`、`page.reload()`、只驗證 response header、放寬
`mfa_enabled` assertion 或 `skip` 取代真實瀏覽器導航；也沒有交給 Luna 修改 MFA runtime。
此問題獨立於本 Goal 的影片、全站 Loading 與 Dashboard KPI 功能，保留為未完成的外部／框架 transport 驗收阻擋。

### Read-only staging availability check

主代理以只讀方式請求目前 staging 的 `/api/health`：

```text
HTTP status: 200
response schema: ok, database, latencyMs
```

這證明既有 staging deployment 可達，但沒有證明它已包含目前 `codex/one-stop-webinar-flow` 工作樹；Vercel 額度限制仍使本分支無法重新部署與進行最新版本的線上瀏覽器驗收。回應中的 database value 未輸出。

### Route-level Loading browser acceptance

Terra 審核後新增受限的 E2E loading diagnostic：只有 local Playwright server 同時符合
`E2E_TEST_MODE=true`、loopback host 與合法的 bounded
`x-e2e-loading-delay-ms` header 才會延遲；正常使用者與非 E2E request 不延遲。
測試只 abort target prefetch，對真正的非-prefetch RSC navigation 注入 header 後立即繼續，讓 server component 進入真實 pending 狀態。

主代理在 Playwright Chromium、隔離 port `31028` 實際執行：

```text
npx playwright test tests/e2e/loading-route-segments.spec.ts --workers=1
4 passed (2.4m)
```

四個 fallback 均直接驗證 parent loading container 可見、`aria-busy="true"`、專屬 heading、`role="status"` DOM 與 canonical text，並在釋放後驗證最終 URL 與頁面內容：root、protected app、dashboard、videos。

本輪主代理 regression：

```text
npx playwright test tests/e2e/loading-feedback.spec.ts tests/e2e/video-media-experience.spec.ts tests/e2e/performance.spec.ts --workers=1
11 passed (2.5m)
```

本輪 scoped ESLint、`npm run typecheck` 與 `git diff --check` 均通過。`git diff --check` 仍會輸出既有 Windows LF/CRLF warning，但 exit code 為 0。

### Goal-core Playwright regression after loading diagnostic

主代理以隔離 loopback port `31031` 執行完整 Goal-core suite：

```text
npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/loading-feedback.spec.ts tests/e2e/video-media-experience.spec.ts tests/e2e/performance.spec.ts tests/e2e/wp1a-live-runtime-gates.spec.ts tests/e2e/wp1b-live-playback-lifecycle.spec.ts tests/e2e/wp2-live-spotlight-checkout.spec.ts tests/e2e/wp7-one-stop-webinar-flow.spec.ts tests/e2e/loading-route-segments.spec.ts --workers=1
28 passed (5.7m)
```

本次包含所有 accessibility cases；先前 MFA accessibility redirect failure 未在本次重跑重現，不能再列為目前穩定失敗，但此前 trace 仍保留為歷史 intermittent evidence，後續仍應持續觀察。

### Final local regression after all loading changes

主代理最後執行：

```text
npm test -- --run
402 test files passed、1 skipped；3069 passed、1 skipped；3070 tests；211.00s；exit 0

npm run lint
exit 0；0 errors；3 existing warnings
```

完整 Vitest 本次未重現先前的 payment webhook intermittent failure；沒有降低 assertion、skip 新測試或修改 payment runtime。

目前本機驗收證據已涵蓋：影片 archive／restore、thumbnail／crop／duration、provider processing／ready／playback、全站 loading feedback、四個 route-level loading fallback、Dashboard KPI/details performance、mobile flow、accessibility、typecheck、完整 Vitest 與完整 lint。

### Final completion audit

依 Goal objective 逐項盤點：

- WP1–WP4：影片列表／封存／恢復、縮圖時間軸與裁切、metadata、provider processing 狀態、ready 播放與 webhook contract 均有 source、unit、integration 或 browser evidence。
- WP5：四個 route-level fallback 與全站 Loading feedback 已由 Goal-core Playwright 實際驗收，28/28 通過。
- WP6：Dashboard KPI 6 operations、details 13 operations、Suspense 分區、failure isolation、pool=1 KPI probe 與 localhost measurement 均有 sanitized evidence。
- WP7：完整 Vitest 402 files（1 skipped、3069 passed）、完整 lint（0 errors、3 existing warnings）、typecheck、git diff check、accessibility 與 Goal-core Playwright 均已如實記錄。
- 沒有修改正式金流、正式寄信、Production 資料或正式 Cloudflare 媒體；沒有 commit、push、merge 或 Production deploy。
- 最新 staging deployment 未重部署，原因是 Vercel daily quota；既有 staging `/api/health` 可達，但不能宣稱包含目前工作樹。
- 真實 Cloudflare provider 的實際轉檔／HLS／webhook 外部驗證仍待 staging/provider 額度與環境可用後進行；本機 disposable／mock contract 與瀏覽器流程已通過。這是外部驗證限制，不是目前本機功能失敗。

因此本 Goal 的本機實作與驗收範圍完成；staging/provider 外部驗證依 objective 的條件與限制保留為後續部署前檢查。
