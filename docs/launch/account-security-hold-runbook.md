# 帳號安全暫停與客服移除 MFA（登入 Email 還原）客服處理

## 什麼時候會發生

使用者提出登入 Email 變更後，舊信箱會收到「不是我操作，還原 Email」連結：

- 變更還沒完成時，這個連結會**取消**變更（登入 Email 本來就還是舊信箱）；
- 變更完成後 7 天內，這個連結會把登入 Email **還原**為舊信箱。

不論取消或還原，如果帳號的兩步驟驗證（MFA）是在「提出變更的那次登入或申請時間（取較早者），往前推 24 小時」之後才啟用或重新設定的，系統無法判斷這個 MFA 是本人還是接手者設定的：

- 刪掉它，可能把帳號交給持有舊信箱的人；
- 保留它，可能讓接手者繼續登入；取消時更會讓本人被接手者的驗證器擋在外面。

所以系統選擇暫停帳號，由客服確認（寧可鎖住，也不讓帳號被接手）。

暫停時已經完成的事：

- 還原：登入 Email 改回舊信箱，被還原掉的新信箱會收到一封沒有連結的通知；7 天內不能再自行變更登入 Email。
- 取消：登入 Email 維持舊信箱，未完成的變更作廢；不設 7 天鎖定、不寄通知。
- 兩者都會：結束所有 session、密碼停用（`unusable:account_email_revert`）、作廢未使用的密碼重設連結、LINE 登入解除綁定並作廢進行中的 LINE 登入流程、刪除全部備用碼。MFA factor 保留。

暫停期間（`User.status = "security_hold"`）不能登入、不能重設密碼、不能用 LINE 登入。按連結的人只會看到中性的「為保護帳號，這個帳號需要客服確認身分後才能繼續使用，請聯絡客服」，不會知道原因。

稽核紀錄：

- `account_security_hold_placed`：MFA 類型、啟用時間、cutoff 與來源（不含密鑰）；
- 還原另有 `account_email_change_reverted`，取消另有 `account_email_change_cancelled_by_owner`，兩者的 `securityHold` 都是 `true`。

## 工具一覽

兩個工具都在「平台營運 → 帳號安全暫停」（`/admin/account-holds`）。只有平台管理員能用，且需完成 15 分鐘內的 MFA 驗證；頁面只顯示遮罩後的 Email。

| 情況 | 用什麼 |
|---|---|
| 帳號被暫停，本人持有目前的登入 Email，MFA 確定是本人設定的 | 恢復，不勾選移除 MFA |
| 帳號被暫停，本人持有目前的登入 Email，但 MFA 可能是接手者設定的，或本人無法使用那個驗證器 | 恢復，並勾選「同時移除兩步驟驗證」 |
| 帳號沒有被暫停（使用中），本人無法通過 MFA（手機遺失、驗證器不是本人設定的等），而且不是平台管理員 | 「移除兩步驟驗證」工具 |
| 平台管理員（`platformRole` 不是 `none`）無法通過 MFA | 不能用頁面工具。走下方「平台管理員的 MFA」程序 |
| 帳號被暫停，但本人其實是被還原掉的新信箱持有人（舊信箱已外洩） | 不要恢復。走下方「人工更正登入 Email」授權程序，完成後才恢復 |

## 處理步驟：恢復暫停的帳號

1. 平台管理員登入，完成 MFA 驗證，打開 `/admin/account-holds`。
2. 依一般身分確認流程聯絡帳號擁有者，確認誰才是本人：
   - 舊信箱持有人：按連結的人（還原或取消）；
   - 新信箱持有人：只有還原時才有，收到「你的登入 Email 已被還原」通知的人。
   不要在電話或訊息中透露完整 Email、密碼或任何連結。
3. 判斷：
   - **本人持有舊信箱，而且 MFA 是本人設定的**：不勾選，直接按「確認身分後恢復帳號」。
   - **本人持有舊信箱，但 MFA 可能是接手者設定的**：勾選「同時移除兩步驟驗證」再恢復，本人之後重新設定 MFA。無法確認時一律勾選。
   - **本人其實是新信箱持有人**：不要恢復，改走「人工更正登入 Email」。
4. 恢復後，請本人到登入頁用「忘記密碼」重設密碼（重設信寄到目前的登入 Email），再登入並重新產生備用碼。
5. 恢復會寫 `account_security_hold_released` 稽核（記錄操作的管理員、移除的 factor 與備用碼數），並再次結束該帳號所有 session。

## 處理步驟：移除使用中帳號的 MFA

只給**沒有被暫停**、**不是平台管理員**的帳號；暫停中的帳號請用上面的恢復功能。電話或訊息可能是社交工程，所以這個工具不會交出可以直接登入的帳號：MFA、備用碼與密碼一起停用，只有能收登入信箱的人能用「忘記密碼」重新進來，登入信箱也會收到通知。

1. 依一般身分確認流程確認本人，並確認對方確實無法使用目前的驗證器與備用碼。
2. 在「移除兩步驟驗證」區塊輸入對方的登入 Email 查詢。Email 只放在送出的表單中，網址只帶帳號 ID。每次查詢都會寫 `account_mfa_removal_lookup` 稽核（操作的管理員、找到的帳號 ID 或 `not_found`，不含 Email）。
3. 核對遮罩後的 Email、狀態與 MFA／備用碼數量。頁面標示「平台管理員」的帳號不會出現移除表單。
4. 填寫原因（10–500 字，會寫入稽核紀錄；寫工單編號與確認方式，不要寫完整 Email、密碼或驗證碼），再把頁面上的遮罩 Email（例如 `o***@example.com`）照抄到確認欄。
5. 按「確認身分後移除兩步驟驗證」。系統會在同一個交易中鎖定該帳號、重新確認狀態、平台角色與 Email，刪除 MFA 與所有備用碼、把密碼改為不可用（`unusable:support_mfa_removal`）、結束所有 session，並寫 `account_mfa_removed_by_support` 稽核（含原因與刪除數量）。登入 Email 不變。交易完成後寄一封沒有連結的通知到登入 Email：「你的兩步驟驗證已由客服移除，密碼也已停用，請使用『忘記密碼』重新設定；若不是你申請的，請立即聯絡客服」。寄送失敗會寫 `account_mfa_removed_notice_failed` 稽核，移除本身不受影響；看到這筆稽核時請另行聯絡本人。
6. 請本人**一律**到登入頁用「忘記密碼」（重設信寄到登入 Email）設定新密碼，登入後重新設定 MFA 與備用碼。原本的密碼已經不能用。

限制：

- 不能用在自己的帳號，也不能用在任何有平台角色的帳號（伺服器端會拒絕，回 `platform_role`）。
- 帳號沒有 MFA 也沒有備用碼時不會有任何變更，也不會停用密碼。
- 確認欄與鎖定時的 Email 不一致（例如期間 Email 被改過）時拒絕，請重新查詢。

## 平台管理員的 MFA

平台管理員能動用所有商家的資料與金流設定，任何一位管理員都不能單獨移除另一位管理員（或自己）的 MFA，所以頁面工具一律拒絕。改走 `docs/admin-mfa-recovery-sop.md` 第 5 節的人工復原，並加上和下方「人工更正登入 Email」相同的授權條件：

1. **書面授權**：專案擁有者以書面核准這一筆重置（工單編號、帳號 ID、遮罩 Email）。
2. **身分確認**：專案擁有者本人（不是另一位管理員）以外部管道確認申請者身分。
3. **雙人執行**：一人執行、一人核對，兩人都不是被重置的帳號；在同一個交易中刪除該帳號的 `UserMfaFactor` 與 `UserRecoveryCode`、撤銷所有 `UserSession`，並寫 `mfa_admin_reset` 稽核（執行者、核對者、工單與核准編號）。
4. **密碼**：一併視為外洩。由專案擁有者以 `npm run admin:bootstrap`（`PLATFORM_ADMIN_RESET_PASSWORD=true`，見 `scripts/bootstrap-platform-admin.ts`）設定新的臨時密碼，再請該管理員登入後立刻更換並重新完成 `/mfa/setup`。
5. 唯一一位平台管理員遺失 MFA 時，沒有第二位管理員可以核對：由專案擁有者自己依第 1–4 步處理，並在工單記錄只有一人執行的原因。

AI 代理（Claude、Codex 等）不得執行這個程序的任何資料庫寫入或 bootstrap 指令。

## 人工更正登入 Email（本人是新信箱持有人）

只在以下情況使用：帳號被暫停，客服已確認真正的擁有者是被還原掉的新信箱持有人（舊信箱已外洩，是攻擊者按了還原）。這是對 production 資料庫的人工寫入，屬於 `AGENTS.md` 的「正式資料庫」不可逆操作。

**AI 代理（Claude、Codex 等）不得執行此 SQL，也不得連線到 production 資料庫。** 以下範本只供被授權的人員使用。

### 授權程序

1. **書面授權**：專案擁有者（CelebrateDeal 負責人）以書面（Email 或工單留言）明確核准這一筆更正，內容需包含工單編號、帳號 ID 與遮罩後的新舊 Email。沒有書面核准不得進行。把核准的連結或編號記為 `<APPROVAL_REF>`。
2. **身分確認**：依一般身分確認流程確認新信箱持有人就是本人，並在工單記錄確認方式。
3. **雙人核對**：一位平台管理員執行（operator），另一位平台管理員在旁核對（reviewer）。兩人不得是同一人，也不得是被更正的帳號。執行前 reviewer 逐一朗讀並核對每個參數。
4. **先演練**：先把同樣的參數套在 staging 或可拋棄的本機資料庫的合成資料上跑一次，確認每一步的筆數正確。
5. **正規化參數**：兩個 Email 參數必須是 app 的 `normalizeLoginEmail`（`src/lib/account-email-change-token.ts`：去除前後空白、轉小寫、合法 Email、最長 320 字）的輸出，範本不會替你轉換，未正規化的值會被拒絕。在 repo 根目錄可以這樣取得（只做字串處理，不連資料庫）：

   ```sh
   npx tsx -e 'import("./src/lib/account-email-change-token.ts").then((m) => console.log(JSON.stringify((m.normalizeLoginEmail ?? m.default.normalizeLoginEmail)(process.argv.at(-1)))))' '<要正規化的 Email>'
   ```

   輸出 `null` 代表不是合法的登入 Email，不得繼續。
6. **執行**：在 production 以 `psql` 執行下方範本。所有檢查、鎖定、更新與稽核都在同一個 `DO` 區塊內；任何檢查不通過或任何必須是 1 筆的更新筆數不符（`GET DIAGNOSTICS` 檢查），都會 `RAISE` 並讓整筆交易失敗。範本最後的 `COMMIT` 是註解：operator 在 reviewer 核對輸出後才手動輸入，否則輸入 `ROLLBACK`。
7. **稽核**：範本在同一交易中寫入 `account_login_email_corrected_by_support` 稽核（operator、reviewer、工單與核准編號與各步筆數，不含 Email）。工單另外記錄執行時間、兩人姓名與 `NOTICE` 輸出的筆數。
8. **收尾**：在 `/admin/account-holds` 恢復帳號，並勾選「同時移除兩步驟驗證」（MFA 可能是攻擊者設定的）。請本人用「忘記密碼」把重設信寄到更正後的 Email、設定新密碼，再重新設定 MFA 與備用碼。
9. 若該帳號是商家的創辦人且 `Vendor.email` 也跟著被還原，另開工單、另取得書面授權處理，不要併在這次 SQL 裡。

### SQL 範本（不得由 AI 代理執行）

參數：

- `<USER_ID>`：被暫停的帳號 ID（從 `/admin/account-holds` 取得）；
- `<CURRENT_LOGIN_EMAIL>`：帳號目前的登入 Email（已外洩的舊信箱）；
- `<OWNER_EMAIL>`：已確認本人的新信箱；
- `<TICKET_ID>`、`<APPROVAL_REF>`：工單與書面核准編號；
- `<OPERATOR_ADMIN_ID>`、`<REVIEWER_ADMIN_ID>`：兩位平台管理員的帳號 ID。

```sql
-- 人工更正登入 Email。需書面授權與雙人核對；不得由 AI 代理執行。
-- 兩個 Email 參數必須已用 normalizeLoginEmail 正規化（見授權程序第 5 步）。
\set ON_ERROR_STOP on
\set user_id '<USER_ID>'
\set current_email '<CURRENT_LOGIN_EMAIL>'
\set owner_email '<OWNER_EMAIL>'
\set ticket '<TICKET_ID>'
\set approval_ref '<APPROVAL_REF>'
\set operator_id '<OPERATOR_ADMIN_ID>'
\set reviewer_id '<REVIEWER_ADMIN_ID>'

BEGIN;

CREATE TEMP TABLE email_fix_params ON COMMIT DROP AS
SELECT
  :'user_id'::text AS user_id,
  :'current_email'::text AS current_email,
  :'owner_email'::text AS owner_email,
  :'ticket'::text AS ticket,
  :'approval_ref'::text AS approval_ref,
  :'operator_id'::text AS operator_id,
  :'reviewer_id'::text AS reviewer_id;

DO $$
DECLARE
  p email_fix_params%ROWTYPE;
  u RECORD;
  rc bigint;
  revert_links bigint;
  pending bigint;
  sessions bigint;
  reset_tokens bigint;
BEGIN
  SELECT * INTO STRICT p FROM email_fix_params;

  -- 參數與授權。
  IF p.operator_id = p.reviewer_id THEN RAISE EXCEPTION 'operator and reviewer must be different people'; END IF;
  IF p.user_id IN (p.operator_id, p.reviewer_id) THEN RAISE EXCEPTION 'operator or reviewer is the target account'; END IF;
  IF (SELECT count(*) FROM "User" WHERE id IN (p.operator_id, p.reviewer_id) AND "platformRole" = 'platform_admin' AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'operator and reviewer must both be active platform admins';
  END IF;
  IF btrim(p.ticket) = '' OR btrim(p.approval_ref) = '' OR p.ticket LIKE '<%' OR p.approval_ref LIKE '<%' THEN
    RAISE EXCEPTION 'ticket and written approval reference are required';
  END IF;
  IF p.current_email <> lower(btrim(p.current_email)) OR p.owner_email <> lower(btrim(p.owner_email)) THEN
    RAISE EXCEPTION 'email parameters must be normalized with normalizeLoginEmail first';
  END IF;
  IF char_length(p.owner_email) > 320 OR p.owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'owner email is not a valid address';
  END IF;
  IF p.owner_email = p.current_email THEN RAISE EXCEPTION 'owner email equals the current email'; END IF;

  -- 與 app 相同的鎖定順序：先鎖 User 列，再依排序取兩個 Email 的 advisory lock
  -- （lockLoginEmails：hashtextextended('celebratedeal:login-email:v1:' || email, 0)）。
  PERFORM 1 FROM "User" WHERE id = p.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('celebratedeal:login-email:v1:' || e, 0))
  FROM unnest(ARRAY[p.current_email, p.owner_email]) AS e ORDER BY e;

  -- 鎖定後重新檢查。
  SELECT id, email, status INTO STRICT u FROM "User" WHERE id = p.user_id;
  IF u.status <> 'security_hold' THEN RAISE EXCEPTION 'account is not on security hold'; END IF;
  IF u.email <> p.current_email THEN RAISE EXCEPTION 'current login email does not match'; END IF;
  IF EXISTS (SELECT 1 FROM "User" WHERE email = p.owner_email) THEN
    RAISE EXCEPTION 'owner email belongs to another account';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "UserEmailChangeRequest"
    WHERE "previousEmail" = p.owner_email AND "userId" <> p.user_id
      AND "consumedAt" IS NOT NULL AND "revertedAt" IS NULL AND "revertRevokedAt" IS NULL AND "revertExpiresAt" > now()
  ) THEN
    RAISE EXCEPTION 'owner email is reserved by another account''s revert window';
  END IF;

  -- 更正登入 Email。emailVerifiedAt 清空，本人完成密碼重設時重新驗證。必須剛好 1 筆。
  UPDATE "User"
  SET email = p.owner_email, "emailVerifiedAt" = NULL, "updatedAt" = now()
  WHERE id = p.user_id AND email = p.current_email AND status = 'security_hold';
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'expected to update 1 account, updated %', rc; END IF;

  -- 舊信箱不能再用任何還原或取消連結；未完成的變更作廢（筆數可為 0）。
  UPDATE "UserEmailChangeRequest" SET "revertRevokedAt" = now()
  WHERE "userId" = p.user_id AND "revertedAt" IS NULL AND "revertRevokedAt" IS NULL;
  GET DIAGNOSTICS revert_links = ROW_COUNT;
  UPDATE "UserEmailChangeRequest" SET "revokedAt" = now()
  WHERE "userId" = p.user_id AND "consumedAt" IS NULL AND "revokedAt" IS NULL;
  GET DIAGNOSTICS pending = ROW_COUNT;

  -- 結束所有 session 與未使用的密碼重設連結（暫停時應為 0，仍執行以防萬一）。
  UPDATE "UserSession" SET "revokedAt" = now(), "updatedAt" = now() WHERE "userId" = p.user_id AND "revokedAt" IS NULL;
  GET DIAGNOSTICS sessions = ROW_COUNT;
  UPDATE "PasswordResetToken" SET "usedAt" = now(), "updatedAt" = now() WHERE "userId" = p.user_id AND "usedAt" IS NULL;
  GET DIAGNOSTICS reset_tokens = ROW_COUNT;

  -- 稽核，不寫入任何 Email。必須剛好 1 筆。
  INSERT INTO "AuditLog" (id, "actorId", "actorLabel", action, "targetType", "targetId", after, "createdAt")
  VALUES (
    'manual-' || gen_random_uuid()::text,
    p.operator_id,
    'platform_admin_manual_sql',
    'account_login_email_corrected_by_support',
    'User',
    p.user_id,
    jsonb_build_object(
      'ticket', p.ticket, 'approvalRef', p.approval_ref, 'reviewerId', p.reviewer_id, 'emailVerifiedCleared', true,
      'revertLinksRevoked', revert_links, 'pendingCancelled', pending, 'sessionsRevoked', sessions, 'resetLinksRevoked', reset_tokens
    ),
    now()
  );
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'expected to write 1 audit entry, wrote %', rc; END IF;

  RAISE NOTICE 'corrected 1 account; revert links %, pending %, sessions %, reset links %', revert_links, pending, sessions, reset_tokens;
END $$;

-- reviewer 核對：應回傳 1 列，status 仍為 security_hold、emailVerifiedAt 為空。
SELECT u.id, u.status, u."emailVerifiedAt" FROM "User" u JOIN email_fix_params p ON u.id = p.user_id AND u.email = p.owner_email;

-- reviewer 同意後才輸入 COMMIT；否則輸入 ROLLBACK。
-- COMMIT;
```

`COMMIT` 刻意註解掉：operator 在 reviewer 確認後手動輸入；`psql` 結束時未提交的交易會自動回滾。交易完成後，帳號仍是暫停狀態，接著依授權程序第 7 步恢復。

## 注意

- 只有 `status = "security_hold"` 的帳號能用恢復功能；移除 MFA 工具只處理 `status = "active"` 的帳號；其他停用狀態兩者都不處理。
- 頁面只顯示遮罩後的 Email；需要完整資料時依個資處理規範另行查詢。
- PR #518 的 squash commit 訊息（`aac2b568`）第一段提到的「作廢舊信箱還原連結」（設定頁的「確認是我本人，作廢舊信箱的還原連結」、`account_email_revert_links_voided` 稽核、`email_revert_void_mfa_required` 錯誤）在合併前已移除，正式環境沒有這個功能；同一則訊息後段的 B1 有說明移除原因。客服不要引導使用者找這個選項，稽核紀錄中也不會出現這個 action。
