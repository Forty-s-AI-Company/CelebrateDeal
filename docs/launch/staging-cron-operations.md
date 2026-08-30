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

## Readiness boundary

Until a staging scheduler is selected and a sanitized delivery receipt exists,
staging scheduler readiness remains `PENDING_EXTERNAL` and Production remains
fail-closed `NO_GO`. Do not replace the removed Cron with a daily schedule only
to make a build pass; that would change delivery semantics without an owner
decision.
