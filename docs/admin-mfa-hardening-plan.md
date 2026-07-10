# Admin MFA Hardening Plan

最後更新：2026-07-09

## 目的

月結、出款、webhook retry、PayUni 對帳與 Cloudflare ops 都屬於高風險後台操作。正式收費前，平台管理員至少需要 MFA 計畫；100 個付費商家後建議升級為強制 MFA。

## MVP 最小策略

- Phase A：文件化與操作政策。
- Phase B：平台管理員登入後，進入 `/admin/**` 前要求 TOTP。
- Phase C：出款、lock settlement、manual retry webhook 等高風險操作要求 step-up verification。

## 建議資料模型

後續可新增：

- `UserMfaFactor`
  - `userId`
  - `factorType`: `totp`
  - `secretEncrypted`
  - `enabledAt`
  - `lastUsedAt`
- `UserRecoveryCode`
  - `userId`
  - `codeHash`
  - `usedAt`
- `AdminSecurityEvent`
  - 可沿用 `audit_logs`

## 驗收標準

- 平台管理員啟用 TOTP 後才能進入 `/admin/**`。
- TOTP secret 不可明文儲存在 DB。
- recovery codes 只顯示一次，DB 僅存 hash。
- MFA disable 需要 owner / platform admin 二次確認。
- 所有啟用、停用、失敗驗證寫入 `audit_logs`。

## External Required

- 選定 TOTP library 與 QR code 呈現方式。
- 決定是否支援 WebAuthn / passkey。
- 內部營運政策：遺失 MFA 的人工驗證流程。
