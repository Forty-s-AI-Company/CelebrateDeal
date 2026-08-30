# G7-53：報名表單草稿復原與版本衝突保護

## 結果

- 狀態：`PASS_LOCAL_DISPOSABLE`。
- 商家修改表單後，瀏覽器會自動保存有界、經 schema 驗證的本機草稿；重新整理或重新開啟頁面時，必須由商家明確選擇恢復或捨棄。
- 草稿 key 同時包含 authenticated vendor scope 與 form id；同一瀏覽器切換兩個商家時不會互讀草稿。
- 編輯儲存使用 `id + vendorId + updatedAt` compare-and-swap。較舊分頁不能覆蓋新版伺服器內容；reload 後的 stale 草稿只允許捨棄，不提供直接恢復。
- 一般 server-side 儲存失敗後，畫面內容會重新寫回草稿，reload 後仍可恢復；成功儲存並 redirect 後不會殘留舊草稿。
- 公開表單原本已有 native form POST、same-origin guard、303 confirmation redirect 與 deterministic tests；掃描代理提出的 no-JavaScript P1 經 current source 反證後排除，沒有重做已完成能力。

## 實際修改與 ownership

- `src/lib/registration-form-draft.ts`、對應 test：bounded draft envelope、field schema 驗證、vendor／form scoped key、server base version 與 stale 判定。
- `src/components/use-registration-form-draft.ts`：以 `useSyncExternalStore` 同步 localStorage；debounced autosave、恢復、捨棄、提交前清除與失敗後重新保存。
- `src/components/form-builder-client.tsx`、`src/components/form-builder.tsx`、對應 tests：草稿提示、可存取狀態、恢復／捨棄 UI、`expectedUpdatedAt` claim。
- `src/app/(app)/forms/new/page.tsx`、`src/app/(app)/forms/[id]/edit/page.tsx`：只使用 authenticated vendor id 建立 draft scope。
- `src/app/actions/form-actions.ts`、對應 test：tenant-scoped `updatedAt` CAS、缺版本與 conflict fail closed。
- `scripts/g7-form-builder-browser-qa.mjs`、對應 runner test：G7-53 source-attested disposable Browser contract 與完整 PASS receipt validator。
- 本輪只接管上述精確 scope；未覆蓋其他 dirty worktree ownership，無 migration。

## Deterministic evidence

| 驗證 | 結果 |
|---|---|
| registration form targeted Vitest | `13 files / 73 tests PASS`，exit `0` |
| runner contracts | `11/11 PASS`，exit `0` |
| `npm run typecheck` | `PASS`，exit `0` |
| production／test scoped ESLint | `PASS`，exit `0` |
| `npm run typecheck:strict-index` | `FAIL`，exit `1`；7 個既有錯誤位於 invoice、support case、actions、Live Studio draft、policies、usage estimation，G7-53 修改檔案沒有出現在錯誤清單 |

## Final Browser／DB evidence

- Final receipt：`docs/ai-team/evidence/g7-53-form-draft-browser-qa-5088a7b2f2678e59.json`。
- Receipt SHA-256：`ef88021952cdcedbde74353f911f632bed07c717d28a1d4b692fcd37bbfa0023`。
- UTC：`2026-08-09T20:00:24.979Z` 至 `2026-08-09T20:03:25.259Z`。
- Source digest：`815b1d9e1a01d98ea084923f64f7aab21eb54b951d4c78c9077c1a637a483147`，final readback 與 current covered production source 相符。
- Fresh Prisma generate、51 migrations、Next production build、server 與 Browser phases 全 `PASS`。
- Browser：`9/9 PASS`、failed `0`、skipped `0`；autosave、restore、discard、clear-after-save、server-failure recovery、same-browser cross-tenant isolation、CAS conflict、stale conflict fail-closed 全 `PASS`。
- UX：desktop／390px mobile RWD `PASS`、keyboard `PASS`、loading `PASS`、Axe critical／serious `0`。
- Cleanup：synthetic rows、server、精確標記 container、temp root 全 `PASS`；loopback-only、PostgreSQL tmpfs、無 external／production operations。

### 截圖

- Desktop：`g7-53-form-draft-browser-qa-5088a7b2f2678e59-screenshots/desktop.png`，SHA-256 `eff307713c0d20cfed69e2276d00a94a5af23c0ed1817fc29b29edbcffef0e6a`。
- Mobile：`g7-53-form-draft-browser-qa-5088a7b2f2678e59-screenshots/mobile.png`，SHA-256 `25bfd68810ac4a07a7447ee42bd85fdd0b8019968eac6308acfccc4c4c5b5765`。

## 保留的前輪與失敗證據

- `g7-53-form-draft-browser-qa-b61d3d35ec8c338f.json`：7/7 Browser PASS，但尚未證明失敗後恢復、same-browser cross-tenant isolation，且 receipt validator 過寬，因此不作 final scoring evidence。
- `g7-53-form-draft-browser-qa-e57050c1b7a901fb.json`：8-cell reviewer 補驗為 `BLOCKED_OR_FAILED`；原 locator 錯把 CAS stale 草稿期待成可直接恢復。此失敗導向兩條不同驗收：一般 server failure 必須可恢復，CAS stale 必須 fail closed。
- 兩份歷史 artifact 保留原狀；未刪除、未改寫，也未標成 final PASS。

## Review、計分、限制與回滾

- 初次 reviewer：P0 `0`、P1 `0`，提出三個 evidence P2：失敗後恢復、same-browser tenant scope、receipt validator 完整性。
- 補驗後 final reviewer：`ELIGIBLE`，P0／P1／P2 均 `0`；receipt source digest、sidecar、screenshots 與 validator negative cases均已唯讀重核。
- 固定功能 `registration_form_builder` 由 `8.2 → 8.7`：recovery `1.5 → 1.8`、UX `1.7 → 1.8`、fresh evidence `1.5 → 1.6`；core `2.5`、integrity/security `1.0` 維持。
- Canonical CAT 與總分維持 `75.5`。CAT02 已有 onboarding evidence，CAT06 仍需要完整 staging matrix；本輪不把單一表單的本機 Browser evidence重複加到 canonical。
- CAT04 `6.0`、CAT10 `4.5` 的外部／真人 blocker 繼續旁路；未執行 staging、PayUni Sandbox、Production、正式付款／退款、push、merge、FIN-08AA、WP-196 或 WP-197。
- 回滾範圍：draft parser／hook、builder draft UI、`updatedAt` CAS、兩個 forms page 的 scope prop、對應 tests 與 focused Browser runner；無 migration、正式資料或外部狀態。
- 下一個最高價值工作：Email 商家營運體驗中，優先比較 delivery history 可追溯分頁與 suppression 管理，選擇直接降低客服處理成本且可完整驗收的功能。
