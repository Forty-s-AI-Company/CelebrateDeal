# G7-49：商家 onboarding 銷售直播缺口導引

## 結果

- 狀態：`PASS_LOCAL_DISPOSABLE`。
- 產品問題：商家 onboarding 原先只顯示「可販售直播」布林結果，無法知道缺商品、表單、報名 Email、互動腳本或媒體；付款方式外部驗證也會搶占最上方的「繼續」入口。
- 產品修正：使用共用 Live publish readiness domain，將銷售直播拆成五項資源與最終直播綁定，每一個缺口都提供直接 CTA；付款方式維持必要項目與明確外部狀態，但在本機產品工作尚未完成時不會阻擋建商品、報名流程或直播。
- 純內容直播：Live Studio 原本的 content mode 規則不變，仍只要求可播放媒體；onboarding 的逐項清單明確標示為第一場「可販售」直播，不把 commerce gate 套到內容直播。

## 實際修改與 ownership

- `src/lib/live-publish-readiness.ts`：新增明確 `content`／`commerce` mode override，既有 auto mode 保持相容。
- `src/lib/merchant-onboarding.ts`：建立銷售直播逐項 readiness、直接修復路徑、付款 external-deferred 排序。
- `src/app/(app)/onboarding/page.tsx`：只把 schema 有效的表單、內容完整的 Email 與 ready media 計入，顯示每項缺口 CTA、外部驗證 badge 與可操作狀態。
- 對應 unit/page/E2E tests、focused Browser runner 與 scorecard reconciliation drift test。
- 本輪只接管上述 G7-49 精確 hunks；未回滾或覆蓋其他 dirty worktree 內容。

## Deterministic evidence

| 驗證 | 結果 |
|---|---|
| `npx vitest run src/lib/live-publish-readiness.test.ts src/lib/live-runtime-readiness.test.ts src/lib/sellable-live.test.ts src/lib/merchant-onboarding.test.ts "src/app/(app)/onboarding/page.test.tsx" "src/app/(app)/dashboard/page.test.tsx"` | `6 files / 27 tests PASS`，exit `0` |
| `node --test scripts/g7-function-scorecard-reconciliation.test.mjs`（修正 74.0 漂移時） | `4/4 PASS`，exit `0` |
| `node --test scripts/g7-commerce-browser-qa.test.mjs` | `19/19 PASS`，exit `0` |
| scoped ESLint | `PASS`，exit `0` |

## Final Browser／DB evidence

- Final receipt：`docs/ai-team/evidence/g7-49-onboarding-browser-qa-532104134ca28812.json`
- Receipt SHA-256：`631be1444bced702dee10f067d01a2c1a001c4ff551fcc1f7d96e33fca1864d8`
- UTC：`2026-08-09T17:40:47.711Z` 至 `2026-08-09T17:43:38.236Z`
- 隔離範圍：loopback production server、disposable PostgreSQL tmpfs、fresh Prisma generate、51 migrations；未連外、未讀 user browser profile、未操作正式服務。
- Phases：mirror、Prisma generate／validate／deploy／status、Next production build、server、Browser 全部 `PASS`。
- Browser：具名 contract `1/1 PASS`、desktop/mobile RWD `PASS`、keyboard focus `PASS`、Axe critical／serious `0`、tenant isolation `PASS`。
- Scope truth：onboarding 與 tenant isolation 為 `PASS`；PII、商品交付、買家交付、Email、Live Studio、買家訂單等未由本 focused contract 執行的欄位均為 `NOT_VERIFIED`，沒有借用其他功能的 PASS。
- Cleanup：server、container、tempRoot 全部 `PASS`。

### 截圖

- Desktop：`g7-04-browser-qa-532104134ca28812-screenshots/onboarding-desktop.png`，SHA-256 `8455f23bcbb6b6f5edf49e815a15945abb433f84f567d0c3d402426664266ca0`。
- Mobile：`g7-04-browser-qa-532104134ca28812-screenshots/onboarding-mobile.png`，SHA-256 `26506220aaf9dd22206eda6a5da8eff424251c6b9502a3259e123c1a00122146`。
- 人工檢視：兩張皆顯示真實 2/5 進度、付款「外部驗證，可稍後」、下一個本機工作「啟用報名表單」及 Step 5 的媒體／表單／腳本／直播直接修復路徑；重複的卡片主 CTA 已移除，mobile 沒有水平裁切。

## 保留的失敗證據

- `g7-49-onboarding-browser-qa-4d164ca612dd5eb5.json`，SHA-256 `e8d6e967848464cdd23f67b12883c0513c75fcb17dd38030ea0c9a09b70a3b35`：fixture 的第一個本機缺口其實是表單，測試錯誤預期互動角色。
- `g7-49-onboarding-browser-qa-c0442bc5f2543fa6.json`，SHA-256 `60359d95739a3be414fead4a199e93d3c0fa0b975bb18a29e39c33c98a6f8887`：locator 只取到 Step 5 標題列，沒有涵蓋 checklist。
- `g7-49-onboarding-browser-qa-c6573fc0e13a7fa2.json`，SHA-256 `62dcf4edef08cf49aea97ff6977bfa75f014929c6b85f8147d3a7d94b34fddd8`：卡片主 CTA 與缺口 CTA 同名，strict locator 正確拒絕模糊匹配；最終改為綁定具名缺口列，未刪除 assertion。
- `g7-49-onboarding-browser-qa-2941ce0bdc04b6f0.json`，SHA-256 `080a9d727126e63cb837b153618b60b19a916dc5a86b141ced3af75ad87203fe`：首次 Browser PASS，但 receipt 對 focused contract 未執行的功能範圍寫入 PASS，且尚未驗證 4/5、5/5 與跨租戶污染；保留為已被 final review 取代的歷史證據，不用於計分。
- `g7-49-onboarding-browser-qa-e924ff63c21946d7.json`，SHA-256 `ce7336e15a292aa6ca98a165ecc384bb4bd8bb58cd5e14fa6c8865edb79e19d9`：已修正 scope truth、4/5、5/5 與跨租戶隔離，第一次 final reviewer 仍拒絕計分，因為缺少「付款先完成，但其他本機缺口仍存在」的直接 Browser 狀態；最終 receipt 增加 3/5 不得假完成、移除 synthetic payment 後回到 2/5，再走 4/5、5/5。
- 三份均維持 `BLOCKED_OR_FAILED`，沒有改寫為 PASS。

## 計分、blocker 與回滾

- Final reviewer：`ELIGIBLE_CAT02_PLUS_0_5`，P0 `0`、P1 `0`。第一次 reviewer 的 payment-only evidence gap 已由最終 3/5 → 2/5 → 4/5 → 5/5 Browser 路徑關閉。
- 計分：`merchant_onboarding_settings` 以貼題 fresh evidence 取代先前偏向 app-shell 的證據，`8.4 → 8.7`；CAT02 `8.0 → 8.5`；canonical total `74.5 → 75.0`。
- CAT04 `6.0`、CAT10 `4.5` 維持不變；本輪沒有 PayUni Sandbox、真人法務／財務／客服／release 簽核，也不把 local evidence 冒充外部驗收。
- 回滾範圍：live readiness mode override、merchant onboarding progress/page、對應 tests、focused Browser runner與本 evidence。無 migration、正式資料、正式服務、push、merge 或 deploy。
- 下一個自主工作：完成 score/reconciliation 後，重新掃描未被 fixed scorecard 捕捉的買家 grant recovery、商家模板快速開始與其他實際 P1；CAT04/CAT10 blocker 繼續列待辦後跳過。
