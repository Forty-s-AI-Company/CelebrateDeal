# WP-191 — Staging alias rollback and forward-restore rehearsal

## 結果

- 終態：`WP191_RESTORE_NOT_PROVEN`
- Rollback transition：PASS。
- Forward restore command與alias metadata identity：PASS。
- Final latest marker：HTTP 404，未通過；因此 restore完整證據不足。
- CAT09維持`7.0`、總分維持`72.5`，不得關閉staging rollback Gate。

## Historical probe disclosure

原計畫 preflight誤將`/api/health`視為純路由探針；source audit隨即發現它執行Prisma `SELECT 1`。在alias mutation前已發生兩次HEAD，可能對staging DB產生兩次read-only `SELECT 1`。DB write、lock與資料變更均為0。Sol以`CONTINUE_CURRENT_WP`核准改用純`/login` marker；之後health與DB operation均為0。

## Safe probe contract

- `/login` source、CSRF field與CSRF runtime source audit：PASS。
- `loginAction`只作form reference，未在GET render中呼叫。
- 未使用getDb、Prisma、fetch、檔案寫入或cookie mutation。
- HTML、CSRF token、headers、cookies與raw body僅在記憶體檢查後丟棄。

## Rehearsal evidence

- Preflight：current alias精確指向latest；latest與rollback target均為同project、Preview／READY。
- Latest direct WP-187 marker：HTTP 200／MATCH。
- Latest direct login：HTTP 200／marker MATCH。
- Rollback direct login：HTTP 200／marker MATCH。
- Alias mutation 1：latest→rollback target，command PASS。
- Rollback alias identity：精確rollback deployment；login 200／MATCH。
- Alias mutation 2：rollback target→latest，command PASS。
- Final alias metadata：精確latest deployment。
- Final alias login：HTTP 200／MATCH。
- Final alias WP-187 marker：HTTP 404／NO MATCH。

因marker未通過，不能把metadata與共用login route外推成完整forward restore。Mutation budget已用盡，沒有第三次alias mutation或額外probe。

## Deterministic evidence

- State-machine／source tests：7/7 PASS。
- ESLint：PASS，0 warning。
- TypeScript：PASS。
- Strict receipt readback：PASS。
- Diff check與staged-empty：PASS。
- Existing dirty ownership：`PRESERVE_ONLY`；`UNKNOWN=0`、`MIXED_HUNKS=0`。

## Side effects

- Alias mutations：2／2。
- Deployment、environment、DNS、Production、PayUni、Git mutation：0。
- Remediation後DB operation：0。
- Final alias metadata目前指向latest，但route-level marker尚未由本包證明。

## 下一邊界

WP-191不得重跑或追加第三次mutation。下一包若仍處理CAT09，只能是read-only、bounded propagation verification：在等待合理CDN propagation window後，重新確認alias identity、WP-187 marker與login marker；不得再切alias。只有fresh read-only evidence全部通過且Sol接受，才可評估是否完成WP-191留下的restore證據缺口。
