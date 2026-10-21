# PR #463 輕審報告（Line C：UX／文案／分享預覽）

- 分支：`codex/beta-l1d-lineC-ux`（HEAD `0dcbff82`，5 個 commit）
- 範圍：`git diff origin/master..HEAD`（已 `git fetch origin master`）
- 審查日期：2026-10-21
- 審查方式：唯讀閱讀 diff 與相關呼叫端，並在 worktree 執行驗證（未修改任何檔案）

## 已執行的驗證

| 指令 | 結果 |
|---|---|
| `npx vitest run` 跑 9 個相關測試檔（glossary 掃描、`/live/[slug]`、`/p/[slug]`、互動台、直播表單、商品表單、onboarding、影片表單、app-shell） | 9 檔、98 個測試全數通過 |
| `npm run typecheck` | 通過 |
| `npm run lint`、e2e | 未執行 |

## 各重點結論

1. **generateMetadata 不洩漏內容**：`/live/[slug]` 用的是和頁面相同的 `findFirst` 條件加上 `getRuntimeLivePublishReadiness(...).ready`；`/p/[slug]` 只在 `state === "ready"` 時輸出內容。其他情況一律回傳 `{ title: "頁面不存在", robots: noindex/nofollow }`，不含標題、描述或 OG 圖。草稿、未就緒、已停用、未發布、夥伴停權、缺 slot 都會走這條路。metadata 輸出的欄位（標題、促銷短句或描述、封面、商家名稱、夥伴名稱、場次標題）頁面本身也都會公開顯示，沒有多露資料。`shareImageUrl` 會擋掉 `javascript:` 和 `//` 這類網址。兩個頁面都用 React `cache` 包住 loader，slug 的 key 也一致（live 用原始 slug，p 用 decode 後的 slug，和頁面相同）。依 `node_modules/next/dist/docs` 的說明，這個 cache 在同一個請求內由 metadata 與 page 共用，所以不會多打一次 DB。
2. **詞彙替換**：e2e 定位器已同步更新（`商品網址`、`原始頁網址`、`你的公開網址`、`影片／即時直播`、`目前登入狀態：…`、`建立商家工作區`、`影片服務狀態：ready` 等），新標籤在 `src/` 中都只出現一次，不會讓 `getByLabel` 匹配到多個元素。會計直連頁的金絲雀（`accountant-brand-settings-direct-url.spec.ts` 的 `toHaveCount(0)` 清單）已把 `品牌 Slug` 改成 `品牌網址`，所以這個斷言仍然有效，不會變成永遠通過。`tests/`、`scripts/` 裡沒有殘留舊字串的定位器。例外清單（admin、隱藏中的 billing／affiliates、LINE 設定頁只放行特定詞）都附了理由，也有測試檢查路徑存在，合理。課程分潤欄位只在選「課程」時渲染；server 端 `parseCoursePolicy` 和寫入時本來就會把非課程商品的 policy 設成 null，課程商品編輯時欄位以 `draft` 的既有值作為 defaultValue。**已存的分潤值不會遺失，金額與分潤邏輯也沒有變更。**
3. **互動台收合**：所有表單、按鈕與輪詢 effect 都還在 `<details>` 裡（只是收合，不是卸載），講師原有功能保留。`<summary>` 原生就能用 Tab、Enter、Space 操作，也有自己的 focus-visible 外框。e2e 沒有操作互動台內的控件，所以收合不會讓 e2e 壞掉。
4. **焦點外框與 44px**：`ui.tsx` 拿掉 `outline-none` 之後，改由 `globals.css:66` 的全域 `:where(...):focus-visible { outline: 3px; outline-offset: 2px }` 接手，鍵盤焦點變得可見。直播表單控件從 `h-10/min-h-10` 改成 `h-11/min-h-11`，只多 4px，看起來不會破版（未做瀏覽器實測）。LINE 頁原本未定義的 `text-muted-foreground`、`text-destructive` 已改成 slate／red 色票，`src/` 裡沒有殘留。
5. **Onboarding 標籤**：`merchant-onboarding.ts` 的 actionLabel 已和 `registration-onboarding.spec.ts`、`smoke.spec.ts` 同步。

## Findings

| 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|
| MINOR | `src/app/p/[slug]/page.tsx`、`src/app/p/[slug]/page.test.tsx`、`src/app/(viewer)/live/[slug]/page.tsx`、`src/app/(viewer)/live/[slug]/page.test.tsx` | 這 4 個檔案的換行從 LF 整檔改成 CRLF（已用 `od -c` 確認 master 是 `\n`、HEAD 是 `\r\n`）。實際改動只有約 90 行，但 diff 膨脹到約 1,780 行，`git blame` 整檔歸到這個 PR。之後其他 Line 改到同檔時，也很容易產生整檔衝突。 | 合併前把這 4 檔轉回 LF（例如 `git add --renormalize` 搭配 `core.autocrlf=input`，或手動轉換），讓 `git diff --stat` 和 `--ignore-cr-at-eol` 的結果一致。另外可考慮補 `.gitattributes`（`* text=auto eol=lf`）。 |
| MINOR | `src/lib/ui-copy-glossary.test.ts:58-59` | 掃描器只檢查 JSX 文字，以及「含中文」的字串常值；只有英文的屬性字串會被略過。例如 `src/app/(app)/settings/tracking/page.tsx:29` 的 `label="Meta CAPI Access Token"` 目前不會被抓到，原本的 `label="Slug"` 這種寫法也會漏掉。另外它只掃 `src/app`、`src/components` 裡的 `.tsx`，`src/lib/*.ts` 裡會顯示給使用者的文案沒有涵蓋，例如 `src/lib/announcement-feed.ts:75,95` 的公告仍寫著「Live Input」「staging」；本 PR 的 onboarding 文案就是改在 `src/lib`。 | 對 `label`、`placeholder`、`title`、`description`、`aria-label` 這些 JSX 屬性的字串常值，不論是否含中文都要檢查。另外把 `merchant-onboarding.ts`、`announcement-feed.ts` 這類 UI 文案模組列入掃描。如果 Meta 欄位名稱要保留，就比照 LINE 加入有理由的例外。 |
| MINOR | `src/components/live-interaction-studio.tsx:95` | 互動台一律預設收合。直播進行中如果有待審核的觀眾問答、進行中的投票或抽獎（`initialQuestions`、`initialPollRuns`、`initialDrawRuns` 不為空），講師重新整理後會看不到待處理項目，可能漏掉審核。 | 有進行中或待處理項目時預設展開，例如 `open={hasPendingWork}`；或在 summary 上顯示待處理數量。 |
| MINOR | `src/components/live-interaction-studio.tsx:99` | 原本的 `<h2 id="live-interaction-studio-title">` 被改成 `<span>`，螢幕報讀器用標題導覽時找不到這一區；而且整段說明都放在 summary 裡，按鈕的可存取名稱會變得很長（包含「進階…一般銷售直播用不到…展開」）。 | 在 summary 裡保留 `<h2>`（HTML 允許 heading 放在 summary 內），把長說明移到 summary 外，或用 `aria-describedby` 指向它。 |
| NIT | `src/components/live-interaction-studio.tsx:96` | Safari 不會因為 `list-none` 隱藏 `<summary>` 的展開三角形，可能和「展開／收合」文字重複出現。 | 加上 `[&::-webkit-details-marker]:hidden`。 |
| NIT | `src/components/product-form-client.tsx:360` | 課程欄位改成條件渲染後，切換「課程 → 其他 → 課程」會讓欄位重新掛載，回到 `draft` 的預設值，講師剛輸入但還沒儲存的分潤設定會被清掉。已儲存的值不受影響。目前也沒有測試覆蓋欄位顯示或隱藏。 | 改用 `hidden` 搭配 `disabled` 保留 DOM，或改成受控狀態；並補一個渲染測試，確認選課程時有欄位、選其他類型時沒有。 |
| NIT | `src/app/(app)/settings/team/page.tsx`；`src/app/(app)/lives/[id]/edit/page.tsx` | 文案有多餘空格：「建立後 擁有者會自動加入」「影片或即時直播 已無法播放」。團隊頁把 slug 稱為「網址」，卻又說「網址只用於內部識別」，前後矛盾；同一頁還殘留「位 active 成員」。 | 刪掉多餘空格；團隊 slug 可改稱「團隊代稱」；`active` 改成「啟用中」。 |
| NIT | `src/components/video-provider-status.tsx`、`src/app/(app)/lives/[id]/preview/page.tsx` | 「影片服務狀態：ready／processing／error」的值仍是英文；「Cloudflare 即時直播：{uid}」其實顯示的是一串識別碼。 | 狀態值改成中文（e2e 要同步）；標籤改為「即時直播編號」。 |
| NIT | `docs/product/glossary.md` | 詞彙表列了 `CTA → 按鈕`，但掃描器的 FORBIDDEN 沒有 CTA，步驟名稱「留言、商品浮窗與 CTA」也還在畫面上。 | 要嘛把 CTA 加入掃描並改掉文案，要嘛在詞彙表註明 CTA 暫時不強制。 |

- BLOCKER：無。
- MAJOR：無。沒有金流、租戶邊界、權限或 migration 的變更；metadata 沒有洩漏未發布的內容。

## 結論

主要風險點（未發布內容透過 metadata 外洩、多打 DB、e2e 定位器與會計金絲雀失效、課程分潤值遺失）都沒有發現問題，相關測試與 typecheck 也通過。其中 CRLF 換行雜訊建議在合併前轉回 LF，其餘 MINOR 和 NIT 可以另開 follow-up 處理。

可合併
