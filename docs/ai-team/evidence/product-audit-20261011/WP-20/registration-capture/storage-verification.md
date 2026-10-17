# Initial registration capture storage

IN_PROGRESS, not accepted. Added LiveMetricRegistrationCapture schema and migration with scoped version/submission/nullable visitor relations, DB-owned timestamp, immutable update guard, parent-only deletion, truncate rejection, default-deny RLS and revoked public/API-role privileges. Visitor deletion uses NO ACTION, consistent with existing registration relation; no identity cascade erases provenance. Application capture/materialization integration remains NOT_IMPLEMENTED.

Validation revision sha256:e5e5a6d4240a73994195afdbcba69b983c9b0b3d42b23cc471f339f9f8037ab2: disposable PostgreSQL 136 checks PASS, 100 migrations PASS, runner lint PASS, container/temp cleanup PASS. New cases verify foreign tenant/visitor rejection, verified-source rejection, immutable update/delete/truncate rejection, unknown visitor storage in a rolled-back transaction, submission-parent deletion, and atomic rollback. Existing nine metric-table RLS assertion and scoped DDL rollback expanded to include capture.

Initial run failed existing UTC function-config assertion because no-truncate function omitted TimeZone=UTC; fixed function configuration, same assertion retained. Original receipt retained. Earlier unrelated browser intermittent failure remains unconfirmed; this passing suite does not prove its cause fixed.

Changed files: prisma/schema.prisma; prisma/migrations/20261015100000_live_metric_registration_capture/migration.sql; scripts/wp20-metric-persistence-disposable.mjs; registration-capture evidence; handoff and goal checkpoint. No service file created in this step despite broader planned scope.

Independent Auth/Migration review NOT_RUN. Public form and verification wiring, complete denominator reconciliation, durable coverage, report pipeline/UI and remote E2E remain incomplete. No root Prisma generation or dotenv reads. No deployment/push; only independent worktree and disposable synthetic DB.

Rollback: remove this additive capture model/relations, migration and scoped runner cases only; preserve previous metric work. Disposable database already removed; no deployed schema to reverse. Root sole writer depth0 dispatch0 automatic_spawn=false; ai-team-pro requested/effective; model recommendation in route-storage.json, observed implementation unknown.
