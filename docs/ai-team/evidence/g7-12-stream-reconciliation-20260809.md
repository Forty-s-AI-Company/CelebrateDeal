# G7-12 Stream provider 用量對帳與差異營運 closure

- 完成時間（UTC）：`2026-08-08T17:33:06.8838319Z`
- 結果：`PASS_LOCAL_DETERMINISTIC_BROWSER_NOT_RUN_PROVIDER_ATTESTATION_PENDING`
- 固定 inventory：`團隊漏斗／Stream／營運後台`
- 分數判斷：前一輪本機候選 `7.8/10`，本輪本機功能候選 `8.3/10`
- Canonical：總分仍為 `73.5`；CAT04=`6.0`、CAT10=`4.5`
- Release：`SANDBOX_READY=false`、`PRODUCTION_READY=false`

## 這輪完成的產品功能

1. 新增 provider-neutral 月度用量快照；provider 摘要與 immutable internal playback ledger 分開保存，不會覆寫原始帳務資料。
2. 匯入採固定 SHA-256 digest 做 idempotency；同一 digest 內容漂移或跨 tenant 重用會 fail closed。
3. 證據等級固定標示為 `ADMIN_ATTESTED_DIGEST`，管理畫面與商家畫面都明說「不是 provider 簽章」，不假裝 Cloudflare 已驗證。
4. Provider 與 internal ledger 超過固定一分鐘容差時建立 persistent `PROVIDER_DISCREPANCY` alert；較新的 `MATCHED` 不會掩蓋較舊、仍未解決的 mismatch。
5. 財務管理員可用 `ACCEPT_INTERNAL`、`ACCEPT_PROVIDER`、`ESCALATED` 留下明確 resolution、理由、actor 與 timestamp；只有 `MISMATCH → RESOLVED`，snapshot 本身不可變。
6. Billing calculation 遇到任何未解 mismatch 或 escalated resolution 會 fail closed；採用 provider 數值時只影響尚未鎖定的結算 basis，不修改 internal ledger。
7. Billing cycle 在同一個 `Serializable` transaction 重新檢查 blocker 與 reconciliation ID CAS，避免計算後、開 invoice 前證據被替換。
8. 接受 heartbeat 用量時，同一 transaction 會建立 80% quota warning 或 quota exhausted alert；duplicate heartbeat 不重複產生 side effect。
9. 新增 MFA platform-finance admin 對帳頁、CSRF action、sanitize input、pending／disabled／confirm／loading／error 回饋，以及 tenant-scoped 商家用量對帳與通知畫面。

## Deterministic 驗證

| 驗證 | 結果 |
| --- | --- |
| final targeted Vitest matrix | `15 files / 122 tests PASS`、0 failed、0 skipped |
| post-refactor focused regression | `3 files / 46 tests PASS` |
| `npx tsc --noEmit --pretty false --incremental false` | `PASS` |
| scoped ESLint `--max-warnings 0` | `PASS` |
| dedicated no-dotenv Prisma validate | `PASS` |
| controlled production build | `PASS`、exit 0、未繼承 application environment |
| disposable PostgreSQL `postgres:16-alpine` | 42 migrations、status up to date、DB contract `2/2 PASS`、cleanup `PASS` |
| final reviewer | `NO_P0_P1` |

Disposable database 使用 loopback 隨機 port、`celebratedeal_test`、獨立 schema `g7_12_503d4dae386b47d1` 與 tmpfs；測試結束後精確容器已移除。最終 DB／Prisma 驗收使用專用 config，不載入 dotenv，也沒有接觸正式資料庫、付款、退款或客戶資料。

## 如實保留的失敗紀錄

- 第一輪整合測試為 `71/73 PASS`：一個合法的含毫秒 ISO timestamp 被拒絕，另一個是 UI 文案 expectation 不一致。修正 parser 與精確 expectation，沒有刪 assertion、加 skip 或降低門檻。
- Reviewer 第一輪提出 2 個 P1：舊 mismatch 可能被新 MATCHED 隱藏，以及 reconciliation 在 usage calculation 與 invoice settlement 間可能變更。兩項均修正並補 regression。
- 第一個 disposable 路徑使用不在 allowlist 的 database name，安全 gate 正確拒絕；該次 DB test 不列 PASS，容器已清理。
- 一個後續 compact disposable 命令遺漏 `DIRECT_URL` 且 schema marker 只有 12 hex，migration command FAIL；cleanup PASS。下一條不同路徑改用 dedicated no-dotenv config 與合法 16-hex marker後完成驗證。
- 第一輪 final scoped ESLint 發現 vendor usage page complexity `37` 高於既有上限 `30`；後續抽出純展示元件，門檻未修改。
- 第一個 dedicated no-dotenv Prisma validate 遺漏 schema-level `DATABASE_URL`，回傳 P1012 且未連線；補上 synthetic loopback binding 後 PASS。
- 中途曾執行專案共用 `prisma.config.ts` 的 validate；該 config 本身含 dotenv loaders。沒有輸出或保存任何環境值，但此結果不列為 final evidence，最終以 dedicated no-dotenv config 重驗。
- Browser 產品驗收為 `NOT_RUN`：本輪沒有安全的 CelebrateDeal authenticated admin／vendor fixture，因此不把 component test 冒充 Browser PASS。

## 分數解讀

本輪按固定 10 分 rubric 評為 `8.3/10`：核心 `2.6`、錯誤復原 `1.8`、UX `1.4`、完整性安全 `1.0`、fresh evidence `1.5`。這代表 source 與本機 deterministic evidence 支持 Stream 對帳／差異營運已完成可用閉環；不是 canonical 加分，也不是 Cloudflare 真實帳單已驗證。

Canonical 總分仍為 `73.5`，因為以下證據仍未完成：

- authorized Cloudflare／configured provider 的 sandbox 或 staging export／API provenance；
- authenticated desktop／mobile、keyboard 與 Axe Browser matrix；
- external notification delivery channel 與具名真人 operations owner acceptance；
- provider overage 自動收費仍刻意停用，目前採 fail-closed 與明確 invoice workflow，避免未授權扣款。

目前不需要使用者立刻手動處理；上述外部／真人事項已列 blocker，可先跳過並繼續下一個本機高價值功能 WP。

## 可追溯與防竄改

- Machine-readable report：`.ai-team/reports/g7-12-stream-reconciliation-20260809.json`
- Report SHA-256：`70c6924f650f371d85f7229d911b3882304cd057bcd4341a9cf03628bbc3ce4d`
- Source manifest：`docs/ai-team/evidence/g7-12-stream-reconciliation-source-manifest-20260809.txt`
- Source manifest SHA-256：`e0cfbc65386ca81b12fbda9721287723623e8135869a883ab0c825e1e3b258e1`

Manifest 綁定本輪核心 source、tests、Prisma schema／migration、disposable configs、report 與 report sidecar。驗收時應重新計算所有 SHA-256；任一不符即不得沿用本 checkpoint 結論。

## 回滾範圍

- Stream reconciliation schema、migration、domain service 與 database contract；
- quota／provider discrepancy persistent alerts；
- billing decision 與 billing-cycle reconciliation gates；
- finance admin reconciliation actions／pages；
- vendor billing usage reconciliation／alerts presentation；
- G7-12 disposable Prisma／Vitest configs。

本輪沒有建立 commit、沒有 stage、push、merge 或 deploy；回滾必須只針對上述精確 scope，且不得覆蓋使用者既有 dirty worktree。

## 下一個最高產品價值工作

`G7-13 public interaction-role authenticity, disclosure and event-flow closure`：互動角色／虛擬使用者屬必做販售功能，下一輪優先確認公開訊息一致揭露官方／腳本角色，並補齊 chat、product spotlight、CTA switch、preview、錯誤復原與 audit 的真實流程；不得用角色偽造真人觀看、報名、訂單、付款、評論或成效。
