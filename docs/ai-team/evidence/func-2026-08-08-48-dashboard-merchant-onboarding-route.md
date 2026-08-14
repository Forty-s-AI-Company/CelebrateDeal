# FUNC-2026-08-08-48｜Dashboard merchant onboarding route

## 結果

把商家 onboarding 的八階段 owner handoff 入口接回主 Dashboard checklist。manager 會在同一個 onboarding 區塊看到「設定付款方式」與「完成商家 onboarding」；付款方式只有在 vendor 有 verified 且未過期 reference 時標記完成，onboarding 仍明確保持未完成，因為其中包含客服、政策、外部 provider 與真人 release acceptance。

Dashboard 連結到 `/merchant-onboarding` 後，owner 可再進入客服／付款協助與政策中心。這讓現有 CAT10 local contract 成為可操作的商家路徑，沒有把文件存在或 AI 產生的草稿當作真人簽核。

## 實作範圍

- `src/lib/dashboard-checklist.ts`
  - 新增 verified payment method checklist item 與 merchant onboarding owner item。
- `src/app/(app)/dashboard/page.tsx`
  - 以 vendor scope 查詢有效付款方式，將實際狀態傳入 checklist。
- `src/app/(app)/dashboard/page.test.tsx`
  - 驗證 scope、expiry filter、owner checklist rendering。
- `src/lib/dashboard-checklist.test.ts`
  - 驗證 manager／non-manager 可見性與項目順序。

## 驗證

- targeted regression：2 files／13 tests，13 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- 沒有 schema／migration 變更；沒有 staging、PayUni、Production、外部付款、部署、push 或 merge 操作。

## 分數與限制

- canonical readiness total 仍為 73.5；CAT04=6.0、CAT10=4.5；`current_goal_score_change=0`。
- Dashboard 導引改善 CAT10 的 local operational path，但不能取代 merchant、support／finance、legal/privacy/refund、monitoring 或 release owner 的真人／外部 acceptance。
- PayUni setup adapter、Sandbox receipt、recurring／overage orchestration 仍未完成。
- Global coverage 本輪未重跑；沒有降低 threshold、inventory、exclude、skip 或 assertion。

## 安全界線

沒有讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶資料或付款資料；沒有操作正式 DB、正式付款／退款／寄信、deployment，也沒有重試 FIN-08AA、WP-196、WP-197。
