---
name: celebratedeal-product-domain
description: Define, implement, or review CelebrateDeal live-commerce product behavior, including courses, events, prerecorded/live rooms, registration, products, official interaction roles, organization promotion, external storefront links, billing, settlements, and payouts. Use for product specs, acceptance criteria, data-model changes, workflow decisions, or cross-module feature work in this repository.
---

# CelebrateDeal Product Domain

## Workflow

1. Read `AGENTS.md` and `docs/ai-team/CURRENT_STATE.md`.
2. Identify actor, tenant, entry point, goal, source of truth, state transitions, failure paths, audit needs, and external dependencies.
3. Read [domain-model.md](references/domain-model.md) when the task crosses roles or modules.
4. Separate product facts from assumptions. Add unresolved but non-blocking choices to `docs/ai-team/ASSUMPTIONS.md`.
5. Define acceptance criteria that can be tested without production credentials.
6. Map each behavior to existing routes, services, Prisma models, events, and tests before adding new abstractions.

## Required distinctions

- Distinguish live, scheduled prerecorded playback, VOD, preview, and published room.
- Distinguish visitor, lead, affiliate click, checkout started, paid conversion, refunded conversion, commission, and payout.
- Treat interaction roles as disclosed official/AI/system representatives, never as hidden human viewers.
- Treat external-store click as click only unless an API, webhook, import, or approved reconciliation proves an order.
- Treat vendor ownership and platform administration as separate scopes.

## Output format

Return or document:

1. Goal and actors.
2. Preconditions and source of truth.
3. Happy path and state transitions.
4. Failure, retry, refund, expiry, and cancellation behavior.
5. Tenant and permission rules.
6. Analytics/audit events.
7. Acceptance tests.
8. Assumptions and External required.

## Prohibitions

- Do not copy competitor code, protected assets, trademarks, or private information architecture.
- Do not invent confirmed orders from clicks.
- Do not let client-provided price, vendor, role, or commission rate become authoritative.
- Do not mark an externally unverified integration production-ready.

