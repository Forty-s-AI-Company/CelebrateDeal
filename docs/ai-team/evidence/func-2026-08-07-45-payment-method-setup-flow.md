# FUNC-2026-08-07-45｜Merchant payment method setup flow

## 結果

完成商家後台 `/billing/payment-methods` 付款方式設定頁與 Server Action。財務角色可以看到商店層級與成員層級的付款方式驗證狀態，並從目前商家 scope 發起 provider setup。成員 setup 會再次以 `vendorId`、`teamId`、`membershipId`、啟用狀態在 server 端查證，跨商家或非啟用成員會 fail closed。

頁面只呈現 provider、scope、狀態與時間，不渲染 provider customer reference、payment method reference、卡號或 token。provider 回傳的 redirect 會先經過 credential-free HTTP(S) 邊界；form-post、manual、malformed URL 與 provider setup exception 都會回到明確的安全狀態，不會把 payload 放進 query string 或自行保存。

付款方式設定頁已加入財務角色導覽。這是可操作的產品入口與安全邊界，並不宣稱 PayUni setup、recurring auto-charge 或外部付款已完成。

## 實作範圍

- `src/lib/payment-method-setup.ts`
  - scope parser、ID boundary、provider setup redirect validation 與 mode disposition。
- `src/app/actions/payment-method-actions.ts`
  - CSRF／origin security、finance role、tenant membership ownership、optional adapter dispatch 與 fail-closed redirects。
- `src/app/(app)/billing/payment-methods/page.tsx`
  - vendor／membership setup forms、safe status display、provider capability state 與 sanitized error feedback。
- `src/components/app-shell.tsx`
  - 財務角色的付款方式導覽入口。

## 驗證

- targeted regression：4 files／17 tests，17 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- 沒有 schema／migration 變更；沒有 staging、PayUni、Production、外部付款或 deployment 操作。

## 分數與限制

- canonical readiness total 仍為 73.5；CAT04=6.0、CAT10=4.5；`current_goal_score_change=0`。
- PayUni 官方公開資料可確認 token／續期能力，但目前沒有可驗證的 UPP setup 參數與商店啟用契約，因此本輪沒有猜測欄位或呼叫 PayUni。PayUni adapter setup 仍是下一個受規格約束的功能工作。
- CAT04 仍需要授權 staging reconciliation 與 PayUni Sandbox receipt；CAT10 仍需要真人 merchant、support、legal/privacy、finance、release owner 與外部 monitoring evidence。
- Global coverage 本輪未重跑；coverage 不阻擋本輪功能測試，也沒有降低 threshold、inventory、exclude、skip 或 assertion。

## 安全界線

沒有讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶資料或付款資料；沒有正式付款、退款、寄信、資料庫操作、deployment、push、merge，也沒有重試 FIN-08AA、WP-196、WP-197。
