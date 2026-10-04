# Admin MFA Hardening Plan

最後更新：2026-10-03

## 已確認的產品政策

Owner 已明確決定：MFA 由所有使用者自行選擇啟用，包含商家財務角色與平台管理員。不因未設定 MFA 阻擋登入、方案頁或具備角色權限的操作，也不預設在商家數量達標後改為強制。

已完成啟用的帳號仍須通過 MFA 驗證；開始設定但尚未確認的 factor 不算啟用。停用既有 MFA 的身分確認、復原碼保護、登入限流、租戶隔離及角色授權仍保留。

## 目的

提供可自願啟用的帳號保護。月結、出款、webhook retry、PayUni 對帳與 Cloudflare ops 仍依原有角色與操作授權限制，不以強制註冊 MFA 作為前置條件。

## MVP 最小策略

- Phase A：文件化與操作政策。
- Phase B：使用者可在安全設定啟用 TOTP；未啟用者可正常使用其角色允許的功能。
- Phase C：已啟用帳號登入及受保護操作維持 TOTP 驗證，不能透過未驗證 session 繞過。

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

- 未啟用 TOTP 的平台管理員可依既有權限進入 `/admin/**`；商家角色仍不可取得平台管理權限。
- 已啟用 TOTP 的帳號未驗證時會進入驗證流程；未完成 enrollment 的帳號不被強制設定鎖住。
- TOTP secret 不可明文儲存在 DB。
- recovery codes 只顯示一次，DB 僅存 hash。
- MFA disable 需要 owner / platform admin 二次確認。
- 所有啟用、停用、失敗驗證寫入 `audit_logs`。

## External Required

- 選定 TOTP library 與 QR code 呈現方式。
- 決定是否支援 WebAuthn / passkey。
- 內部營運政策：遺失 MFA 的人工驗證流程。
