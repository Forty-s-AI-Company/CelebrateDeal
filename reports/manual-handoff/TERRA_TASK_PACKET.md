# CelebrateDeal Terra High Task Packet

派工批次：TERRA-PACKET-001
任務數：1
前置狀態：原 `/goal` 暫停；不得碰 migration／DB rollout。
執行模型建議：Terra High。完成後必須交回 Sol 複查，不得自行宣告 Goal 完成。

## TERRA-ARCH-001 — 抽離 Vendor Member Server Actions 並恢復 2300-line Gate

### 問題與證據

- Night Review 實際測試證明 `src/app/actions.ts` 計數 2345，超過原 architecture ceiling 2300。
- 2026-07-26 10:07 後 ceiling 被提高到 2345，這是弱化測試，不是修復。
- `createVendorMemberAction`、`resendVendorMemberInvitationAction`、`deactivateVendorMemberAction` 位於 root actions 約 693～1042 行，形成可獨立抽離的 vendor-member domain。
- 抽離此 domain 足以讓 root module 回到原 2300 ceiling 以下，不需要改商業規則、schema 或 migration。

### 允許修改的檔案

- `src/app/actions.ts`
- 新增 `src/app/actions/vendor-member-actions.ts`
- `src/app/actions.test.ts`
- 可選：新增 `src/app/actions/vendor-member-actions.test.ts`
- `scripts/architecture-boundaries.test.ts`

除上述檔案外不得修改。若發現編譯必須改其他檔，停止並回報 Sol，不要擴大範圍。

### 禁止修改的檔案

- `prisma/**`
- `scripts/prisma-invariant-inventory.test.ts`
- `docs/codex-goal/PRISMA_INVARIANTS.md`
- `scripts/backfill-bank-account-encryption.ts`
- `src/lib/bank-account.ts`
- `src/lib/affiliate-commission.ts`
- `src/lib/payment-webhooks.ts`
- payout／settlement／refund actions
- `package.json`、lockfile、CI workflow
- 任何 E2E fixture、外部服務設定、Production／Staging 資料
- 本 packet 未列入的產品或測試檔案

### 必須保留的行為

- `@/app/actions` 的既有 import surface 不變；現有 consumers 不需改 import。
- 三個 action 的名稱、參數與 redirect/error query contract 不變。
- 每個 mutation 仍先執行 CSRF security gate。
- 只有 vendor owner 可建立、重送邀請或停用 member。
- role allowlist 維持 `owner`、`admin`、`accountant`。
- 禁止自我停用。
- 最後一位 active owner 不可被降級或停用；原 transaction／serialization conflict 行為不變。
- invitation rate limit、generic failure handling、audit log、revalidation 與 email failure semantics 不變。
- 不得新增 raw error、Email、token 或 credential logging。
- 不得改資料庫 query predicate、transaction isolation、status 字串或 audit action 名稱。

### 建議實作方向

1. 建立具 `"use server"` 的 `vendor-member-actions.ts`。
2. 將三個完整 action 與只屬於該 domain 的小型 helper／constant 移入新檔。
3. 使用現有 `@/lib/*` boundary；不要從新 module import root `actions.ts`，避免 cycle。
4. 在 `src/app/actions.ts` 以 explicit re-export 保留既有 public API。
5. 保留現有 tests；若拆 test，必須確保原所有 assertion 都仍執行。
6. 將 architecture ceiling 恢復為 `2_300`。抽離後可低於此值，但不得改成 2345、動態 current count 或更高數字。

### 不得採用的捷徑

- 不得提高、刪除、skip 或改寫 architecture assertion 來配合現況。
- 不得只刪空白、註解或壓縮格式湊行數。
- 不得把三個 action 複製到新檔後仍保留 root 實作。
- 不得用 `export *` 隱藏 public surface；使用 explicit re-export。
- 不得改弱 last-owner、self-deactivation、tenant、CSRF 或 rate-limit assertion。
- 不得把 redirect／audit／email failure 改成吞錯以通過測試。
- 不得順手整理 payout、refund、MFA、schema、migration 或其他 backlog。

### Targeted tests

最低必跑：

```powershell
npm test -- --run src/app/actions.test.ts scripts/architecture-boundaries.test.ts
npm run typecheck
npm run lint
```

若新增獨立 test file，必須一起列入 targeted run。

另外回報：

```powershell
(Get-Content -LiteralPath 'src/app/actions.ts').Count
```

並確認 architecture test 使用 `2_300`，不是 `2_345`。

### Related regression

- 建立新 member／重新邀請 member。
- re-activate existing member。
- invalid role／invalid input。
- self-deactivation rejection。
- last active owner invariant 與 serialization conflict。
- inactive／platform user invitation resend rejection。
- email failure 的 audit 與 redirect。
- root `@/app/actions` re-export 可被既有 settings/security consumers 使用。
- runtime import graph無 cycle、domain→UI boundary 無新增 violation。

### 完成標準

- `src/app/actions.ts` 由實際 domain extraction 降至 ≤2300 test count。
- `scripts/architecture-boundaries.test.ts` ceiling 恢復為 2300，且四個 architecture tests 全通過。
- 三個 action 從新 domain module explicit re-export。
- 行為、query predicate、redirect、audit、rate-limit 與 transaction semantics 無改變。
- targeted action tests、typecheck、lint 全部通過。
- diff 僅包含允許檔案。
- 沒有 formatter 大面積改寫、dependency、schema、migration、CI 或報告變更。

### 需要回報的內容

- 修改檔案清單。
- 抽離前後 root action test line count。
- 三個 public exports 的保留方式。
- targeted tests、typecheck、lint 的命令與 exit code。
- 是否有任何 assertion、query predicate、redirect、audit payload 或 transaction behavior 改變；預期答案應為「沒有」。
- `git diff --check` 結果。
- 未解決或需 Sol 決策的項目；不要自行擴大 scope。

### 需要 Sol 複查的風險

- last-owner invariant 是否在搬移時仍位於相同 transaction boundary。
- conditional update／serialization conflict 是否維持 fail closed。
- invitation email 失敗是否仍不洩漏敏感資訊，且 audit/revalidation 一致。
- root re-export 是否造成 runtime cycle 或 Server Action boundary 改變。
- architecture ceiling 是否真正恢復 2300，而不是以其他形式繞過。

## 本批明確不派發

- 兩個 candidate migration 的任何修改、apply、backfill 或 count 更新。
- 銀行帳戶加密 rollout。
- affiliate commission DB constraint／unique semantics。
- Codex Security 52 candidates 的直接修正。
- Production、Staging、GitHub push／runner、外部 Dashboard。

上述全部保留給 Sol／人工 Gate。
