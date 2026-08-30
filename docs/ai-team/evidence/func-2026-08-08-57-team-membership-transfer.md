# FUNC-2026-08-08-57：Team membership transfer closure

日期：2026-08-08（Asia/Taipei）  
結果：`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`

## 本輪完成的產品功能

補上商家 owner 的「團隊成員轉移」流程：

- `/settings/team` 現在可從來源團隊選擇另一個目標團隊並執行轉移。
- 來源 membership 的 active 上下線關係會在同一個 Serializable transaction 內結束，歷史資料保留。
- 目標團隊若已有 inactive membership，會安全重新啟用；若沒有則建立新 membership。
- 目標團隊已有 active membership、來源／目標相同或租戶／成員狀態不合法時 fail closed。
- 轉移會寫入 bounded audit log，並重新驗證 team／template／performance views。

這關閉的是實際的 F/G 團隊管理 P1，不是只增加測試數量；沒有新增 schema 或 migration。

## Deterministic verification

- `src/app/actions/team-membership-actions.test.ts` 與 `src/app/(app)/settings/team/page.test.tsx`：9/9 PASS。
- scoped ESLint：PASS，0 errors／0 warnings。
- `npx tsc --noEmit`：PASS。
- `git -c core.autocrlf=false diff --check`：PASS。
- `npm run build`：PASS；route manifest 包含 `/settings/team`。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT01=7.5、CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`。本機轉組功能不會冒充 PayUni Sandbox／staging 對帳，也不會冒充 CAT10 真人商家、客服、法務／隱私／退款、財務或 release owner acceptance。

本輪沒有操作 Production、正式資料庫、正式付款／退款、外部 payout、staging、PayUni Sandbox、deployment、push 或 merge；global coverage 未重算，且沒有降低 threshold、inventory、exclude、skip 或 assertion。FIN-08AA、WP-196、WP-197 與其他 terminal external path 均未重試。

