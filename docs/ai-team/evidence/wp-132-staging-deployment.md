# WP-132 staging deployment evidence

## Result

The current workspace was deployed to the linked non-Production Vercel project `celebrate-deal-staging` and the existing staging hostname was updated to the ready Preview deployment.

- Project: `celebrate-deal-staging` (`prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn`)
- Deployment: `dpl_ChggLsJnxwYDTdv56cg2mdeS1ykc`
- Deployment target: `preview`
- Ready URL: `https://celebrate-deal-staging-6u4igxerg-a25814740s-projects.vercel.app`
- Staging alias: `https://celebrate-deal-staging.carry-digital-nomad.in.net`

## Verification

The exact WP-118 route was probed without credentials or request body capture:

`GET /admin/billing/refund-reconciliation/cms7qhsfs0003l90428n9ezx7`

The staging alias returned `307` with `Location: /login` and matched route `/admin/billing/refund-reconciliation/[id]`. This proves the route is present in the deployed build and is protected by the normal admin login boundary; the prior `404` routing blocker is removed.

## Quality gates

- `npm run lint`: PASS, two existing unused-import warnings in the WP-130 runner and no errors.
- `npm run typecheck`: PASS.
- `npm run build`: PASS locally and on Vercel Preview.
- The build route manifest includes `/admin/billing/refund-reconciliation/[id]`.

## Boundaries and side effects

- No primary `celebrate-deal` Production deployment.
- No DNS change, database migration, payment, refund, callback replay, PayUni query, or staging reconciliation transaction.
- The failed first attempt targeted the staging project's Production environment and stopped at build preflight because required Production environment variables were absent; it did not move the staging alias.
- No `.env*` file, secret, token, cookie, or raw response body was read or saved.
- Full sanitized receipt: `.ai-team/reports/wp132-staging-deployment-receipt.json`.

## Next gate

WP-132 may now resume its already-authorized single PayUni Sandbox provider query and single staging reconciliation transaction, subject to the existing host allowlist, non-Production DB identity proof, exact synthetic order/reference match, and no-retry budgets. CAT04 remains 6.0/10 until that evidence and Sol High acceptance are complete.
