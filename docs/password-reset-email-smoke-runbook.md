# Password Reset Email Smoke Runbook

最後更新：2026-07-09

## 目的

驗證 Resend transactional email、password reset token、過期、重複使用防護，以及成功重設後 session revoke。

## 1. 前置條件

- [ ] `RESEND_API_KEY` 已設定。External required
- [ ] `EMAIL_FROM` 使用已驗證 domain。External required
- [ ] `NEXT_PUBLIC_APP_URL` 指向 staging / production 正式 domain。
- [ ] 測試帳號可登入。

## 2. Admin UI Smoke

路徑：

```txt
/settings/security
/mfa/setup
```

操作：

1. 使用測試 admin / owner 帳號登入。
2. 點擊「寄送 password reset 測試信」。
3. 到信箱確認收到 CelebrateDeal 密碼重設信。External required
4. 開啟 reset link。
5. 輸入新密碼，需至少 12 字元。
6. 完成後應導向 `/login?reset=1`。
7. 用舊 session 開啟 `/dashboard`，應被導回 login。
8. 使用新密碼登入，應成功。

## 3. API Smoke

```bash
curl -X POST https://<app-domain>/api/auth/password-reset/request \
  -H "Content-Type: application/json" \
  -H "X-CelebrateDeal-Client: web" \
  -d '{"email":"admin@example.com"}'
```

預期：

- 回 `200`。
- production 不回傳 reset URL。
- 非 production 可回傳 preview reset URL，方便本機驗收。

## 4. Token 過期驗收

1. 建立 reset token。
2. 將 DB 中該 token 的 `expiresAt` 調整到過去時間。
3. 開啟 reset URL 並送出新密碼。
4. 預期回到 confirm page 並顯示 token 過期。

驗收標準：

- `PasswordResetToken.usedAt` 不應被更新。
- `User.passwordHash` 不應改變。
- 不應 revoke sessions。

## 5. 重複使用驗收

1. 使用 reset URL 成功重設一次。
2. 再次使用相同 reset URL。
3. 預期第二次失敗。

驗收標準：

- 第二次不應更新密碼。
- 第二次不應建立新 session。
- `audit_logs` 可看到第一次 `password_reset_completed`。

## 6. Session Revoke 驗收

1. 在 A 瀏覽器登入測試帳號。
2. 在 B 瀏覽器申請並完成 password reset。
3. 回到 A 瀏覽器開啟 `/dashboard`。
4. 預期被導向 `/login`。

## 7. Audit Logs

應可看到：

- `password_reset_requested`
- `password_reset_requested_unknown_email`
- `password_reset_completed`
- `password_reset_smoke_email_sent`
- `password_reset_smoke_email_failed`

## 8. 安全規則

- reset token 只存 hash。
- reset token 30 分鐘過期。
- reset email 不在 production response 顯示完整 reset URL。
- 成功重設密碼後 revoke 該 user 所有 active sessions。
- 測試信只寄給目前登入帳號，不提供任意收件者欄位。
