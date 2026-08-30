# G7-42 客服角色最低權限與最小資料投影

- Work Package：`G7-42`
- 驗證時間：`2026-08-09T12:19:36.530Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`
- Source aggregate SHA-256：`1b24c919da6f58db16da9c519363a74b81100159fd625384721941f6f2329b90`

## 產品問題與實際修改

客服角色原本和 owner／admin 共用 workflow guard，因此能重新指派案件 owner、改變案件狀態。頁面也直接顯示指派與狀態表單。這會讓最低權限客服改變責任歸屬或提前結案。

本 WP 完成以下修正：

- support 保留 buyer-visible reply 與 internal note；兩條 Server Action 仍使用 tenant-scoped `requireVendorSupportMfa`。
- assign owner 與 transition status 改用 `requireVendorManagerMfa`，和既有 refund handoff 一樣只允許 owner／admin 且必須完成 MFA。
- support 頁面仍顯示回覆與內部備註，但不再顯示訂單管理連結、指派、狀態變更與退款交接；owner／admin 保留完整 workflow。
- support request 不再查詢成員名單、`refundHandoff`、付款／退款金額或 `primaryPaymentTransactionId`，也不再嘗試解密退款原因；owner／admin 才會啟動第二個 tenant-scoped 財務投影。
- internal note 與 refund reason 在 Server Action 及 domain 兩層都限制為 trim 後 `1..4000` 字元，阻止直接呼叫 action 寫入空白或超大加密 payload。
- domain 新增 `invalid_content` invariant；不合法內容會在任何 DB read/write 前拒絕。

沒有修改 Prisma schema、migration、正式資料或外部服務。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Support action／page／domain regression | PASS | 4 files，29 tests passed，0 failed，0 skipped |
| Support daily workflow | PASS | support 可公開回覆、可新增內部備註 |
| Manager workflow guard | PASS | assign、transition、refund handoff 都要求 owner／admin MFA context |
| UI role visibility | PASS | support 隱藏管理表單；owner 顯示指派、狀態與退款交接 |
| Minimal data projection | PASS | support 只有共用案件投影；財務欄位、退款原因與 member list 不會讀取 |
| Server Action content boundary | PASS | 空白 note 與超長 refund reason 在 authorization／transaction 前拒絕 |
| Domain content boundary | PASS | invalid content 在任何 case read／event write 前回傳 `invalid_content` |
| Targeted ESLint | PASS | 6 scoped files，exit code 0，無 warning／error |
| Full TypeScript typecheck | PASS | `tsc --noEmit --pretty false`，exit code 0 |
| Independent reviewer | PASS_AFTER_REMEDIATION | 兩輪 finding 均修正；最後複核 no findings |
| Git diff whitespace | NOT_APPLICABLE | 6 個 source／test 檔原本均為 untracked；沒有把 `git diff --check` 的空結果標成 source PASS |
| Browser／external services | NOT_RUN | 權限投影由 render tests 與 Server Action/domain tests驗證，未操作 staging、Production 或外部服務 |

## 執行命令與真實結果

```text
npx vitest run src/app/actions/support-case-actions.test.ts src/app/(app)/support-cases/[id]/page.test.tsx
exit 0：11/11 passed

npx vitest run src/app/actions/support-case-actions.test.ts src/app/(app)/support-cases/[id]/page.test.tsx src/app/(app)/support-cases/page.test.tsx src/lib/support-case-domain.test.ts
最終 exit 0：29/29 passed

npx eslint <6 scoped files>
一次 exit 1：page complexity 36 超過既有 30；將資料讀取與退款 view state 抽出 helper 後，最終 exit 0

npm run typecheck -- --pretty false
exit 0
```

最小資料投影測試第一次因把平行 Prisma 呼叫順序寫死而 1 failed／28 passed；assertion 改為依投影內容辨識呼叫後 29/29 通過。失敗結果沒有被標成 PASS，產品 assertion 未降低。

## Source SHA-256

檔案以 UTF-8 讀取並將 CRLF 正規化為 LF；aggregate 依下列順序串接內容後計算。

```text
8647a4c01a163b53df38644624c9e01084601244afd0fc631467bce4ddd3916c  src/app/actions/support-case-actions.ts
ae593a93e67bef8d1ad349954f915bd3ea2086ba760dc4c138b823e2e279c142  src/app/actions/support-case-actions.test.ts
2f5655566bf82253d35dedbd553279ef882b735f203f2aed658339590c24ff3b  src/app/(app)/support-cases/[id]/page.tsx
b9cf24a7f1b82118ea25eb1c0ea01b4c1168ab582c62255eb936ee51d1bd3ed5  src/app/(app)/support-cases/[id]/page.test.tsx
f615dda26bad048c23893951fcc1c128e610c0de3aa21b6ef03182dac08aea7e  src/lib/support-case-domain.ts
99f31c80ce15cd94c51d0d4e8edae439f904d49f8b82ae964e193af6942dbd67  src/lib/support-case-domain.test.ts
```

## Ownership、安全與回滾

- 6 個 source／test 檔在本 WP 前均為既有 untracked 工作；本次保留既有客服、退款、加密與測試內容，只加入角色收斂、最小投影、內容 invariant 與對應 assertions。
- 同一時間只有主代理寫入這些檔案；reviewer 全程唯讀。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有操作正式 DB、付款、退款、Email、Production deploy 或外部 mutation。
- 沒有 stage、commit、push、merge；沒有 reset、clean、stash、restore、checkout 或 rebase。
- 回滾範圍限於客服 action guards、detail page projection／visibility、domain content invariant 與 tests；schema、migration 與資料不受影響。

## 分數資格

- 固定功能 `refund_support` 可由 `8.2 → 8.3`，core `2.5 → 2.6`。提升來自可實際操作的客服角色分工、Server Action 防繞過與最小資料讀取，不是 coverage 或測試數量換分。
- canonical 總分維持 `74.0`；本地客服功能不能代替 CAT10 真人客服 SLA、政策／法務、external monitoring 或 release acceptance。

## 尚未完成與下一個工作

- CAT04、CAT10 保持明確 blocker，不阻擋其他自主功能。
- 下一個自主工作繼續 FUNC-CLOSURE，優先選擇會影響商家建立內容、買家交易或操作復原且能用本機 deterministic evidence 完成的缺口。
