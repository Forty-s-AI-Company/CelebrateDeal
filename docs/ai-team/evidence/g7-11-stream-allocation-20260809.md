# G7-11 Stream 視覺分潤與配額設定 closure

- 完成時間（UTC）：`2026-08-08T16:53:22.9426326Z`
- 結果：`PASS_LOCAL_DETERMINISTIC_BROWSER_NOT_RUN`
- 固定 inventory：`團隊漏斗／Stream／營運後台`
- 分數判斷：既有 baseline `6.0/10`，本機功能候選 `7.8/10`
- Canonical：總分仍為 `73.5`；CAT04=`6.0`、CAT10=`4.5`
- Release：`SANDBOX_READY=false`、`PRODUCTION_READY=false`

## 這輪完成的產品功能

1. Live Studio 不再要求商家手寫 `customAllocations`、`memberQuotas`、`pageQuotas` JSON。
2. 新增視覺化 `PROMOTER`、`OWNER`、`SPLIT`、`CUSTOM` 分配模式；百分比 UI 仍轉成既有 basis-point server contract。
3. 商家可增刪成員／合作頁配額，並在畫面上看到重複對象、無效百分比、缺少分鐘數與失效 reference 等錯誤。
4. 每個欄位保留 keyboard 操作、可見錯誤、`aria-live`／status 回饋；隱藏 transport 只負責與既有 server action 契約相容。
5. Live 新增／編輯頁只傳遞 tenant-scoped active member 與 partner-page 的必要 label，避免把完整資料列序列化到 client。
6. `defaultAffiliateCode` 現在於 server 端正規化，並驗證 vendor ownership 與 active state；偽造、停用或跨商家 code 會 fail closed。
7. quota membership 必須同時符合 `ACTIVE` 且 `leftAt=null`。
8. 已過期或 consumed 的 edit draft 可安全 revive；仍有效的 draft 會維持單一 writer conflict，不允許第二個 request 覆寫。

## Deterministic 驗證

| 驗證 | 結果 |
| --- | --- |
| 13 個 focused Vitest files | `284/284 PASS`、0 failed、0 skipped |
| `npx tsc --noEmit --pretty false --incremental false` | `PASS` |
| scoped ESLint `--max-warnings 0` | `PASS` |
| controlled production build | `PASS`、未繼承 application environment |
| disposable PostgreSQL `postgres:16-alpine` | 41 migrations、DB contract `2/2 PASS`、cleanup `PASS` |
| final reviewer | `NO_P0_P1` |

Disposable database 使用 loopback 隨機 port、獨立 schema `g7_11_d7594ade1347446c` 與 tmpfs；測試結束後 container 已移除。沒有載入 dotenv，也沒有接觸正式資料庫、付款或客戶資料。

## 如實保留的失敗紀錄

- 第一輪 focused component run 為 `49/52 PASS`：新增 nested editor 後，三個測試的 hand-rolled React hook mock／render isolation 不再成立。後續修正測試隔離與真實 render，沒有刪 assertion、加 skip 或降低門檻。
- 第一輪 scoped ESLint 發現 action helper complexity `31` 高於既有上限 `30`。後續抽出 helper，門檻未修改。
- Browser 產品驗收為 `NOT_RUN`：本輪沒有安全的 CelebrateDeal authenticated in-app Browser fixture，因此沒有操作產品頁，也不把 Browser 寫成 PASS。工作階段清理時找到 0 個 tab。

## Reviewer closure

Reviewer 第一輪提出 3 個 P1：expired edit draft 永久 conflict、`defaultAffiliateCode` 缺 server validation、client props 過度序列化。三項完成修正後，最終複核為 `NO_P0_P1`。

## 分數解讀

`7.8/10` 只代表目前 source 與本機 deterministic evidence 支持「Stream 視覺分潤／配額設定」已跨過 7 分功能線；不等於 canonical 或 release 分數已提升。Canonical 仍維持 `73.5`，因為以下證據尚未完成：

- authenticated desktop/mobile、keyboard 與 Axe Browser matrix；
- authorized sandbox／staging 的 Cloudflare 或實際 media provider usage reconciliation；
- quota discrepancy notification 與統一人工營運處理流程；
- provider overage 自動收費尚未啟用，目前採 fail-closed，避免未授權扣款。

## 可追溯與防竄改

- Machine-readable report：`.ai-team/reports/g7-11-stream-allocation-20260809.json`
- Report SHA-256：`5b78662ee216468399672ce75c2505b553b0b141c92a80879e4f578fc11bebee`
- Source manifest：`docs/ai-team/evidence/g7-11-stream-allocation-source-manifest-20260809.txt`
- Source manifest SHA-256：`15790b05ac80be5c95551453a56830b2e4278a10463d4d8b85537026ac0dc33f`

Manifest 綁定本輪核心 source、tests、Prisma schema、disposable config、report 與 report sidecar。驗收時應重新計算所有 SHA-256；任一不符即不得沿用本 checkpoint 結論。

## 回滾範圍

- `stream-allocation-editor` 與 Live Studio form/new/edit wiring；
- draft route revive 行為與 database contract；
- Live create/update 的 affiliate-code 與 active-membership validation；
- G7-11 disposable Prisma／Vitest config。

本輪沒有建立 commit、沒有 stage、push、merge 或 deploy；回滾必須只針對上述精確 scope，且不得覆蓋使用者 dirty worktree。

## 下一個最高產品價值工作

`G7-12 provider usage reconciliation and quota discrepancy operations closure`：先完成 provider-neutral ingestion、差異偵測與營運可處理的 read model；需要 Cloudflare／staging 授權的最後一哩列為外部 blocker，不阻塞其餘本機功能推進。
