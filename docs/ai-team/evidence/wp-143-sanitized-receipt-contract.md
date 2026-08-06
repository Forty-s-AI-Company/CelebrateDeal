# WP-143 — Authoritative Sanitized Receipt Serializer Contract

## 範圍

建立完全獨立、import 無副作用的 receipt serializer／validator contract。WP-141、WP-142、產品 source、既有 dirty changes 與 repository `.next` 均為 `PRESERVE_ONLY`。

## 驗收目標

- `rawOutputPersisted=false` 與 `rawOutputExposed=false` 是合法值，不以欄位名稱 substring 誤判。
- strict allowlist 拒絕 raw output、absolute path、URL、環境值、token、cookie、secret、source snippet、generated content 與非法 JSON 型別。
- success、failure、insufficient、unsafe、fallback fixtures 均具 deterministic 結果。
- state machine 僅允許 `PRECHECK_ONLY → ATTEMPT_ARMED → ATTEMPT_CONSUMED → RESULT_RECORDED` 或 validation fallback。
- atomic write 使用 exclusive temp、flush、round-trip、rename-to-new-target，target 已存在時拒絕。
- contract module import 不啟動 process、不讀環境、不寫 workspace。
- runner `buildAttempts=0`，不執行 build、server、Browser、DB、network、PayUni、staging、deploy 或 Production。

## 分數

本包只建立未來 build 的 receipt prerequisite，不代表 build 或 diagnostic closure。CAT06 維持 7.0、CAT09 維持 6.5、總分維持 71/100。

## Rollback

只可移除五個 WP-143 新 artifacts 及 runner-owned temp 目錄；不得修改 WP-141／WP-142 或任何既有 dirty path。
