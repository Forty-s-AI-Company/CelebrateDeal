# G7-01 Launch integrity checkpoint — 2026-08-08

## 結論

- 狀態：`PASS_LOCAL_DETERMINISTIC`
- canonical 分數：維持 `73.5`；本 WP 不冒充 PayUni Sandbox、真人財務簽核或 release acceptance。
- 功能 scorecard：`聯盟／課程分潤／settlement／payout` 可由原 provisional `6/10` 調整為 local-evidence candidate `7/10`。理由是核心分帳、衝突復原、平台與商家 payout 分離、pending 防重送及 fresh disposable DB 證據已具備；外部金流與真人簽核仍是 release blocker。
- 下一個最高產品價值工作：G7-02 必做的互動角色／虛擬使用者完整事件編輯器。

## Ownership 與實際修改

- G7-00 起始 worktree 有 418 筆 dirty entry；本 WP 保留既有變更，只對列出的檔案做精確 hunk 修改。
- 未 stage、commit、push、merge 或 deploy；未執行 reset、clean、stash、restore、checkout 或 rebase。
- 新增的 G7 專用檔案：
  - `scripts/g7-finance-disposable-qa.mjs`
  - `vitest.g7-finance-db.config.ts`
  - 本 checkpoint 文件
- 產品修正：
  - 新建直播預設保持 `draft`，不因建立動作直接公開。
  - 平台 vendor settlement payout 與商家 affiliate payout 分離；平台 payout 不再把 merchant-owned commission 一起標成 paid。
  - payout paid transition 原子驗證同 vendor、同 batch、同 settlement 金額與 `ready_for_payout` 狀態；不符時整筆 rollback。
  - invoice checkout redirect 與 form-post URL 都經 allowlist；已付款／不可付款帳單不再顯示 stale checkout。
  - `?status=paid` 不能讓未付款帳單顯示假成功訊息。
  - form submission 只轉換 server-validated exact affiliate click；新增 Live share 對 exact vendor/live、停用、過期、missing/cross-live 與 duplicate-before-validation 的測試。
  - 建立付款、月結、鎖單、平台出款與商家聯盟出款都提供 pending label、disabled 防重送、`aria-busy` 與 live status。

## Disposable PostgreSQL 證據

- Receipt：`.ai-team/reports/g7-01-finance-disposable-20260808.json`
- Receipt SHA-256：`CA022110584C378978850394006A2348E4AE04D63A43C9F432BF4E8D1593E1E1`
- UTC：`2026-08-08T00:23:12.968Z` 至 `2026-08-08T00:23:27.649Z`
- 命令：`node scripts/g7-finance-disposable-qa.mjs`
- Exit code：`0`
- 結果：34/34 canonical migrations；1 個 exact suite；5/5 tests PASS；0 failed；0 skipped。
- 驗證案例：
  1. concurrent payout batch 只有一個 claimant。
  2. concurrent settlement lock 只建立一筆 merchant affiliate payout。
  3. merchant affiliate payout outcome 會保存人工 reference 並正確結清 commission。
  4. platform payout 只結清 vendor settlement，affiliate commission 保持 locked、affiliate payout 保持 pending。
  5. settlement eligibility 不符時，payout item、batch、settlement 與 audit 全部 rollback／不寫入。
- 邊界：新建 `postgres:16-alpine`、隨機名稱與 labels、`127.0.0.1` 隨機 port、tmpfs、synthetic fixtures only；未讀 source `.env*`；未碰正式資料；marker 驗證後只移除本次容器。
- Cleanup：container `PASS`、temp root `PASS`；事後沒有任何 `celebratedeal-g7-finance-*` 容器殘留。

## 其他 fresh 驗證

- Targeted Vitest：10 files、232 tests PASS、0 failed、0 skipped；exit `0`；duration `14.44s`。
- TypeScript：`npx tsc --noEmit`，exit `0`。
- ESLint：14 個 G7 source／test／runner 檔案，exit `0`。
- Runner syntax：`node --check scripts/g7-finance-disposable-qa.mjs`，exit `0`。
- 唯讀 reviewer：0 個 P0；提出 2 個 P1、3 個 P2。兩個 P1（stale invoice checkout、過寬 settlement transition）與兩個相關 P2（query 假成功、pending wrapper layout）已修；Live share route test gap 已補。Reviewer 本身未被當成 test PASS。

## Source digests（SHA-256）

| 檔案 | SHA-256 |
| --- | --- |
| `src/app/actions.ts` | `A75DAD2E5E501118764254CAE64B0E9C18B65C1F32DE4D81EB35934BF16DA2E2` |
| `src/app/actions.test.ts` | `AB435226C555ECE626655DF6FA1CEBAF97888A89E4D99755A56F1535331AFDFB` |
| `src/app/actions.payout-db.test.ts` | `2BCF39A09EF97EAB677B4F690C2326441A7C02F8238D9B4E8A589961E7D01C1B` |
| `src/app/api/form-submissions/route.ts` | `70BF71CB87F76FF66101690717F6195A9BEE2F654A7E62CFE0B1BAFF9508871C` |
| `src/app/api/form-submissions/route.test.ts` | `7D0BD3B75EFB442D1A01B3D663AE50C8DE25AE12B85F436BD327C9904D779BAC` |
| `src/app/(app)/billing/invoices/[invoiceId]/page.tsx` | `00604863ABB3D3FECD4DFC34BEF1F8E8B12A2AF1C2E2EDABF0E2E3FF60617852` |
| `src/app/(app)/billing/invoices/[invoiceId]/page.test.tsx` | `D81469F530E6DAFB71AD547901A38588A9481E643D612E0D57A5B1CFDCD35592` |
| `src/components/form-submit-button.tsx` | `630F17C578673F0992F8DF4425AE086A53F06EB771E9F61672BE6F5CDA100B82` |
| `src/components/form-submit-button.test.tsx` | `8DF1F9A0F9A6E78CBBF69EFA3BD1565E38049DE3FA35E661A5358284CAC0B327` |
| `src/app/admin/billing/payouts/page.tsx` | `34689B1FCC35A6A4AAD12CE1C8F2995A121641210DF74B129D4815612E127EEA` |
| `src/app/admin/billing/settlements/page.tsx` | `A60D6E6F8655768FDFD39368D32F5795879A58870972BB3891BC308B0E9F4E71` |
| `src/app/(app)/affiliates/commissions/page.tsx` | `A71434B25FEF034AA02441CCFDCF4154E2F2235B35AB2C489A046D56F4E0CC05` |
| `scripts/g7-finance-disposable-qa.mjs` | `52FE4D1F9D1E1359F39474E9215F6F001536249C970AC82577298030B6B52189` |
| `vitest.g7-finance-db.config.ts` | `C496CE895F6027C60E916044BA83B6F1F89B268D19A5BB69CB1BA41BA7B60FD0` |

## 尚未完成／人工 blocker

- 尚未在本 WP 建立 fresh PayUni Sandbox provider evidence；不得把 deterministic adapter／DB 測試冒充外部成功付款。
- 真人仍須負責銀行／KYC／稅務、實際出款 reference 正確性、財務核准與 release sign-off。
- canonical CAT04／CAT10 與總分在 release reconciliation 前維持既有值；這些 blocker 不阻擋 G7-02 與其他產品功能。

## 回滾範圍

- 只反向套用本文件列出的 G7 精確 hunks及刪除兩個 G7 專用 runner/config；不得用 Git reset／restore 覆蓋同檔既有 dirty changes。
- DB runner 的唯一外部狀態是已 cleanup 的 disposable container；無正式資料或付款可回滾。
