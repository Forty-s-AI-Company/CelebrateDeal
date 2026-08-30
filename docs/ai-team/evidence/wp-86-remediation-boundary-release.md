# WP-86 remediation preflight evidence

狀態：`BLOCKED`（已保留 preflight；等待依 Sol remediation plan 建立安全 runner）

Sol 計畫要求隔離 snapshot 僅從 tracked source 複製輸入，並規定若 tracked
清單含任何 `.env*` 命名，必須在讀取內容前停止。本次唯讀檔名盤點發現三個
environment-template path；沒有讀取其內容、沒有複製 snapshot、沒有啟動 DB、
browser、server、產品測試或外部網路。

因此下列事項均未執行：

- immutable webinar owner-boundary spec；
- 新的 direct-URL spec；
- WP-86 runner；
- Prisma migration、synthetic DB 或 loopback server。

唯一新建的 test spec 仍未執行，並與所有既有 dirty paths 一樣維持可回滾、未
stage 狀態。這不是測試失敗，也不改變 M2-A01、M2-A02 或 G1 的結論。

Sol 已做出 `PLAN_REMEDIATION`：可採 path-only deny filter，在任何內容讀取、
hash、複製、archive 或子程序啟動前排除 environment-template path。preflight
receipt 僅保存排除數量與相對路徑名稱的 SHA-256，不保存 path 原文、內容或內容
hash。後續 runner 必須以空白 child environment 與 synthetic allowlist 執行，且
不得載入 dotenv、回退到 workspace 或存取外部網路／正式資料庫。

## Resumed deterministic evidence

最終隔離重跑已通過：offline dependency install、Prisma validate/generate、
synthetic loopback schema bootstrap/migrate/cleanup、兩支 owner-boundary browser
spec、兩支 spec ESLint 與 TypeScript typecheck。source-input digest 在測試前後一致；
三個 environment-template path 全程在內容讀取前排除，未使用外部網路或正式資料庫。

工作區既有 dirty dashboard page 所需的單一 untracked runtime module，以 Sol 核准的
`PRESERVE_ONLY` dependency closure 納入 OS temporary snapshot；其 importer chain 與前後
SHA-256 均保存在 sanitized receipt。這不改變或接管該使用者檔案。AGY Fast QA 與 Sol
acceptance 尚未完成前，M2-A01 與 G1 不得宣稱已解除。

AGY Fast wrapper 已依其內建上限嘗試唯讀 QA，但 transport 未提供 stdout、stderr、JSON
或 exit receipt。因此狀態固定為 `QA_RECEIPT_UNAVAILABLE_AFTER_MAX_ATTEMPTS`，不是 AGY
PASS；不再額外呼叫。Sol 可依完整 deterministic evidence 進行最終 acceptance，並保留此
可觀測性限制。
