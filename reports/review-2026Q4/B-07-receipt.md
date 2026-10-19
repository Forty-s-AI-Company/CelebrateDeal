# B-07 回執：可用性、無障礙與繁中文案審查

- 執行者：B-07 審查員（唯讀）
- 日期：2026-10-19
- 產出：`docs/review-2026Q4/17-ux-a11y-copy.md` 與本回執。
- 基線：分支 `codex/goal-review-2026q4`，`git rev-parse HEAD` 為 `78621ca32cabfc016a69504c996c107785987cc2`（= origin/master `78621ca3`）。
- 修改既有檔案：無。沒有任何 git 寫入；沒有讀取 `.env*`；沒有連線任何資料庫或外部服務；沒有啟動 dev server；沒有執行任何測試（含 `e2e:a11y`、`vitest`、`typecheck`）。唯一的新增檔案是上述兩份。

## 閱讀的文件與程式

- 規格：`PRODUCT.md`、`.claude/skills/celebratedeal-design-system/SKILL.md`、`docs/domain-workflows.md`（設計與互動、瀏覽器 QA）、`docs/review-2026Q4/01-system-map.md`（第 0、1 節）、`03-test-map.md`（標題）、`docs/market-2026Q4/reports/台灣直播導購 SaaS 市場研究 2026.md`（ICP 與功能模組決策兩節）。
- 共用元件與樣式：`src/app/globals.css`、`src/components/ui.tsx`、`form-submit-button.tsx`、`app-shell.tsx`、`app-shell-nav-link.tsx`、`app-shell-nav-group.tsx`、`app-shell-account-menu.tsx`、`onboarding-task-panel.tsx`、`media-upload-field.tsx`（錯誤文案與鍵盤）。
- 主線頁面：`register`、`login`、`welcome`＋`personalized-onboarding-questionnaire`、`(app)/onboarding`、`merchant-onboarding`、`lib/merchant-onboarding.ts`、`lib/live-publish-readiness.ts`、`dashboard`＋`dashboard-kpis`、`lives`（列表、new、preview、edit 的警告區段）、`live-stepper-form`（幾乎全部）、`use-live-studio-draft`、`actions.ts` 的 `upsertLiveAction` 與 `commitLiveDraft`、`product-form-client`、`form-builder-client`、`message-template-form-client`、`line-official-account-form`、`video-form`、`orders`、`checkout/result`、`commerce-checkout-form`。
- 觀眾端：`(viewer)/live/[slug]/page.tsx`、`live-playback`（對話框、播放器、控制項）、`live-chat-panel`、`live-danmaku`、`scripted-roles-control`、`lead-form`、`registration-submission-client`、`registration-submission-feedback`、`registration-retry-boundary`／`context`、`verify-registration`、`registration-error`、`verified-registration-share`。
- 虛擬使用者：`interaction-role-form`（死碼）、`interaction-roles-workbench`、`interaction-script-form`、`interaction-card-schedule`、`live-interaction-studio`、`lib/interaction-role*.ts`、`lib/live-chat-contract.ts`、`lib/live-chat-analytics.ts` 及其 5 個呼叫端。
- 政策：`lib/public-policy-content.ts`（全文）、`components/public-policy.tsx`。
- 測試：`tests/e2e/accessibility.spec.ts`（全文）、`wp7-one-stop-webinar-flow`、`registration-onboarding`、`registration-native-retry` 的測試標題與 axe 呼叫位置。

## 執行過的命令（摘要，皆唯讀）

1. `git rev-parse HEAD`、`git log --oneline`、`git show --stat 9bf83f4f`（#439 範圍）、`git log -S"<LiveDanmaku"`／`-S"danmaku-strip"`（確認彈幕元件從未掛載、CSS 曾存在於他處）。
2. `grep`／`Glob`：術語掃描（slug、payload、provider、ledger、session、admission、reference、Workspace）、`outline-none` 計數（78 處、36 檔）、`text-slate-400` 計數、`h-8/9/10` 互動元素計數、`text-muted-foreground／text-destructive` 是否定義、各列表頁 `EmptyState`、含 `<table>` 檔案是否有 `overflow-x-auto`、`not-found.tsx` 位置、原始列舉值輸出（`{x.status}`）、`formatDateTime`／`toLocaleString` 是否帶 `timeZone`。
3. `node -e`：以 WCAG 公式計算色彩對比；以 `Intl.NumberFormat("zh-TW",{currency:"TWD"})` 驗證金額輸出格式（「$1,234」「$12,345.00」）。
4. `awk`／`sed`：取得 prisma `Live.slug @unique` 行號、核對各 finding 的行號。

## 沒做到的事與限制

- 沒有瀏覽器實測，因此下列均為「從程式碼推論」：觀眾端英文預設 404（B07-08）、伺服器元件在 Vercel 以 UTC 顯示時間（B07-11）、直播 slug 重複時的未處理 `P2002`（B07-07）、LINE 內建瀏覽器付款回跳（B07-31）、焦點樣式的實際視覺（B07-22）。建議以 390×844 與 1280×800 在 staging 實走第 2 節流程。
- 沒有執行 axe 或 Playwright，不能宣稱現行 a11y 測試通過。
- 色彩對比以 Tailwind 預設色票計算，未涵蓋疊色與透明度。
- `src/app/admin`、`portal`、`affiliate-portal`、`lp` 編輯器、課程學習頁、品牌與追蹤設定頁、講師排版（presenter）未做互動審查。
- 抽獎、投票、快閃搶購的 response 與 presence 計數是否排除虛擬使用者，不在本軸範圍，建議 A 軸補測試。
- `.ai-team/tmp/*` 的舊副本只用來判斷彈幕 CSS 曾存在，沒有採用其內容。

## 結果

BLOCKER 1（B07-01）、MAJOR 18（B07-02～19）、MINOR 13（B07-20～32）、NIT 2（B07-33～34），共 34 筆。「封測前必修」完整 15 筆（B07-01～12、14、15、16），部分必修 2 筆（B07-13 樣式、B07-23 模組隱藏）。需 owner 決策 7 項（虛擬使用者標示策略、彈幕與暖場控制台去留、銷售直播是否強制腳本、註冊同意與商家服務條款、雙重確認、封測隱藏模組清單、LINE 範圍）。

虛擬使用者的留言**沒有**流進商家統計（`live-chat-analytics.ts` 與 5 個呼叫端皆分開計算），因此未標 MAJOR；但標示策略與前台實際畫面、文案、條款四方不一致（B07-04），且講師端的彈幕與手動發送沒有觀眾端承接（B07-05）。
