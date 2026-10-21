# PR #465 三審：Line A 封測閘門

- 分支：`codex/beta-l1e-lineA-gates`，PR head 是 `59474df4`。這是合併 master（#467，帳號鎖定剩餘秒數）的 merge commit，沒有修改本 PR 的檔案。
- 三審範圍：`9a06facc`（處理複審的 B-1′）與 `a8c07b01`（把新頁面登記到 WP-88 守門清單）。
- 前兩次審查：`45-pr465-lineA-review.md`、`45b-pr465-lineA-rereview.md`。
- 審查者：reviewer（Opus），只讀。

## 驗證

| 項目 | 結果 |
|---|---|
| CI `quality`（run 39662054397，head `59474df4`） | **pass**，耗時 45 分 3 秒，所有步驟都跑完了，包含之前失敗的「Tracking authoritative events database and browser gate」與「Release browser gates」 |
| `9a06facc` 有沒有放寬斷言 | 22 個檔案，刪 31 行、加 31 行。被刪的 31 行全部是「夾具商家建立時的 `betaFeatureGrants`」那一行，新版只在同一行多加 `enabledFeatureModules`，值一律是 6 個商家模組全開。沒有任何 `expect` 或斷言被修改 |
| `a8c07b01` 有沒有放寬斷言 | 只是把數量 95 改成 96、`platformFinance` 從 12 改成 13，另外新增兩個斷言：`/admin/vendor-features/page.tsx` 在清單裡，而且它的守門被判定為 `platformFinance`。只有變嚴格 |

## 確認事項

1. **夾具全開模組，不會讓閘門測試失去意義。** `9a06facc` 只改了 e2e、browser、disposable 腳本與 seed 的夾具，沒有動任何閘門相關的單元或 DB 測試。模組「關閉」的情境仍然由以下獨立測試覆蓋：
   - `src/lib/feature-gates.matrix.test.ts`：每個模組在開與關兩種狀態下都測一次，並斷言關閉時後面的程式沒有被執行；另有靜態清單鎖住每個入口。
   - `src/lib/feature-gates.db.test.ts`：用真實資料庫確認新商家預設全部關閉、只讀被要求的那家商家、CHECK 約束生效、購買清單會過濾課程商品。
   - `src/lib/vendor-feature-toggles.test.ts`：授權和商家開關必須都打開；讀不到或格式錯誤時一律當作關閉。
   - `src/app/api/payments/checkout/route.test.ts`、`src/app/actions/product-actions.test.ts`、`src/lib/funnel-commerce-service.test.ts`：課程模組關閉時，課程商品不能購買、不能新建或上架，但可以下架。

   夾具全開符合這些 e2e 原本的目的：它們測的是功能本身，不是閘門。此外，`isFeatureEnabled` 要求授權和商家開關同時打開；複審抓到的 B-1′ 正是只給授權、沒開商家開關造成的，這次修正和這條規則一致。
2. **WP-88 清單與頁面實際守門一致。** `src/app/admin/vendor-features/page.tsx` 在頁面開頭呼叫 `requireFinanceAdmin()`（必須是平台管理員、已綁 MFA、這次登入已通過 MFA 驗證），`src/app/admin/layout.tsx` 也會再擋一次。本 PR 只新增了這一個頁面，所以總數 95 → 96、`platformFinance` 12 → 13 都對得上。
3. **seed 的修改不會影響 production。** `prisma/seed.ts` 有 `assertLocalTestDatabase` 保護，只能對本機測試資料庫執行。

## Findings

| ID | 等級 | 檔案:行號 | 說明 | 建議 |
|---|---|---|---|---|
| — | BLOCKER／MAJOR | — | 沒有 | — |
| m-6（沿用） | MINOR | `src/app/actions/vendor-beta-feature-actions.ts` | AuditLog 仍然在交易之外寫入。這和既有 admin 操作的寫法一致，不阻擋合併 | 之後統一處理 admin 稽核寫入時一併修 |
| N-1 | NIT | `tests/e2e/*` | 沒有一個瀏覽器層級的測試，實際走一遍「模組關閉時，直接輸入網址會看到 404」。這個情境目前由單元與 DB 測試覆蓋，風險低 | 可以之後在 WP-88 的直接網址矩陣加一個「未授權商家」的案例 |
| N-2（沿用） | NIT | `src/lib/team-funnel-pages.ts:475` | 團隊漏斗頁仍會列出課程商品。下單入口已經擋住，只影響畫面 | 之後改用 `purchasableProductWhere` |

## 結論

複審的 B-1′ 已修正，CI `quality` 在目前的 PR head `59474df4` 完整跑綠。夾具的修改沒有放寬任何斷言；模組關閉的情境仍有獨立測試覆蓋。WP-88 清單和頁面的實際守門一致。沒有剩下的 BLOCKER 或 MAJOR。

可合併
