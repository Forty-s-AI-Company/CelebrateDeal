---
name: celebratedeal-multi-tenant-security
description: Implement or review CelebrateDeal tenant isolation, RBAC, ownership, PostgreSQL RLS, Prisma queries, Server Actions, API authorization, admin boundaries, and cross-tenant regression tests. Use whenever code reads or mutates vendor-owned data, connects related records, changes roles, exposes admin or billing data, or modifies authentication and session behavior.
---

# CelebrateDeal Multi-Tenant Security

## Workflow

1. Identify the authenticated user, active membership, current vendor, platform role, and required capability.
2. Read [tenancy-matrix.md](references/tenancy-matrix.md).
3. Trace every ID from input to query. Never infer ownership from UI visibility.
4. Scope reads and writes with a compound ownership predicate or verify ownership before relation connect.
5. Keep platform-admin routes distinct from vendor finance routes.
6. Add a negative test using a second vendor for every new sensitive read, mutation, export, or relation.
7. For schema changes, evaluate tenant key, foreign key, unique constraint, index, RLS policy, migration, and rollback.

## Required evidence

- Authorization guard used.
- Tenant predicate used at the final database operation.
- Related resource ownership verified.
- Platform-only operation cannot be reached by vendor roles.
- Cross-tenant test returns not-found or forbidden without leaking existence.
- Audit log exists for security, finance, role, and ownership changes.

## Output format

Return findings or implementation notes as:

`severity | actor | target | missing/verified control | evidence | test`

## Prohibitions

- Do not trust vendorId, userId, role, resource IDs, or ownership claims from the client.
- Do not use UI hiding as authorization.
- Do not query globally and filter in memory.
- Do not expose another tenant's existence through distinct errors.
- Do not weaken guards to simplify tests.

