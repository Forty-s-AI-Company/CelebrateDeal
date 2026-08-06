# WP-87 G2 disposable recovery rehearsal

狀態：`DETERMINISTIC_PASS_AWAITING_ACCEPTANCE`

本工作包只演練 local disposable PostgreSQL 的 `LOGICAL_FORWARD_REPLAY`：T0 custom
backup、空庫 restore、T1 synthetic journal replay 與第二次 idempotent replay。它不代表
WAL/PITR、provider-managed backup、production RPO/RTO 或正式資料庫復原。

所有資料均為 synthetic，runner 僅允許 loopback DB，並以清空後的 child environment
執行；receipt 不保存 DSN、密碼、備份內容或資料列內容。最終結果必須以 sanitized receipt
及 Sol acceptance 為準。

本機確認 source migration、三條 synthetic relation chain、T0 custom backup、archive list
parse、source journal 與兩個 disposable DB cleanup 都可執行；但可用的 PostgreSQL v18
client 產生含 v16 server 不支援設定的 custom archive，restore 因此 fail-closed。未降低
archive／restore 驗收標準、未改用 production 或外部資料庫。需安裝版本相容的 PostgreSQL
client 後，才可在同一範圍重新執行完整 rehearsal。

已依 Sol remediation 使用既有 `postgres:16-alpine` container 的同代 toolchain 重跑。
custom archive 經 container → 本機暫存 → container 的 round-trip 後成功還原：53 張
application tables 的 T0 指紋、migration、sequence 與 FK invariants 一致；source 與
recovered target 的 T1 logical forward replay 指紋一致，第二次 replay 亦維持不變。兩個
disposable DB 與全部 archive artifacts 均已清除。仍只代表 local
`LOGICAL_FORWARD_REPLAY`，不代表 production PITR 或 RPO/RTO。

Sol High verdict：`ACCEPT`。CAT-05 由 `5.0 → 6.0`；G2 標記為
`PASS — LOCAL_RECOVERY_REHEARSAL`。AGY wrapper 沒有可觀測 receipt，固定記為
`QA_RECEIPT_UNAVAILABLE`，絕非 QA PASS。此結果不外推為 provider backup、WAL/PITR、
production RPO/RTO 或正式 restore 已完成。
