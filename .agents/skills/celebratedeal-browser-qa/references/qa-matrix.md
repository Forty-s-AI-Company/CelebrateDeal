# Browser QA Matrix

Minimum roles: anonymous, vendor owner, vendor staff, vendor finance role, platform admin with unverified MFA, platform admin with verified MFA.

Minimum states: empty, loading, validation error, authorization error, provider error, success, duplicate request, large list, expired session.

Critical flows:

1. Login, redirect, password reset, MFA setup/verify/recovery.
2. Create product/video/form/script/live and publish preview.
3. Public live playback, referral capture, product click, CTA, lead submission.
4. Server-priced checkout, paid/refund/duplicate webhook fixtures.
5. Vendor billing read-only scope and platform settlement/payout mutations.
6. Cross-tenant resource ID tampering and admin protection.

