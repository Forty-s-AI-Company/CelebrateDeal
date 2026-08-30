# SEC-2026-08-07-03 Fresh dependency audit

時間：2026-08-07（Asia/Taipei）

- `npm audit --audit-level=high --json`：0 info、0 low、0 moderate、0 high、0 critical，總計 0 vulnerabilities；依賴總數 737。
- `npm ls js-yaml --all --json`：`js-yaml` resolved version `4.3.1`，既有 minimal override 仍 active。
- 本包沒有修改 source、package.json、lockfile、coverage threshold、exclude、skip 或 assertion。
- 唯一外部互動是 npm registry audit metadata；未執行 staging、PayUni、Production、付款、退款或寄信，未輸出 raw registry URL、secret 或 token。

這份 audit 不會替代 CAT04 的 staging／PayUni reconciliation，也不會替代 CAT10 的商家、客服、法務、財務與 release owner 真人驗收；CAT04 `6.0`、CAT10 `4.5`、總分 `73.5` 維持不變。

可追溯 machine receipt：`.ai-team/reports/sec-2026-08-07-03-dependency-audit.json`。
