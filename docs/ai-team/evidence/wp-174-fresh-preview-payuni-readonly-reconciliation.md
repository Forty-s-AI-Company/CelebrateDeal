# WP-174 Fresh Preview PayUni Read-only Reconciliation

本工作包使用 WP-173 已驗收的新 Preview deployment，透過 OS temp 中的 Vercel Preview broker 重用受保護的 WP-170 `--live-child` 契約。它最多執行一次 staging DB read-only transaction／SELECT；只有恰好一筆 synthetic pending reservation 時才允許一次 PayUni 官方 Sandbox transaction lookup。

禁止 DB write／row lock、provider write、payment、refund、callback、redirect、retry、deployment、environment／alias／DNS mutation、Production、Git mutation與 package install。Receipt 僅保存 digest、enum、布林值與計數器，不保存 raw rows、provider response、identifier、URL、連線字串或環境值。

## 執行結果

- 唯一 live execution 已完成，沒有 retry 或 rerun。
- Freshness：新 deployment exact match、Preview／Ready、HEAD 200、no redirect。
- Broker：attempt 1、child result 1、child valid、parent target key count 0、autoload／assignment 均未偵測。
- Primary：`WP174_DATABASE_IDENTITY_EXACT_NO_GO`，normalized failure `PAYUNI_NOT_SANDBOX`；DB connect／transaction／SELECT 皆 0，PayUni query 0。
- Terminal：`WP174_CLEANUP_EXACT_NO_GO`。Primary outcome 在 cleanup 前完整保存，沒有被 terminal cleanup 狀態遮蔽。
- Exact OS temp marker `celebratedeal-wp174-o4vcEp` 仍存在；桌面安全政策拒絕兩次已驗證路徑的 recursive cleanup，未使用其他 shell 繞過。
- Side effects：DB／provider writes、payment、refund、callback、deployment、environment／alias／DNS、Production、Git 與 package install 全為 0。
- Strict report readback、9/9 tests、scoped ESLint、TypeScript、static mutation deny、protected hashes、diff check 與 staged-empty PASS。

Score eligibility 為 false；CAT04 維持 6.0、總分維持 72.0，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。AGY Fast attempt 1 唯讀 QA verdict 為 `PASS`，確認 primary/no-go、零副作用與不加分邊界一致。Sol High acceptance verdict 為 `ACCEPT`：root cause boundary 已縮至 Vercel Preview configuration lineage 到 broker child runtime；WP-174 禁止重跑。
