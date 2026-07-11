---
name: celebratedeal-browser-qa
description: Plan and run CelebrateDeal browser QA with Playwright across authentication states, user roles, desktop/tablet/mobile viewports, public live/form flows, admin billing, visual comparison, accessibility, console errors, network failures, traces, screenshots, and videos. Use for UI verification, regression testing, release smoke, Antigravity QA handoff, or bug reproduction.
---

# CelebrateDeal Browser QA

## Workflow

1. Read `docs/qa/TEST_MATRIX.md` and [qa-matrix.md](references/qa-matrix.md).
2. Choose the smallest role, state, viewport, and data fixture matrix that covers the risk.
3. Use deterministic test records and unique prefixes. Never depend on production data.
4. Assert user-visible result, URL/state change, API response, console errors, and failed network requests where relevant.
5. Run accessibility checks and visual snapshots for material UI changes.
6. Retain HTML report, trace, screenshot, and video on failure under ignored report directories.
7. Re-run affected tests after a fix, then full smoke/regression before release.

## Required viewports

- Chromium default.
- Desktop 1440x900.
- Laptop 1280x800.
- Tablet 768x1024.
- Mobile 390x844.

## Output format

Return:

`scenario | role | viewport | data state | result | evidence path | issue ID`

For issues, include severity, reproduction, expected, actual, console/network evidence, screenshot, and suspected ownership without prescribing an unverified fix.

## Prohibitions

- Do not hide console errors, disable assertions, update snapshots blindly, or retry away deterministic failures.
- Do not expose secrets in screenshots, traces, videos, or HTML reports.
- Do not call a third-party sandbox unless explicitly enabled by an environment flag.
- Do not treat an External required failure as a local code pass or fail without diagnosis.

