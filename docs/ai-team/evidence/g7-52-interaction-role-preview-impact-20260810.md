# G7-52：互動角色預覽、透明標示與使用影響

## 結果

- 狀態：`PASS_LOCAL_DISPOSABLE`。
- 商家在建立或編輯互動角色時可即時預覽暱稱、頭像、顯示標籤、語氣與啟用狀態。
- 頁面明確說明角色與訊息來自商家預先設定腳本，不代表真人、即時留言、觀看人數、報名、訂單、付款、評論或成效。
- 編輯頁會列出引用角色的腳本、事件數與同商家直播數；停用或刪除前會顯示實際影響並提供腳本檢查入口。
- 刪除按鈕即使表單內有無效必填欄位，仍必須完成 destructive confirmation；取消確認後資料不會刪除。
- 直播 aggregate 使用 vendor-filtered relation count。驗收刻意注入外商家 live 指向本商家 script，UI 仍只顯示本商家數量。

## 實際修改與 ownership

- `src/lib/interaction-role-usage.ts`、對應 test：建立不含事件內容的 bounded merchant-facing usage summary。
- `src/app/(app)/interaction-roles/[id]/edit/page.tsx`、對應 test：vendor-scoped role／script 查詢與 vendor-filtered live count。
- `src/components/interaction-roles-workbench.tsx`、對應 test：角色預覽、透明說明、停用／刪除影響與可存取狀態。
- `src/components/form-submit-button.tsx`、對應 test：修正 `formNoValidate` destructive submit 可跳過確認的 P1。
- `tests/e2e/commerce-orders.spec.ts`：角色預覽、停用警示、刪除確認、DB 保留、跨租戶污染、desktop／mobile／Axe contract。
- `scripts/g7-commerce-browser-qa.mjs`、對應 runner test：G7-52 focused source-attested receipt。
- 本輪只接管上述精確 hunks；沒有覆蓋其他 dirty worktree ownership。

## Deterministic evidence

| 驗證 | 結果 |
|---|---|
| targeted Vitest | `4 files / 20 tests PASS`，exit `0` |
| `node --test scripts/g7-commerce-browser-qa.test.mjs` | `22/22 PASS`，exit `0` |
| `npm run typecheck` | `PASS`，exit `0` |
| scoped ESLint | `PASS`，exit `0` |
| `npm run typecheck:strict-index` | `FAIL`，exit `1`；7 個既有錯誤位於 invoice、support case、actions、Live Studio draft、policies、usage estimation，G7-52 修改檔案沒有出現在錯誤清單 |

## Final Browser／DB evidence

- Receipt：`docs/ai-team/evidence/g7-52-interaction-role-browser-qa-56b3e9706e8b2648.json`
- SHA-256：`fe583c8551b26c845d7fb8b8f1813d24d940030b8ef2da081e40a78b5054dc8f`
- UTC：`2026-08-09T19:22:46.729Z` 至 `2026-08-09T19:25:29.622Z`。
- Fresh Prisma generate、51 migrations、Next production build、server 與 Browser 全 `PASS`。
- Browser：具名 contract `1/1 PASS`，`interactionRole=PASS`、`tenantIsolation=PASS`、Axe critical／serious `0`、desktop／mobile RWD `PASS`。
- Cleanup：server、container、tempRoot 全 `PASS`；loopback-only、PostgreSQL tmpfs、無 external／production operations。

### 截圖

- Desktop：`g7-04-browser-qa-56b3e9706e8b2648-screenshots/interaction-role-desktop.png`，SHA-256 `6e95bad050a1abd591571186e100441fac2370144a0e7afae1b59456458860f5`。
- Mobile：`g7-04-browser-qa-56b3e9706e8b2648-screenshots/interaction-role-mobile.png`，SHA-256 `595f60fb81f18271d63e04d6de008f5a206ddcece3584108c0e0ab0f0011004b`。
- 人工檢視：角色編輯、預覽、影響警示與腳本入口在 desktop／390px mobile 均可讀；沒有 document-level 水平溢出。

## 保留的失敗與歷史證據

- `g7-52-interaction-role-browser-qa-ed9208459afb91d8.json`，SHA-256 `242fc4fcaa272db3a5fda97dd09cd164c93cf73b417236e18c4efc7b38a100bf`：首次 Browser 驗收的 alert locator 同時命中 usage alert 與 Next route announcer，維持 `BLOCKED_OR_FAILED`。後續 selector 限定在 usage region，沒有降低 assertion。
- `g7-52-interaction-role-browser-qa-007f5d0f91b15ed2.json` 與 `g7-52-interaction-role-browser-qa-3391b81a390e8b81.json` 是較早 source lineage 的 PASS。最終計分只引用 `56b3e9706e8b2648`，因為它同時包含 destructive confirmation Browser proof 與 tenant-filtered aggregate。

## Review、計分、限制與回滾

- 初次 reviewer 找到 P1 destructive confirmation bypass 與 P2 cross-tenant aggregate；兩者修正後，final reviewer 確認 P0 `0`、P1 `0`、release-blocking P2 `0`。
- 固定功能 `interaction_roles` 由 `8.1→8.5`：recovery `1.5→1.6`、UX `1.6→1.8`、fresh evidence `1.5→1.6`。
- Canonical CAT 與總分維持 `75.5`。本 evidence 是單一功能的產品與 UX 改善，不重複計入 CAT01／CAT03／CAT06／CAT07；CAT04 `6.0`、CAT10 `4.5` 的外部／真人 blocker 不變。
- 保留 P3：大量事件目前仍由 application memory 聚合，後續可改成 DB aggregate；目前查詢不讀取 message content，且不構成 release blocker。
- 未執行 staging、Production、正式付款／退款、push、merge、FIN-08AA、WP-196 或 WP-197 禁止路徑。
- 回滾範圍：usage summary、edit-page relation count、workbench preview／impact、shared destructive confirmation condition、對應 tests 與 focused Browser runner；無 migration、正式資料或外部狀態。
- 下一個最高價值工作：重新掃描 registration form、Email 與其他販售流程的 current source P0／P1，優先選會直接影響建立成功率、交易轉換或客服處理的功能缺口。
