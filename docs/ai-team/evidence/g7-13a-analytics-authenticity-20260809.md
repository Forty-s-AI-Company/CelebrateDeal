# G7-13A Analytics authenticity evidence

- Work Package：`G7-13A`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- UTC evidence time：`2026-08-08T17:59:49.999Z`
- 結果：`LOCAL_ACCEPTED`
- Reviewer：`NO_P0_P1`
- Browser：`NOT_RUN`，本工作處理 API、資料庫與 KPI 信任邊界，沒有把舊 Browser evidence 當成 fresh PASS。
- Sandbox／staging／Production：`NOT_RUN`

## 實際產品修正

1. `/api/analytics` 不再接受 client-controlled `visitorId`。Zod payload 採 strict schema，額外欄位會被拒絕。
2. analytics 寫入前必須取得 server-issued HttpOnly live viewer cookie，並以資料庫中的 active session 驗證 exact `vendorId + liveId + tokenHash + expiresAt`。
3. canonical `visitorId` 改為 server-issued opaque token 的 SHA-256，不保存或轉送 raw token。
4. 新增 `AnalyticsTrustLevel`：
   - `LEGACY_UNVERIFIED`
   - `ADMITTED_LIVE_SESSION`
5. migration 將所有既有 analytics row 預設標為 `LEGACY_UNVERIFIED`，避免歷史 client-reported row 被誤算成可信 KPI。
6. dashboard 與 live analytics 只計 `ADMITTED_LIVE_SESSION`，並以 `eventType + visitorId` distinct，避免同一播放 session 重複灌高 KPI。
7. UI 改用「播放 session」與「經 admission 的不重複播放 session」，明示這不是不重複真人數。報名仍明示等待聯絡方式驗證。
8. live analytics 最近事件只顯示 session hash 前 12 字元，不呈現 raw token 或完整識別值。
9. `src/app/actions.test.ts` 的全域 `beforeEach` 補齊 manager context mock，移除互動 action 測試依賴其他測試先執行的順序問題。

## Deterministic evidence

| 驗證 | 結果 | 精確範圍 |
|---|---:|---|
| Analytics／client／playback／dashboard／live analytics tests | `49/49 PASS` | 5 test files |
| Interaction action focused tests | `15 PASS / 187 filtered` | `src/app/actions.test.ts` interaction role/script lifecycle subset |
| Prisma generate／validate | `PASS` | dedicated no-dotenv loopback config |
| Disposable PostgreSQL migration | `PASS` | PostgreSQL 16 tmpfs、loopback dynamic port、43 canonical migrations |
| Disposable DB contracts | `3/3 PASS` | real admission cookie → route → DB；legacy default；distinct trusted sessions；invalid enum rejection |
| TypeScript | `PASS` | `npx tsc --noEmit --pretty false`，exit `0` |
| Scoped ESLint | `PASS` | G7-13A production/test/config files，exit `0` |
| Controlled production build | `PASS` | no-env OS-temp mirror、synthetic allowlisted environment、`next build --webpack`，exit `0` |
| Diff whitespace check | `PASS` | `git diff --check`，只有既有 CRLF warning |
| Read-only reviewer | `NO_P0_P1` | admission、tenant/live、hash、legacy、KPI、migration、leakage、tests |

### Database assertions

- 省略 `trustLevel` 的 raw legacy insert 由 PostgreSQL 設為 `LEGACY_UNVERIFIED`。
- 同一 admitted token 的重複 `page_view` 只形成一個 canonical session；另一個 admitted token 形成第二個 session。
- 真實 `LIVE_VIEWER_SESSION_COOKIE` 綁定 active `LiveViewerSession` 後，route 回傳 `{ ok: true, verified: true }`，資料列只保存 token hash 與 `ADMITTED_LIVE_SESSION`。
- 不在 enum allowlist 的 `FORGED_CLIENT_EVENT` 由 PostgreSQL 拒絕。
- 兩次 disposable PostgreSQL run 都完成 exact-container cleanup；最終可引用 run 為 `43 migrations / 3 tests / cleanup PASS`。

## 失敗與工具阻擋紀錄

- 一次 PowerShell allowlist-mirror launcher 在 process 建立前被本機命令政策拒絕。沒有建立 temp 目錄、沒有 build attempt、沒有讀取 `.env*`。後續改用既有且已有測試的 `runControlledProductionBuild()`，沒有重複失敗命令，結果 `PASS`。
- 一次 reviewer spawn 參數組合不支援 `agent_type + fork_context`。沒有建立代理或修改檔案；改用獨立唯讀 reviewer，結果 `NO_P0_P1`。

## Ownership 與回滾

- 工作區原本已有大量使用者與舊 WP 變更。本工作只接管 source manifest 所列 G7-13A hunks 與 4 個新增檔案，不 stage、不 commit、不 push。
- source 回滾可移除 analytics admission/trust query/UI wording 與測試 hunks。
- migration 尚未部署到正式環境。正式環境若已套用，禁止以破壞性 down migration 回滾；應以新的 forward migration 處理。
- disposable database 與 temp build mirror 已清除，沒有保留測試資料或 container。

## 計分資格

- 這份證據關閉先前 code review 的 analytics authenticity P1，提升互動／直播成效的完整性安全與證據可信度。
- 固定功能 inventory 的互動角色／直播能力維持既有本機候選 `8/10`，沒有重複加分。
- canonical 維持 `73.5`、`CAT04=6.0`、`CAT10=4.5`。本機 deterministic evidence 不替代 PayUni Sandbox、外部營運證據或真人簽核。
- Goal 維持 active。

## 殘餘風險與下一個最高價值工作

1. 公開 admission 代表「有效播放 session」，不能宣稱為真人或唯一觀眾；外部 WAF／bot control 仍需要 release evidence。
2. production 資料量增加後，非 concurrent index migration 需要 release owner 評估維護時間；目前為 prelaunch，未列 P1。
3. 下一個產品 P1：公開 form submission 目前能在聯絡方式未驗證前進入正式名單與報名 KPI。應新增 `unverified / verified` lead state、ownership verification gate、可信 KPI filter 與防濫用控制。
4. 再下一個產品 P1：checkout 的 public request 可建立 pending order 並暫時保留庫存。應加入 server-issued buyer/reservation nonce，並區分未驗證 reservation 與正式營運訂單。

完整 SHA-256 見 `g7-13a-source-manifest-20260809.txt`。
