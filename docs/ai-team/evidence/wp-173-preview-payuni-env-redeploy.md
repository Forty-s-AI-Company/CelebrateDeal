# WP-173 Preview PAYUNI_ENV Remote Redeploy and Alias CAS

## 結果

`WP173_PREVIEW_PAYUNI_ENV_REDEPLOY_ALIAS_VERIFIED`

CelebrateDeal 的 Vercel staging project 已完成一次 Preview-only configuration mutation，並從既有 Ready Preview deployment 做 remote redeploy。新 deployment `dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg` 為 `preview`／`READY`，direct `/api/health` bodyless HEAD 為 200。

staging alias 在三次 guarded drift check 均仍指向舊 deployment 後，切換至新 deployment。切換後 alias inspect 精確解析至新 ID，alias `/api/health` bodyless HEAD 為 200，因此 rollback 未執行；舊 deployment `dpl_CguykaCpikDEFjLWKUZrkPwFygbL` 已驗證為可用 rollback target。

## 安全與 ownership

- 授權限於 staging／Preview；沒有 Production 操作。
- `PAYUNI_ENV` 只確認名稱、Preview scope、sensitive type 與 mutation metadata，未讀回任何值。
- 沒有讀取 `.env*`、Secret、Token、Cookie、headers 或 response body。
- remote redeploy 使用舊 deployment ID；沒有上傳本機 workspace，也沒有包含 dirty changes。
- DB、PayUni query／payment／refund／callback、DNS 與 Git mutation均為 0。
- 既有 dirty paths 保持 `PRESERVE_ONLY`；`UNKNOWN=0`、`MIXED_HUNKS=0`、staged index empty。

## Readiness boundary

本包只解除 WP-172 的 Preview configuration deployment freshness blocker，不執行 staging DB identity 或 PayUni Sandbox reconciliation。CAT04 維持 6.0、總分維持 72.0；`SANDBOX_READY=false`、`PRODUCTION_READY=false`。後續重新驗證 runtime classification、DB identity 與 provider lookup 必須另開工作包。

Deterministic receipt strict readback/assertions、`git diff --check`、staged-empty 與 postflight alias inspect/health 均為 PASS。AGY Fast attempt 1 唯讀 QA verdict 為 `PASS`；它確認 config/deployment/alias evidence 沒有被外推成 runtime、DB、PayUni 或 readiness 結論。Sol High acceptance verdict 為 `ACCEPT`，CAT04 維持 6.0、總分維持 72.0。Receipt：`.ai-team/reports/wp173-preview-payuni-env-redeploy-receipt.json`。
