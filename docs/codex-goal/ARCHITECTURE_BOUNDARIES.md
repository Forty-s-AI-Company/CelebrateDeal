# CelebrateDeal Architecture Boundaries

最後更新：2026-07-25 20:55（Asia/Taipei）

## 現況

| 指標 | 數量／結果 |
|---|---:|
| Production source files | 187 |
| `src/lib` source files | 61 |
| `src/app/api` route handlers | 26 |
| 全 route contract registry | 31/31 |
| `src/app/actions.ts` | 2,272 lines／42 exports |
| Domain lib → app/components runtime imports | 0 |
| API route → browser component runtime imports | 0 |
| `src` runtime import cycles | 0 |

## 允許的依賴方向

```text
Next pages/layouts ─┬─> components ──> app actions / domain lib
                   ├─> app actions ──> domain lib ──> Prisma/provider adapters
                   └─> API routes  ──> domain lib ──> Prisma/provider adapters

scripts/tests ────────────────────────> any layer under test
```

規則：

1. `src/lib/**` 不得 runtime import `src/app/**` 或 `src/components/**`。
2. `src/app/api/**/route.ts` 不得 runtime import browser components。
3. `src/**` 不得形成 runtime import cycle。
4. Components 可 import Server Actions；這是現行 Next App Router 表單邊界，不視為反向 domain dependency。
5. Tests 可跨層 import route handlers，因其目的是 contract/integration 驗證。

## 可執行防回歸

`scripts/architecture-boundaries.test.ts` 使用 TypeScript AST 解析 runtime imports，並驗證：

- domain layer independence；
- API/UI boundary；
- runtime cycle；
- legacy root action module debt ceiling。

目前 4/4 通過，且包含 complexity/function-size ratchets 的全倉 ESLint／typecheck 通過。

## 已確認的架構債

### Complexity ratchet

Production functions 的預設上限為 cyclomatic complexity 30、單函式 300 行。首次全倉量測辨識出下列既有熱點，均以「目前值」建立 file-specific ceiling；任何增加都會讓 `npm run lint` 失敗：

| 熱點 | Ceiling | 改善方向 |
|---|---:|---|
| payment webhook transaction | complexity 61 | 拆 validation、lookup、ledger transition |
| team funnel access decision | complexity 57 | 拆 role／ownership predicates |
| production env report | complexity 53 | 用 declarative rule registry |
| form submission POST | complexity 47 | 拆 request、identity、persistence stages |
| public page preparation | complexity 32 | 拆 content／product resolution |
| dynamic field resolution | complexity 31 | 用 allowlisted resolver map |
| interaction script form | 312 lines/function | 拆 timeline editor/view state |
| live playback | 302 lines/function | 拆 player、commerce、interaction panels |

這些 ceiling 是防回歸 ratchet，不代表現況已理想。Tests 不納入 production function-size rule。

### A-001：Root Server Actions surface 過大

- `src/app/actions.ts` 目前 2,272 lines／42 exports。
- 風險：review surface 大、domain ownership 模糊、單檔衝突機率高。
- 現行保護：2,300-line debt ceiling；新增 domain action 應放入 `src/app/actions/*`。
- 建議拆分順序：
  1. auth/MFA/password reset；
  2. billing/payment operational actions；
  3. live/product/form CRUD；
  4. shared authorization and validation 留在 `src/lib`。
- 本輪不做大規模搬移：現有 857 tests 與 35 E2E 全綠，為分數重構 2,272 行會增加不必要 release risk。

### A-002：部分 components 直接 import root actions

- 這是可用的 App Router pattern，但使 UI 與大型 root action surface 耦合。
- 待 A-001 拆分時，components 應改 import domain-specific action modules。
- 不需要先建立額外 client API layer。

### A-003：Background job ownership

- webhook retry 已有獨立 job route、atomic claim 與 `JOB_SECRET` boundary。
- 其他外部 smoke routes 位於 admin ops namespace，不能被當成一般 background jobs。
- 未發現額外隱藏 scheduler；Production 排程屬 Manual Exception。

## 結論

基礎分層方向健康，且沒有 runtime cycle／domain-to-UI 反向依賴；主要債務集中在大型 root Server Actions。現階段最安全策略是以 executable boundary gate 防止惡化，再以小批 domain extraction 逐步拆分，不進行一次性大重構。
