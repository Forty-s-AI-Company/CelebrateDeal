# Staging R2 綁定驗證

狀態：**程式與測試就緒；尚未在受保護的 Preview runner 執行，R2 真實連線與權限未獲證明。**

`.github/workflows/staging-provider-binding-attestation.yml` 提供手動、受保護 `master` 專用的 Preview Environment 工作。它先確認 R2 account ID 和 bucket 與獨立設定的預期值完全相同，再要求 bucket 名稱有 `staging`、`preview` 或 `test` 分段，且不得有 `prod` 或 `production` 分段。只有這些檢查通過後，才對該 bucket 發出一次 S3 `HeadBucket`。不列出或讀取物件，也不新增、修改或刪除物件。

Preview Environment 必須提供：

| 類型 | 名稱 | 用途 |
| --- | --- | --- |
| variable | `CLOUDFLARE_R2_ACCOUNT_ID`、`CLOUDFLARE_R2_BUCKET` | 待驗證的 staging 綁定 |
| variable | `STAGING_R2_EXPECTED_ACCOUNT_ID`、`STAGING_R2_EXPECTED_BUCKET` | 經人工核對的固定 staging 目標；不得直接複製 Production 設定 |
| secret | `CLOUDFLARE_R2_ACCESS_KEY_ID`、`CLOUDFLARE_R2_SECRET_ACCESS_KEY` | 限定該 staging bucket 的唯讀 R2 credential |

執行前，維護者應從 Cloudflare 管理介面核對預期 account、bucket 和 token scope，確認 bucket 為 staging 專用，且 credential 沒有寫入權限。命名檢查與 `HeadBucket` 只能證明被選中的 bucket 可讀；它們不能獨立證明 Cloudflare account 沒有其他 Production 資源，也不能驗證 token 沒有額外權限。這個工作讀取的是受保護 GitHub Environment 的綁定，不能代替 Vercel 已部署 runtime 的綁定核對。

工作成功後，下載 `staging-provider-binding-<commit>` artifact。收據只保留 provider、結果、資源類別、帶 domain separation 的身分 SHA-256、唯讀請求結果，以及零寫入計數；不保留 credential、bucket/account 原值、provider response 或原始錯誤。`PASS` 表示固定目標檢查和 `HeadBucket` 成功。`BLOCKED` 表示缺少綁定、身分不符，或唯讀權限／連線未成功，不能當成外部服務通過。

Cloudflare Stream 目前標記 `NOT_ATTESTED`。現有設定可與 Production 共用 account，僅憑 account ID、token 存在或一次 Stream GET 無法證明非 Production 隔離，因此此工作不注入 Stream credential，也不呼叫 Stream API。

本機契約測試：`node --test scripts/staging-provider-binding-attestation.test.mjs`。測試使用合成資料和注入的唯讀探針，不會連線到 Cloudflare。
