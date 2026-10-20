# PR #456 輕審：Line C UX（F-083 送出鈕、F-108 報名完成頁、T6 骨架與推播 e2e）

- 分支：`codex/beta-l1b-lineC-ux`（5 個 commit：34d168f1、37c18949、2dc99345、1cce9584、179ce0ff）
- 範圍：`git diff origin/master..HEAD`（已 `git fetch origin master`），28 個檔案，+511／-45
- 審查日期：2026-10-21
- 審查者：reviewer（Opus），只讀，未修改程式

## 本機驗證

| 項目 | 結果 |
|---|---|
| `npx vitest run` verified-registration-next-steps、live-calendar-event、form-submit-button-coverage、admin/loading、app/loading | 5 檔 28 測試通過 |
| `npm run typecheck` | 通過（無錯誤輸出） |
| `npx eslint`（本 PR 變更的 ts/tsx） | exit 0 |
| e2e（affiliate-portal、affiliate-remuneration、course-community、learner-notifications、native-course-learning、student-portal-localization-pwa） | 未執行，以下只做靜態判讀 |

## 重點判讀

1. **方案結帳原生 POST 防重送**（`src/components/billing-plan-checkout-form.tsx`）：送出欄位不變（`_csrf`、`planId`、`platformReferralClickId` 皆為 hidden input，送出鈕本身無 `name`，disabled 不影響 entry list）。`/api/billing/plans/select` 所有分支（handoff、303、JSON 400/500）都會讓頁面離開，所以「鎖住後停在原頁」只會出現在使用者中途按「停止」的情況；bfcache 返回時 `pageshow.persisted` 會解鎖，一般重新整理會重新掛載、state 為 false。Chromium／Safari 下不會卡死。剩下的 Firefox 疑慮見 m-1。
2. **報名確認完成頁**（`src/components/verified-registration-next-steps.tsx`）：只信簽章的 `celebratedeal_form_submission_chat_session` cookie，query string 不會授予任何資訊。查詢條件要求 `VERIFIED` 加上 `verifiedAt` 不為 null，且同時檢查 `live.formId === submission.formId` 與 `live.vendorId === submission.form.vendorId`。狀態只放行 `scheduled`／`live`，與 `publicLiveAvailabilityWhere` 的可播放集合一致，draft 場次不會露出。ICS 會移除控制字元，依 RFC 5545 轉義 `\ ; , 換行`，並以 75 octet 摺行且不切斷 UTF-8，測試涵蓋注入 `END:VEVENT`。Google Calendar 連結只帶場次標題、UTC 時間與公開直播間 URL，沒有報名者 PII、token 或 submissionId。
3. **e2e 定位器** `[role="status"]:not(.sr-only)`：只排除 FormSubmitButton 的隱藏朗讀節點，仍斷言頁面上可見的成功訊息，而且比原本更嚴格，因為要求可見。Playwright strict mode 仍會擋下多個可見 status 的情況。原意保留。
4. **推播 e2e**：在 `ServiceWorker.enable` 之前掛上 `workerVersionUpdated` 監聽，並等待同一 registration 的版本到達 `activated` 才投遞。這符合「push 只派送給 activated worker」的規格，`clients.claim()` 讓 controller 提早出現的說明也正確。沒有新增 retry、skip 或放寬 timeout。
5. **骨架**：`src/app/(app)/loading.tsx` 與 `src/app/admin/loading.tsx` 都是同步的純展示元件，沒有讀取資料。loading boundary 只包住 page，`admin/layout.tsx` 的 `requireFinanceAdmin()` 仍然先於骨架執行，auth 順序沒有改變。

## Findings

| 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|
| MINOR | `src/components/billing-plan-checkout-form.tsx:30-41` | Firefox 會在重新載入或不走 bfcache 的上一頁時，保留 `<button>` 被動態設定的 `disabled`（MDN `<button>` 有註明）。hydration 不會修正這個屬性不一致，而 React state 本來就是 false，不會重繪。情境：使用者在 Firefox 送出後立刻按 F5，或從 PayUni 返回一個 `no-store`、不能進 bfcache 的方案頁，按鈕會一直停在 disabled，只能強制重新整理。屬推論，未在 Firefox 實測。既有的 `NativePostForm` 也有同樣風險。 | 在 `<form>` 加上 `autoComplete="off"`（或加在按鈕上），讓 Firefox 不保存控制項狀態。可補一個 render 斷言。 |
| MINOR | `src/app/portal/[vendorSlug]/page.tsx`（優惠券「立即使用」表單，`method="post" action=".../vouchers/{id}/use"`） | 這是原生 POST，`useFormStatus` 永遠不會 pending，所以換成 `FormSubmitButton` 後沒有 pending 回饋，也沒有防重送。commit 說「補 pending 與防重送」，coverage 測試也把它列為已守護，兩者都與實際行為不符。伺服器端的 `updateMany` 有條件限制，重送只會覆寫 `claimTokenHash`，瀏覽器會跟隨最後一個回應，所以不影響金額，只是保護是假的。 | 改用 `NativePostForm`，或比照方案結帳的 `pendingOverride` 加 ref 鎖定；也可以在 coverage 測試中把它標為原生 POST 例外，並修正 commit／PR 說明。 |
| NIT | `src/components/billing-plan-checkout-form.tsx:34-38` | 防重送判斷讀的是 `submitting` state 的 closure，`NativePostForm` 用的是同步的 `useRef`。React 會在下一個事件前以 microtask flush discrete update，實務上應該擋得住，但兩處寫法不一致。 | 改用 `useRef` 同步鎖，state 只負責 UI；或直接重用 `NativePostForm`。 |
| NIT | `src/app/(app)/consultations/mobile/page.tsx`（4 顆送出鈕） | 「儲存備註」沒有 `name`，在 `FormSubmitButton` 的邏輯裡會落到 `?? true`，所以按「＋ 預算足夠」或「標記成交」時，「儲存備註」也會顯示 spinner。只是外觀問題，送出欄位不變。 | 讓「儲存備註」帶 `name="intent" value="note"` 之類的識別，或讓 `FormSubmitButton` 在無 name 時排除「其他具名按鈕送出」的情況。 |
| NIT | `src/components/verified-registration-next-steps.tsx:56-62` | 行事曆一律用 `live.scheduledAt` 加預設 60 分鐘。若場次為 `isEvergreen`，或狀態仍是 `scheduled` 但時間已過，產生的行事曆時間會誤導使用者。 | 對 `isEvergreen` 或 `scheduledAt < now` 的場次只顯示「前往直播間」，不顯示行事曆按鈕。 |
| NIT | `src/app/verify-registration/page.tsx:30` | 新區塊放在 `role="status" aria-live="polite"` 容器內，螢幕閱讀器會連同場次標題、時間與 3 個連結一起朗讀。 | 把 `<VerifiedRegistrationNextSteps />` 移到 status 容器外的兄弟節點。 |
| NIT | `src/app/admin/loading.tsx:7` | 只有財務權限的使用者，側欄顯示「財務管理」，骨架標題卻是「正在載入平台管理」。 | 改為中性的「正在載入管理頁面」。 |

- BLOCKER：無。
- MAJOR：無。
- 金流金額、租戶邊界、權限、migration：本 PR 不改伺服器端金額、授權或 schema；新的讀取路徑已綁定簽章 cookie、formId 與 vendorId，沒有發現問題。

## 結論

沒有 BLOCKER 或 MAJOR。兩項 MINOR 是 Firefox 的 disabled 狀態保存，以及優惠券原生 POST 的防重送實際沒有作用，都不影響金額或租戶安全，可以在後續 PR 補強。

可合併。
