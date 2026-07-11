# Dual CLI Current State

```json
{
  "generatedAt": "2026-07-11T13:48:34.917812+00:00",
  "git": {
    "command": [
      "git",
      "status",
      "--short"
    ],
    "status": "passed",
    "exitCode": 0,
    "stdout": " M .env.example\n M .env.production.example\n M .env.staging.example\n M .github/workflows/ci.yml\n M docs/external-service-validation-report.md\n M docs/external-service-validation-runbook.md\n M docs/live-commerce-mvp-report.md\n M docs/payuni-sandbox-checkout-runbook.md\n M docs/production-database-runbook.md\n M docs/production-go-live-checklist.md\n M docs/production-readiness-review.md\n M playwright.config.ts\n M prisma/schema.prisma\n M prisma/seed.ts\n M scripts/external-smoke.ts\n M src/app/(app)/affiliates/page.tsx\n M src/app/(app)/billing/payouts/page.tsx\n M src/app/(app)/billing/plans/page.tsx\n M src/app/(app)/billing/usage/page.tsx\n M src/app/(app)/lives/[id]/edit/page.tsx\n M src/app/(app)/lives/new/page.tsx\n M src/app/(app)/messages/templates/[id]/edit/page.tsx\n M src/app/(app)/messages/templates/new/page.tsx\n M src/app/(app)/messages/templates/page.tsx\n M src/app/(app)/products/[id]/edit/page.tsx\n M src/app/(app)/products/new/page.tsx\n M src/app/(app)/products/page.tsx\n M src/app/(app)/settings/security/page.tsx\n M src/app/(app)/settings/tracking/page.tsx\n M src/app/(app)/videos/[id]/edit/page.tsx\n M src/app/(app)/videos/new/page.tsx\n M src/app/(app)/videos/page.tsx\n M src/app/actions.ts\n M src/app/admin/billing/dashboard/page.tsx\n M src/app/admin/billing/payouts/[id]/csv/route.ts\n M src/app/admin/billing/payouts/page.tsx\n M src/app/admin/billing/settlements/page.tsx\n M src/app/admin/billing/webhooks/[id]/page.tsx\n M src/app/admin/billing/webhooks/page.tsx\n M src/app/admin/cloudflare/videos/page.tsx\n M src/app/admin/layout.tsx\n M src/app/api/affiliate-clicks/route.ts\n M src/app/api/cloudflare/direct-upload/route.ts\n M src/app/api/cloudflare/live-inputs/route.ts\n M src/app/api/form-submissions/route.ts\n M src/app/api/payments/checkout/route.ts\n M src/app/api/webhooks/payments/route.ts\n M src/app/globals.css\n M src/app/live/[slug]/page.tsx\n M src/app/login/page.tsx\n M src/app/mfa/verify/page.tsx\n M src/components/app-shell.tsx\n M src/components/live-playback.tsx\n M src/components/product-form.tsx\n M src/components/ui.tsx\n M src/components/video-form.tsx\n M src/lib/audit.ts\n M src/lib/auth.ts\n M src/lib/billing.ts\n M src/lib/cloudflare-ops.ts\n M src/lib/email.ts\n M src/lib/env.ts\n M src/lib/mfa.ts\n M src/lib/payment-providers/demo.ts\n M src/lib/payment-providers/index.ts\n M src/lib/payment-providers/payuni.test.ts\n M src/lib/payment-providers/payuni.ts\n M src/lib/payment-webhooks.test.ts\n M src/lib/payment-webhooks.ts\n M src/lib/rate-limit.test.ts\n M src/lib/rate-limit.ts\n M src/lib/webhook-retry.ts\n M tests/e2e/smoke.spec.ts\n?? .github/workflows/staging-release-gate.yml\n?? BLOCKERS.md\n?? docs/ai-team/AI_TEAM_BOOTSTRAP_REPORT.md\n?? docs/ai-team/AUTONOMOUS_DELIVERY_REPORT.md\n?? docs/ai-team/CLI_CAPABILITY_REPORT.md\n?? docs/ai-team/CURRENT_STATE.md\n?? docs/ai-team/DUAL_CLI_CURRENT_STATE.md\n?? docs/database/\n?? docs/design/\n?? docs/product/\n?? docs/qa/\n?? prisma/migrations/20260710170000_payment_ledger_idempotency/\n?? prisma/migrations/20260710171500_payout_settlement_uniqueness/\n?? prisma/migrations/20260710210000_workspace_invitation_onboarding/\n?? prisma/migrations/20260710213000_legacy_commission_identity/\n?? prisma/migrations/20260710220000_external_storefront_vertical_slice/\n?? prisma/migrations/20260711021000_notification_outbox/\n?? prisma/migrations/20260711022500_external_storefront_tenant_fks/\n?? prisma/migrations/20260711030000_course_vertical_slice/\n?? prisma/migrations/20260711033000_notification_abuse_quota/\n?? prisma/migrations/20260711040000_attribution_lead_conversion_semantics/\n?? prisma/migrations/20260711050000_attribution_policy_settings/\n?? prisma/migrations/20260711053000_affiliate_payout_ledger/\n?? prisma/migrations/20260711060000_financial_integrity_hardening/\n?? prisma/migrations/20260711063000_payment_booking_period/\n?? prisma/migrations/20260711064500_settlement_carry_ledger/\n?? prisma/migrations/20260711065500_fee_refund_caps_and_legacy_preflight/\n?? prisma/migrations/20260711070000_refund_counter_trigger/\n?? prisma/migrations/20260711071000_refund_counter_status_semantics/\n?? prisma/migrations/20260711072000_historical_fee_snapshot_preflight/\n?? prisma/migrations/20260711073000_refund_record_tenant_fk/\n?? qa-issues.json\n?? reports/README.md\n?? reports/ai-team-qa/ADAPTER_AND_IMPORTER_TEST.md\n?? reports/ai-team-qa/AI_TEAM_CURRENT_STATE.md\n?? reports/ai-team-qa/CLI_VERIFICATION.md\n?? reports/ai-team-qa/FINAL_DELIVERY.md\n?? reports/ai-team-qa/HANDOFF_SMOKE_TEST.md\n?? reports/ai-team-qa/PIPELINE_GUARDRAILS_TEST.md\n?? reports/ai-team-qa/ROLE_COVERAGE_MATRIX.md\n?? reports/ai-team-qa/ROLE_ROUTING_TEST.md\n?? reports/ai-team-qa/SECURITY_AUDIT.md\n?? reports/ai-team-qa/boundary_qa.json\n?? reports/ai-team/CLI_CAPABILITY_REPORT.md\n?? reports/ai-team/DUAL_CLI_UPGRADE_REPORT.md\n?? reports/ai-team/QA_REPAIR_DISPOSITION.md\n?? reports/ai-team/ROLE_HANDOFF_SMOKE_TEST.md\n?? reports/ai-team/ROLE_REGISTRY_REPORT.md\n?? reports/antigravity/\n?? reports/screenshots/\n?? reports/traces/\n?? reports/videos/\n?? scripts/lighthouse.mjs\n?? src/app/(app)/affiliates/external-orders/\n?? src/app/(app)/affiliates/links/\n?? src/app/(app)/courses/\n?? src/app/(app)/messages/deliveries/\n?? src/app/(app)/onboarding/\n?? src/app/(app)/settings/team/\n?? src/app/admin/billing/affiliate-payouts/\n?? src/app/admin/billing/external-orders/\n?? src/app/api/course-enrollments/\n?? src/app/api/jobs/notifications/\n?? src/app/api/videos/\n?? src/app/api/webhooks/payments/route.test.ts\n?? src/app/course/\n?? src/app/invite/\n?? src/components/course-conversion-panel.tsx\n?? src/components/course-form.tsx\n?? src/components/direct-video-upload.tsx\n?? src/lib/affiliate-payouts.test.ts\n?? src/lib/affiliate-payouts.ts\n?? src/lib/attribution.integration.test.ts\n?? src/lib/attribution.test.ts\n?? src/lib/attribution.ts\n?? src/lib/billing.test.ts\n?? src/lib/cloudflare-ops.test.ts\n?? src/lib/courses.test.ts\n?? src/lib/courses.ts\n?? src/lib/entitlements.test.ts\n?? src/lib/entitlements.ts\n?? src/lib/env.test.ts\n?? src/lib/external-storefront.test.ts\n?? src/lib/external-storefront.ts\n?? src/lib/financial-data.test.ts\n?? src/lib/financial-data.ts\n?? src/lib/invitation.test.ts\n?? src/lib/invitation.ts\n?? src/lib/live-publication.test.ts\n?? src/lib/live-publication.ts\n?? src/lib/notifications.test.ts\n?? src/lib/notifications.ts\n?? src/lib/payment-providers/index.test.ts\n?? src/lib/platform-authorization.test.ts\n?? src/lib/platform-authorization.ts\n?? src/lib/safe-commerce-url.test.ts\n?? src/lib/safe-commerce-url.ts\n?? src/lib/settlement-operations.test.ts\n?? src/lib/settlement-operations.ts\n?? src/lib/vendor-capabilities.test.ts\n?? src/lib/vendor-capabilities.ts\n?? src/lib/vendor-payout-authorization.test.ts\n?? src/lib/vendor-relations.test.ts\n?? src/lib/vendor-relations.ts\n?? src/lib/workspace.test.ts\n?? src/lib/workspace.ts\n?? tests/e2e/accessibility.spec.ts\n?? tests/e2e/comprehensive-qa.spec.ts\n?? tests/e2e/staging.spec.ts\n?? tests/visual/\n",
    "stderr": "",
    "startedAt": "2026-07-11T13:48:34.849587+00:00",
    "finishedAt": "2026-07-11T13:48:34.908812+00:00"
  },
  "inventory": {
    "codexAgents": 11,
    "skills": 9,
    "qaSources": [
      "reports\\antigravity\\QA_LATEST.md",
      "reports\\antigravity\\qa-issues.json",
      "qa-issues.json"
    ],
    "automationFiles": 78
  },
  "capabilities": {
    "generatedAt": "2026-07-11T13:48:34.917812+00:00",
    "codex": {
      "provider": "codex",
      "executable": "C:\\nvm4w\\nodejs\\codex.CMD",
      "available": true,
      "mode": "full-auto",
      "version": "codex-cli 0.144.1",
      "features": [
        "noninteractive",
        "stdin",
        "cwd",
        "sandbox",
        "jsonl",
        "output_schema",
        "ephemeral"
      ],
      "models": [],
      "notes": []
    },
    "antigravity": {
      "provider": "antigravity",
      "executable": "C:\\Users\\eden\\AppData\\Local\\agy\\bin\\agy.EXE",
      "available": true,
      "mode": "full-auto",
      "version": null,
      "features": [
        "noninteractive",
        "timeout",
        "model",
        "sandbox",
        "conversation",
        "log_file"
      ],
      "models": [
        "Gemini 3.5 Flash (Medium)",
        "Gemini 3.5 Flash (High)",
        "Gemini 3.5 Flash (Low)",
        "Gemini 3.1 Pro (Low)",
        "Gemini 3.1 Pro (High)",
        "Claude Sonnet 4.6 (Thinking)",
        "Claude Opus 4.6 (Thinking)",
        "GPT-OSS 120B (Medium)"
      ],
      "notes": [
        "No machine-readable output schema flag; JSON output is prompt-enforced and validated after execution."
      ]
    }
  }
}
```
