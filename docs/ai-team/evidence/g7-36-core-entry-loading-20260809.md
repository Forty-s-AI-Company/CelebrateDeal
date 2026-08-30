# G7-36 核心存取與商家操作 Loading 證據

- Work Package：`G7-36`
- 驗證時間：`2026-08-09T10:19:30.3036263Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Source aggregate SHA-256：`b265fc1a85fbc4085c6590eaf11a3d3fceae9c54de361552c6abfa8eb3fb1376`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`

## 產品問題與修正

下列核心入口原本使用 raw submit button，送出後缺少可見 loading、disabled、`aria-busy` 與 live status。慢網路或 server action 執行期間，使用者無法判斷操作是否生效：

- 後台登入
- 密碼重設申請
- 密碼重設確認
- Email 報名確認
- 商家成員停用
- 黑名單解除

本次沿用共用 `FormSubmitButton` 管理 Server Action pending，並加入可見 CSS spinner。每個入口都有動作專屬的 pending label 與 screen-reader message。Email 報名確認保留原生 POST 與 no-JS progressive enhancement，使用同步 ref 阻擋 React commit 前的第二次 submit。

獨立 reviewer 發現同一表單有多顆 submitter 時，原實作會讓所有按鈕同時顯示各自的 loading 文案。修正後會用 `useFormStatus().data` 的 submitter `name`／`value` 或明確 `formAction` 判斷真正觸發的按鈕；同表單其他按鈕維持暫時 disabled，但不顯示錯誤 spinner、`aria-busy` 或 live status。互動角色工作台的儲存與刪除也都明確綁定各自 action，列級操作另補兩個獨立 form 的 pending scope 測試。

密碼重設確認另補：

- `role="alert"` 錯誤語意。
- 兩個新密碼欄位的 `autoComplete="new-password"`。
- 與 server 驗證一致的 `minLength={12}`。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Targeted component／page tests | PASS | 7 files，26 tests passed，0 failed，0 skipped |
| Native POST duplicate guard | PASS | 第一次 submit 保留；第二次同步 `preventDefault`；pending 顯示 spinner、disabled、aria-busy、live status |
| Targeted ESLint | PASS | exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit`，exit code 0 |
| Raw-submit inventory | PASS | 六個目標檔案 raw `<button>` 均為 0，皆接入 `FormSubmitButton` 或 `NativePostForm` |
| React checklist | PASS | hooks 無條件、無 effect、無 fetch／waterfall、無新 dependency；Server Components 只傳必要 action／字串，原生 POST 保留 progressive enhancement |
| Independent reviewer | RESOLVED | 替代 reviewer 首輪找到 action-specific pending P1 與 row-scope test P2，第二輪找到 mixed formAction P1；全部修正後最終複查未發現剩餘 P0／P1／P2 |

第一個 reviewer 路徑逾時，沒有產生 verdict，已如實保留為 timeout 並關閉；後續由新的唯讀 reviewer 完成三輪檢查。timeout 沒有被當成 PASS。

## 執行命令

```text
node node_modules/vitest/vitest.mjs run src/components/form-submit-button.test.tsx src/components/native-post-form.test.tsx src/app/auth-entry-feedback.test.tsx src/app/verify-registration/page.test.tsx src/components/vendor-member-deactivation-confirmation.test.tsx src/components/blacklist-search-list.test.tsx src/components/interaction-roles-workbench.test.tsx
npx eslint src/components/form-submit-button.tsx src/components/form-submit-button.test.tsx src/components/native-post-form.tsx src/components/native-post-form.test.tsx src/app/auth-entry-feedback.test.tsx src/app/login/page.tsx src/app/password-reset/request/page.tsx src/app/password-reset/confirm/page.tsx src/app/verify-registration/page.tsx src/app/verify-registration/page.test.tsx src/components/vendor-member-deactivation-confirmation.tsx src/components/vendor-member-deactivation-confirmation.test.tsx src/components/blacklist-search-list.tsx src/components/blacklist-search-list.test.tsx src/components/interaction-roles-workbench.tsx src/components/interaction-roles-workbench.test.tsx
npm run typecheck
```

三段命令皆為 exit code `0`。Source aggregate 由下列 manifest 依原順序、UTF-8、LF 結尾後計算 SHA-256。

本 WP 未啟動 Browser、DB、staging、Sandbox、付款、退款、Email 寄送或 Production 操作；未執行項目不列為 PASS。

## Source SHA-256

```text
baa09e70a3e72c935c405bc451bf7462e1ed1dd4827c7d7af3fa73fd4b5bf3cd  src/components/form-submit-button.tsx
c4e9e70304a1857f2f2d1067b4de4523653d79a788c0dee5ad72b91af5c2c9c8  src/components/form-submit-button.test.tsx
de70e62997fee896e9f637904f92d1335833bb8849c8d42ebeb0c10a33073792  src/components/native-post-form.tsx
3aacb1aa552aa33bf8df04d7edfaf5167983e00a17eb8fd43bc8eb7732714cf4  src/components/native-post-form.test.tsx
5ab1fae2e98096d40b3ceaa930d45a8297d8922ef5dd200ab70a1cae8dee1b95  src/app/auth-entry-feedback.test.tsx
d68e4610d7833571c7d3013e5a0c730bf509d58b9ed48febe47be27c0e2b2dae  src/app/login/page.tsx
0c762c1cce2fa7aeab8e1b67df3b2e95cac3576a3ac6c091a0f5b136afd078a3  src/app/password-reset/request/page.tsx
2d453df139484585da8ec4b81a368c788b137e1c072e910ba897d005f587eabe  src/app/password-reset/confirm/page.tsx
c523b169824cf506a314773c040485e51b415bc4145069ae89fa3c13d0ed2d7b  src/app/verify-registration/page.tsx
d576a6d459a28f9166bba25c14613b24c32162fbf4acfb020de9138d4ae756b8  src/app/verify-registration/page.test.tsx
ef0bc87a57a10b2a42b28f880e4fb2ac42999b81c8531c2739c42ac51072fd75  src/components/vendor-member-deactivation-confirmation.tsx
c9dfcf165808669ad45a7baea51b06c8cb261e7873919d613e42b1a92bd8bd2a  src/components/vendor-member-deactivation-confirmation.test.tsx
a68196217fe05398405aaa7bdad13405227482d833d6ac6d1f231ddc3beaad0b  src/components/blacklist-search-list.tsx
0796cc5997be46e7f1054d4a5963c6e61462d44d6e27268ba3cc7eab62f1aaf6  src/components/blacklist-search-list.test.tsx
463fe9573d7eb78e9364b1aaef5f877cd87c9145052edef4683584f1cdc6c8a3  src/components/interaction-roles-workbench.tsx
0c9b1e2a56fe9637c381536252ce486b1b1cabe10704938e8a44f930c1af2adb  src/components/interaction-roles-workbench.test.tsx
```

## Ownership、安全與回滾

- 修改範圍只有共用 submit UI、六個目標入口與對應 tests；auth、CSRF、rate limit、session、資料庫 mutation 與 API verification route 未更動。
- vendorId 與授權仍由既有 server actions 推導，client 沒有新增 ownership input。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有降低 assertion／coverage threshold、增加 skip／exclude 或縮減 inventory。
- 回滾只需移除 G7-36 UI wiring、`NativePostForm` 與 tests；不涉及 schema、migration 或外部狀態。

## 分數資格

- `merchant_onboarding_settings` 候選可由 `8.0 → 8.2`，UX `1.5 → 1.7`。
- `registration_form_builder` 候選可由 `8.1 → 8.2`，UX `1.6 → 1.7`。
- `interaction_roles` 候選可由 `8.0 → 8.1`，UX `1.5 → 1.6`。
- canonical 維持 `74.0`；本機 loading 證據不代替 CAT04 Sandbox 或 CAT10 真人／外部證據。

## 尚未完成

- CAT04／CAT10 blocker 未改變，且不阻擋下一個本機產品工作。
