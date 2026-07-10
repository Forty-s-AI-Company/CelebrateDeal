# Admin MFA Recovery SOP

最後更新：2026-07-09

## 目的

提供平台管理員、商家 owner、財務角色在遺失驗證器裝置時的復原流程，避免為了救帳號而直接關閉 MFA。

## 1. 正常登入流程

1. 使用 email / password 登入。
2. 若帳號需要進入 `/admin/**` 且尚未啟用 MFA，系統導向 `/mfa/setup`。
3. 若已啟用 MFA 但目前 session 尚未驗證，系統導向 `/mfa/verify`。
4. 可使用 TOTP 或尚未用過的 recovery code。

## 2. Recovery Code 使用

使用者在 `/mfa/verify` 輸入 recovery code 後：

- 該 recovery code 會被標記 `usedAt`。
- 目前 session 會寫入 `mfaVerifiedAt`。
- audit log 會記錄 `mfa_verify_recovery_code`。

## 3. 重新產生 Recovery Codes

路徑：

```txt
/settings/security
/mfa/setup
```

操作：

1. 使用 TOTP 或既有 recovery code 登入。
2. 開啟安全中心或 MFA setup page。
3. 點擊「重新產生 recovery codes」。
4. 系統會刪除舊 recovery codes，建立一批新的 codes。
5. 新 codes 只顯示一次，必須立即保存。

Audit log：

- `mfa_recovery_codes_regenerated`

## 4. 遺失手機但仍有 Recovery Code

1. 進入 `/mfa/verify`。
2. 使用 recovery code 完成登入。
3. 到 `/settings/security` 或 `/mfa/setup` 重新產生 recovery codes。
4. 重新綁定新的驗證器 App 時，目前 MVP 建議先由平台管理者人工重置 MFA factor。

## 5. 遺失手機且沒有 Recovery Code

目前 MVP 不提供 self-service reset MFA，避免帳號接管風險。

人工復原 SOP：

1. 由平台 owner 在外部客服 / 合約管道確認申請者身份。External required
2. 匯出最近登入與 audit log。
3. 在 DB 中人工停用或刪除該 user 的 `UserMfaFactor` 與 `UserRecoveryCode`。
4. revoke 該 user 所有 active sessions。
5. 要求使用者重新登入並完成 `/mfa/setup`。
6. 在 `audit_logs` 手動補記或透過後續 admin tool 記錄 `mfa_admin_reset`。

正式版建議：

- 新增 platform super admin 專用 MFA reset tool。
- MFA reset 必須要求雙人覆核。
- MFA reset 必須寫入 audit log、IP、user agent、reason。

## 6. Go-live 驗收

- [ ] 未啟用 MFA 的 finance admin 進 `/admin/**` 會導向 `/mfa/setup`
- [ ] 已啟用但未驗證的 finance admin 進 `/admin/**` 會導向 `/mfa/verify`
- [ ] TOTP 驗證成功後可進入 admin
- [ ] recovery code 驗證成功後可進入 admin，且該 code 只能使用一次
- [ ] 重新產生 recovery codes 後舊 codes 失效
- [ ] 相關操作皆寫入 `audit_logs`
