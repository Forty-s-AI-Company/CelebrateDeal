# Staging Cron Operations

## Scope

This branch's Vercel Preview deployment intentionally does not register a
`vercel.json` Cron. The staging project runs on Vercel Hobby, which rejects the
previous one-minute schedule during deployment validation.

This is a staging-only deployment choice. It does not prove that Production
job scheduling, Email delivery, provider delivery, retry monitoring, or human
operations are ready.

## Job boundary

`/api/jobs/email-deliveries` remains available with two separate authorization
boundaries:

- `GET` requires the dedicated `CRON_SECRET` and is reserved for an approved
  scheduler, including a future Production Vercel Cron if that path is
  explicitly approved.
- `POST` requires `JOB_SECRET` and is reserved for a controlled staging job
  runner or manual operations path.

The job runner must obtain credentials from the approved secret manager at
runtime. Secret values, request headers, customer data, and delivery payloads
must not be written to this repository, evidence, or chat.

## Staging scheduler (2026-10-19, F-042)

The staging scheduler is now `.github/workflows/scheduled-jobs.yml`, a
protected-`master` GitHub Actions schedule that calls every schedulable job
through its `POST` + `JOB_SECRET` entry. Vercel Cron cannot drive staging at
all: Vercel invokes crons only on Production deployments, and the staging alias
serves a Preview deployment. Endpoint inventory, verification, pausing, and the
`JOB_SECRET`／`CRON_SECRET` split are in
[`scheduled-jobs-runbook.md`](./scheduled-jobs-runbook.md).

## Readiness boundary

Until the scheduled workflow has run on `master` and a sanitized invocation
receipt (Actions run lines plus matching Vercel log entries) exists, staging
scheduler readiness remains `PENDING_EXTERNAL` and Production remains
fail-closed `NO_GO`. Do not replace the removed Cron with a daily schedule only
to make a build pass; that would change delivery semantics without an owner
decision.
