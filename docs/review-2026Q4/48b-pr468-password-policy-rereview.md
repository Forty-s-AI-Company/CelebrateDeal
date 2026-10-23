# PR #468 複審：一般用戶密碼 8 碼與常見密碼擋除（修正 commit afac0aa9）

- 分支：`codex/beta-password-policy-8`，複審範圍 `e4b7e9c0..afac0aa9`
- 前次審查：`48-pr468-password-policy-review.md`
- 審查日期：2026-10-23；reviewer（Opus），唯讀，未修改程式

## 結論

**可合併。** 前次的 M-1 已修正：三個入口的管理員 12 碼規則，都依伺服器從 DB 查到的 `platformRole` 判斷。m-1、m-2、m-3 與 N-1 到 N-5 也都處理了。

這次另外找到兩項 MINOR，都不影響合併，建議開後續 PR 處理：

- n-1：NFKC 展開會讓長度規則被繞過。
- n-2：清單條目前後加一個符號就能通過。

## 實際執行的驗證

| 項目 | 結果 |
|---|---|
| `vitest run`：password-policy、actions、registration-actions、reset confirm route、auth-entry-feedback、invitations accept page（6 檔） | 546 項通過 |
| `vitest run`：`src/lib/password-reset.test.ts`、`src/lib/vendor-member-invitation.db.test.ts` | **21 項通過**。資料庫是 scratchpad 內用 `initdb` 自建的拋棄式 PostgreSQL（127.0.0.1:55468／`celebratedeal_test`），先跑 `prisma migrate deploy` 套用全部 migration，跑完即停止。沒有碰到 5433 與 54329 的既有庫。 |
| `npm run typecheck` | 通過 |
| `eslint`：12 個變更檔 | 0 個問題 |
| `tsx` 邊界探測 | 約 110 組樣本，結果見下方 |

## 查核項目

### (1) 管理員 12 碼與探測面

三個入口的角色來源都在伺服器端，請求端無法自行指定角色：

- **設定頁**：`auth-security-actions.ts:172` 使用 `auth.user.platformRole`，這個值是 `requireAuth()` 從 DB 載入的 user。
- **重設 Server Action**：`auth-security-actions.ts:229` 使用 `findPasswordResetTokenAccount(token)`。
- **重設 API**：`route.ts:29` 同樣使用 `findPasswordResetTokenAccount(token)`。
- **request schema**：沒有 `platformRole` 欄位，`PasswordPolicyContext` 只會從上面這些來源填值。
- **邀請接受**：只會建立新帳號，新帳號不可能是 platform_admin；既有帳號走的是 session 路徑，不需要輸入密碼。所以這裡不傳 role 是正確的。
- **其他設定密碼的路徑**：`hashPassword*` 的呼叫點跟上次相同，沒有新增。

`findPasswordResetTokenAccount`（`password-reset.ts:143-151`）沒有擴大探測面：

- 不論 token 存不存在，都只做一次 `findUnique`，只讀不寫。
- 判斷條件跟 `consumePasswordResetToken` 相同。
- token 無效時回 `null`，政策套用一般的 8 碼規則，所以無效 token 不會讓回應多出 `minLength:12` 或 `personal`。

剩下的資訊差異：持有**有效** admin token 的人送 8～11 碼密碼，會得到 `{reason:"short",minLength:12}`，也就因此知道這個帳號是管理員。不過 token 是 256 位元的隨機值，猜不到；而能拿到 token 的人本來就能直接重設密碼。所以這不是新的帳號存在性或 token 有效性 oracle，列為資訊性的 NIT（n-4）。

### (2) 弱密碼與正常密碼樣本

**前次列出的 16 個漏擋樣本現在全部擋下**（`reason: common`）：

- `12345678!`、`123456789!`、`1234567890a`、`11111111a`
- `aaaaaaa1`、`88888888a`、`qwertyuiop1`、`zxcvbnm,`
- `qwerty2026`、`dragon2026`、`monkey2026!`、`letmein2026`
- `admin2026!`、`hello2026`、`abc123456789`、`2026password`

**coordinator 指定的 5 個樣本全部擋下**：`Passw0rd`、`Welcome1`、`Summer2026`、`abc12345`、`P@ssw0rd`。

**我另外試的弱密碼，下列都已擋下**：

- `Passw0rd2026`、`P@ssw0rd!!`、`Welcome2027`、`Summer2027!`、`Football2026`
- `Qwerty123!`、`Admin@123`、`Abcd@1234`、`Aa123456`、`Zxcvbnm123`
- `Taiwan2026!`、`Woaini1314!`、`Monkey!2026`、`!!Dragon2026`、`2026!dragon`
- `michael1987`、`jordan1990`、`Hello@2026`、`asd123456`、`zxc123456`
- 管理員情境的 `Password12345`、`Welcome2026!!`、`adminadmin12`

**仍會通過的弱密碼**見 n-2。

**前次 6 個正常密碼仍然全部通過**：`Tiger7rain`、`coffee42cup`、`blue-house-9`、`mango2street`、`k8Xp2mQz`、`sunny day 7`。

**另外 19 組正常密碼也都通過**：

- `Rainy taipei tea`、`my2cats&1dog`、`Lantern-Festival9`、`bike to work 77`、`Ocean7breeze`
- `river stone 42`、`dragonfruit smoothie`、`password manager rocks!`、`Juniper88!`、`sevenleaf`
- `houseplant`、`Moonlight09`、`greenpepper`、`maple syrup 3`、`1990年的夏天`
- `tokyo trip 2026`、`qwertzu bridge`、`morning123run`
- 管理員情境的 `bluewhale123`

這次只找到一個誤殺：`abcdefXy7Q`（見 n-3）。

### (3) NFKC 與去符號比對

- **全形字**：`ｐａｓｓｗｏｒｄ` 現在會擋下。
- **email 名稱比對**：會去掉 `+tag` 與 `. _ -`，例如 `meilin2026` 對 `mei.lin@` 會判為 personal。
- **角色型信箱**：`sales@` 這類信箱名稱不套用 personal 規則。
- **誤殺**：去符號後比對沒有發現誤殺。`compact` 只用在 email 名稱比對；核心字比對要求去掉頭尾非字母後**完全等於**清單或基底字，不是子字串比對，所以 `dragonfruit smoothie`、`greenpepper` 都能通過。
- **繞過**：有一個長度繞過，見 n-1。

效能沒有問題。實測耗時：

| 輸入 | 次數 | 耗時 |
|---|---|---|
| 1024 碼 | 1 萬次 | 81ms |
| 1024 個會展開的字元（每個約 18 字） | 1 千次 | 264ms |

### (4) 測試覆蓋

以下邊界與情境都有實際覆蓋：

- 長度：7／8、11／12（admin，涵蓋 unit、actions、API）、128／129、1024／1025。
- emoji 長度。
- 清單命中、規則命中、personal、角色信箱、`+tag`。
- API 的 trim：檢查與寫入用同一個值。
- DB 層的 `platformRole` 回傳。

斷言變動檢查：

- 唯一放寬的地方是「結果只含 ok/reason」改成「key 屬於 ok/reason/minLength」。這是因為新增了 `minLength` 欄位，而且「不含密碼」的斷言仍然保留，可以接受。
- 原本 API 測試的 129 碼案例改成 1025 碼（schema 擋），129 碼移到 policy 測試，斷言內容沒有變弱。
- 沒有 skip。
- 邀請 DB 測試改成每次嘗試用不同的合成 IP，避開限流額度，合理。

## Findings

### BLOCKER

沒有。

### MAJOR

沒有。前次的 M-1 已修正並驗證。

### MINOR

**n-1：NFKC 展開讓長度規則可被繞過，管理員 12 碼也一樣**（`src/lib/password-policy.ts`，`validateNewPassword` 裡的 `normalized`／`chars` 計算）

- **失敗情境**：
  - 單一字元 `ﷺ`（U+FDFA）經 NFKC 會展開成 18 個字元，因此通過 8 碼規則，連 `{platformRole:"platform_admin"}` 也通過。實測 `{"ok":true}`。
  - 實際存進資料庫的雜湊對應的是原始的 1 個字元。
  - 其他會展開的字元也能這樣用，例如 `㍿`、`ﬀ`、`⑴`。
- **風險評估**：使用者必須刻意選這類字元，所以風險低；但它確實讓「至少 8／12 字元」的保證失效。
- **修法**：長度用**未正規化**的字元數計算，例如 `Array.from(password.trim()).length`；NFKC 只用在清單與規則比對。另外補一個 `"ﷺ"` 會被判為 short 的測試。

**n-2：清單條目前後加一個符號、或是 leet 變體，仍然能通過**

- **位置**：`src/lib/password-policy.ts` 的 `isListedWordWithDigits` 與 `isPaddedPattern`
- **仍然通過的樣本**：
  - `1qaz2wsx!`、`q1w2e3r4!`、`1q2w3e4r5t!`、`Aa123456!`、`qweasd123!`、`123qweasd`
  - `!12345678!`、`x12345678x`（兩端各加一個字元）
  - `Pa$$w0rd`、`P@55w0rd`、`l3tm31n2026`
  - `Abc@12345`、`5201314abc`、`dragon dragon`
- **原因**：
  - 核心字比對只去掉頭尾的「非字母」。像 `1qaz2wsx` 這類開頭或結尾本身就是數字的清單條目，去完之後就對不上了。
  - padding 規則只會去掉單一端，所以兩端各加一個字元就繞過了。
- **修法**：
  1. 對 k=1..4，如果被去掉的部分都是非字母，就檢查 `COMMON_PASSWORD_SET.has(value.slice(0,-k))` 與 `has(value.slice(k))`。
  2. padding 規則改成可以同時去掉兩端，兩端合計最多 4 個字元。
  3. 可以選擇做 leet 還原（`$→s`、`@→a`、`0→o`、`1→l`、`3→e`、`5→s`）後再查清單。

### NIT

**n-3：小幅誤殺**

- **樣本**：`abcdefXy7Q` 被判為 common。
- **原因**：6 碼的連續字 `abcdef` 加上 4 個字元，就符合 padding 規則。
- **處理建議**：可以接受；如果要收緊，把 `MIN_WEAK_CORE_LENGTH` 用在「去掉部分 ≤ 核心長度的一半」之類的條件上。

**n-4：重設 API 對持有有效 admin token 的人揭露帳號角色**

- **情境**：重設 API 回應的 `minLength: 12`，以及 Server Action 的 `admin_short`，會讓持有有效 admin token 的人知道這是管理員帳號。
- **影響**：token 不可猜，持有者本來就能重設密碼，所以不構成新的攻擊面。
- **建議**：如果想把回應形狀做到完全一致，可以考慮不回 `minLength`，前端只顯示通用的「長度不足」。

**n-5：重設頁的前端提示固定顯示 8 碼**

- **情境**：重設確認頁的 `minLength` 與提示固定是 8，因為頁面不知道 token 屬於哪個角色。管理員要等送出後，才會從伺服器拿到 `admin_short`。
- **建議**：這樣的行為可以接受，不需要為此在頁面上先查 token 角色（那反而會增加探測面）。

## 最終判定

**可合併。** 管理員 12 碼在三個入口都由 DB 的 `platformRole` 決定，查詢只有一次，回應形狀不會讓人探測 token 是否有效或帳號是否存在。前次的弱密碼樣本全部擋下，正常密碼沒有被誤殺。DB 測試已在自建的拋棄式資料庫實際通過。n-1（NFKC 長度繞過）與 n-2（漏擋）建議開後續 PR 處理。
