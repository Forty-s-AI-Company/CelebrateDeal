# PR #468 獨立審查：一般用戶密碼 8 碼與常見密碼擋除

- 分支：`codex/beta-password-policy-8`，commit `e4b7e9c0`，比對 `origin/master`
- 審查日期：2026-10-23
- 審查者：reviewer（Opus），唯讀審查，未修改程式

## 結論

**需修正。** 有一項 MAJOR：平台管理員透過設定頁或密碼重設，可以把密碼改成 8 碼，這跟 owner「管理員維持 12 碼」的決定不一致。另外建議一併處理兩項 MINOR：明顯弱密碼漏擋，以及重設 API 檢查的是去空白後的值、存進去的卻是原值。四個入口確實都在伺服器端驗證，登入、雜湊、限流、session、MFA 都沒有被動到，`findPasswordResetTokenEmail` 也不會讓人探測帳號是否存在。

## 我實際跑過的驗證

| 項目 | 結果 |
|---|---|
| `vitest run` password-policy、actions、registration-actions、reset confirm route、auth-entry-feedback、invitations accept page（6 個檔案） | 490 項通過 |
| `npm run typecheck` | 通過 |
| `eslint` 針對 11 個變更的原始碼檔案 | 0 個問題 |
| `password-reset.test.ts`、`vendor-member-invitation.db.test.ts`（需要 DB） | **沒跑成**：`localhost:54329` 沒有 DB。這兩個檔案的新測試我沒有驗證，不能算通過 |
| 用 tsx 對 `validateNewPassword` 跑約 60 組邊界輸入，並做效能量測 | 結果寫在下方各項 finding 裡 |

## 依審查順序逐項檢查

1. 金流：本 PR 不碰金額、付款、退款或佣金。**沒有 finding。**
2. 租戶邊界：不涉及 vendor 資源 ID。邀請流程的 email 來自已儲存的 invitation，不是表單。**沒有 finding。**
3. Auth／權限：有一項 MAJOR（M-1），內容如下。
4. 資料：沒有 migration 或 schema 變更。**沒有 finding。**
5. 正確性與測試：有 MINOR 與 NIT，內容如下。

## 審查重點的檢查結果

**1. 四個入口是否都在伺服器端驗證。** 是。

- 新密碼的雜湊只在四個地方產生：
  - `auth-security-actions.ts:180`
  - `registration-actions.ts:47`
  - `vendor-member-invitation-actions.ts:62`
  - `password-reset.ts:153`
- 這四條路徑在雜湊前都會呼叫 `validateNewPassword`：
  - `auth-security-actions.ts:172`（設定頁）
  - `auth-security-actions.ts:229`（重設的 Server Action）
  - `api/auth/password-reset/confirm/route.ts:26`（重設 API）
  - `registration-actions.ts:36`（註冊）
  - `vendor-member-invitation-actions.ts:56`（邀請接受）
- `git grep "12" -- src | grep -i pass` 在 src 裡已經找不到寫死的 12 碼密碼規則。
- `scripts/bootstrap-platform-admin.ts:29` 仍然是 12 碼。
- 財務 QA bootstrap 在 `src/lib/staging-qa-finance-bootstrap.ts:102` 的規則其實是 **24～256**，不是 12（見 N-3）。本 PR 沒有改到這個檔案。

**2. 登入有沒有被誤套新規則。** 沒有。

- `loginAction`（`auth-security-actions.ts:64-148`）與 `authenticateUser`（`src/lib/auth.ts:394`）都沒有引用 password-policy。
- 既有的 12 碼以上密碼照常可以登入。
- e2e 測試用的密碼只用在登入；註冊 e2e 的 `SyntheticBrowserPassword123!` 我驗算過，會通過新規則。

**3. 重設流程的探測與洩漏。** 沒有 finding。

- `findPasswordResetTokenEmail` 的判斷條件（usedAt、expiresAt、user.status）跟 `consumePasswordResetToken` 一致，而且只讀不寫。
- 不論 token 是否有效，都只做一次 `findUnique`。政策不通過時，不論 token 有效與否都不做雜湊，所以回應時間不會透露 token 是否有效。
- 「含 email 本地部分」這條規則只有在 token 有效時才會生效。要利用它，攻擊者必須已經握有有效 token，又猜中本地部分；但握有有效 token 的人本來就能直接重設密碼，所以沒有多出新的探測途徑。
- `reason` 只會是 `short`、`long`、`common` 三種固定值。
- redirect 的 query 只帶 token（原有行為）和固定的錯誤碼，不帶密碼。
- 本 PR 沒有新增任何 log、Sentry 或 audit 記錄密碼。

**4. 比對的正確性。** 有漏擋與誤殺，見 m-1、m-3、N-1、N-2。

- 沒有 ReDoS 疑慮：`^([\s\S]{1,4})\1+$` 的長度上限是 128。實測 128 字元輸入跑 1 萬次約 25ms。
- 非字串輸入會丟出 TypeError，但四個入口都先經過 `text()` 或 zod 確保是字串，實際上碰不到。

**5. 雜湊、限流、session、MFA 有沒有被動到。** 沒有。

- diff 沒有碰 `password.ts`、`rate-limit`、`account-rate-limit`、`mfa`、`auth.ts`。
- 設定頁與重設流程仍然會撤銷所有 session。

**6. 測試覆蓋。** 有覆蓋到重點邊界，也沒有放寬既有斷言或 skip。

- 已覆蓋：7／8 碼、128／129 碼（unit 與 API）、清單命中、規則命中、email 本地部分。
- 原本的 API 測試「a short password」移到新的 it.each 裡，並且多斷言了 `reason`，沒有被放寬。
- 缺口見 N-5。

## Findings

### BLOCKER

沒有。

### MAJOR

**M-1 平台管理員透過自助流程可以把密碼降到 8 碼**

- 位置：
  - `src/app/actions/auth-security-actions.ts:172`
  - `src/app/actions/auth-security-actions.ts:229`
  - `src/app/api/auth/password-reset/confirm/route.ts:26`
  - `src/lib/password-reset.ts:141-149`
- 失敗情境：
  - 平台管理員用 12 碼以上的密碼 bootstrap 完成後，可以到 `/settings/security` 把密碼改成 `bluewhal` 這類 8 碼密碼，新規則會放行。
  - 透過忘記密碼流程也一樣，`consumePasswordResetToken` 沒有排除管理員。
  - 舊規則下，設定頁與重設對所有人都要求 12 碼。本 PR 等於把 owner 說要維持 12 碼的管理員帳號，也一起降到 8 碼。這些帳號掌管退款、出款與財務後台。有強制 MFA 可以減輕風險，但跟 owner 的決定不一致。
- 修法：
  - 讓 `validateNewPassword` 接受 `minLength` 參數，或另外提供管理員用的 helper。
  - 設定頁在 `auth.user.platformRole === "platform_admin"` 時要求 12 碼。
  - 重設流程讓 `findPasswordResetTokenEmail` 同時回傳 `platformRole`（只在 token 有效時回傳），管理員一樣要求 12 碼。
  - 錯誤文案要能顯示 12 碼。
  - 補上「管理員 11 碼被拒、12 碼通過」的測試。
- 如果 owner 確認「管理員」只是指 bootstrap 腳本，這項可以降為 MINOR，但請把這個決定寫進 `docs/domain-workflows.md`。

### MINOR

**m-1 明顯的弱密碼只要多加一個字元就能通過**

- 位置：`src/lib/password-policy.ts:39-52`
- 實測會通過（`ok: true`）的例子：
  - `12345678!`
  - `123456789!`
  - `1234567890a`
  - `11111111a`
  - `aaaaaaa1`
  - `88888888a`
  - `qwertyuiop1`
  - `zxcvbnm,`
  - `qwerty2026`
  - `dragon2026`
  - `monkey2026!`
  - `letmein2026`
  - `admin2026!`
  - `hello2026`
  - `abc123456789`
  - `2026password`
- 原因：
  - 「重複單位」與「整串連續」兩條規則只看整個字串。
  - 「清單字加後綴」這條規則只認清單裡的條目，但清單條目都是 8 碼以上，所以 `qwerty`、`dragon`、`monkey`、`admin`、`hello` 這類短的常見字加上年份，完全擋不到。
- 修法：
  1. 先去掉結尾 1～4 個數字或符號，剩下的部分再跑一次重複、連續、清單三條規則。要求剩下的長度至少 6，避免誤殺正常密碼。
  2. 另外建一份 4～7 字元的常見基底字清單（`qwerty`、`dragon`、`monkey`、`admin`、`hello`、`letmein`、`iloveu`、`abc123`、`taiwan`、`woaini` 等），只給「加後綴」規則使用。
  3. 也可以考慮擋「年份或數字在前、清單字在後」的組合。
- 不會誤殺的正常密碼我也驗過，都通過：`Tiger7rain`、`coffee42cup`、`blue-house-9`、`mango2street`、`k8Xp2mQz`、`sunny day 7`。

**m-2 重設 API 檢查的是去空白後的值，存進去的卻是原值；登入又會去空白**

- 位置：`src/app/api/auth/password-reset/confirm/route.ts:10`、`:26`、`:31`
- 失敗情境：
  - 呼叫端送 `"bluewhal "`（結尾有空白）。
  - 政策檢查用去空白後的 `bluewhal`，通過。
  - `consumePasswordResetToken` 雜湊的是含空白的原值。
  - `loginAction` 的 `text()` 會先去空白，所以 `bluewhal` 永遠驗不過，使用者被鎖在外面。
- 這個問題原本就存在（舊規則是原值 `min(12)`，一樣存原值）。但本 PR 把這一行改成「先去空白再檢查」，讓檢查與儲存的不一致變得明確。三個 Server Action 入口都用 `text()` 去空白，所以沒有這個問題。
- 修法：
  - schema 改成 `z.string().max(PASSWORD_MAX_LENGTH).transform((v) => v.trim())`，之後檢查與 consume 都用去空白後的值，跟 registration 和 login 一致。
  - 補一個「前後空白」的測試。

**m-3 email 規則的誤殺被歸成 `common`，文案會誤導**

- 位置：`src/lib/password-policy.ts:54-57`、`:66-70`，以及 `PASSWORD_POLICY_MESSAGES.common`
- 失敗情境：
  - `sales@`、`info@`、`service@`、`shop@`、`love@`、`admin@` 這類本地部分在台灣小商家很常見。用這些信箱註冊的人，密碼只要包含該字就會被拒，例如：
    - `sales department 9`（sales@）
    - `infoline2026`（info@）
    - `mylovedogs`（love@）
  - 畫面只顯示「這個密碼太常見」，使用者不知道真正原因，可能反覆嘗試或放棄註冊。
- 修法：
  - 新增 `personal` reason，文案改成「密碼不能包含你的 Email 名稱」。四個入口都只有帳號本人（或握有 token 的人）看得到這個訊息，不構成洩漏。
  - 可以考慮讓常見的角色型本地部分（info、sales、service、admin、shop、support、contact）不套用這條規則。

### NIT

**N-1 長度用 UTF-16 code unit 計算，也沒有做 NFKC 正規化**

- 位置：`src/lib/password-policy.ts:61-63`
- 4 個 emoji（例如 `😀🎉🐱🌸`）在 `.length` 下算 8，會通過「至少 8 個字元」。
- 全形字 `ｐａｓｓｗｏｒｄ` 沒有被擋。
- `İ` 轉小寫後會變成 `i̇`，含 email 本地部分的規則因此比對不到。
- 修法：`normalize("NFKC")` 後用 `[...s].length` 計算長度。

**N-2 email 本地部分只比對原始字串**

- 位置：`src/lib/password-policy.ts:54-57`
- `mei.lin@` 的使用者可以用 `meilin2026`。`mei+shop@` 這種有 +tag 的地址也沒有拆開處理。
- 修法：另外用「移除 `.`、`_`、`-`」以及「去掉 `+` 之後的部分」各比對一次。

**N-3 註解與 PR 描述對財務 QA bootstrap 的說法不準確**

- 位置：`src/lib/password-policy.ts:8`
- 註解寫財務 QA bootstrap 是 12 碼，實際是 24～256（`staging-qa-finance-bootstrap.ts:102`）。
- 修法：改成「平台管理員 bootstrap 12 碼、財務 QA bootstrap 24 碼」。

**N-4 重設 API 永遠不會回 `reason: "long"`**

- 位置：`src/app/api/auth/password-reset/confirm/route.ts:10`
- 129 碼以上在 zod 階段就被擋掉，回的是不帶 `reason` 的 400，所以政策裡的 `long` 在 API 永遠到不了，錯誤形狀不一致。
- 修法：zod 只設一個防 DoS 的上限（例如 1024），讓政策負責回 `long`。或者在文件中註明這個行為。

**N-5 測試缺口**

- 邀請接受與設定頁沒有 action 層級的 129 碼（`long`）測試。
- 沒有平台管理員的密碼長度測試（配合 M-1）。
- 新的邀請 DB 測試在同一個 action 裡連送 3 次，會吃掉 `vendor-member-invitation-accept` 的 10 次限流額度。我沒有 DB，無法確認跟同檔案其他測試一起跑會不會碰到 429。PR 描述說已通過。

## 最終判定

需修正。M-1（管理員可以透過設定頁或重設降到 8 碼，跟 owner 決定不一致）合併前要修，或者請 owner 書面確認只有 bootstrap 維持 12 碼。m-1、m-2 改動小、風險低，建議同一個 PR 一起修。其餘項目都已確認安全：四個入口都在伺服器端驗證，登入、雜湊、限流、session、MFA 沒被動到，重設流程不會讓人探測帳號或 token，密碼也不會進 URL 或 log。
