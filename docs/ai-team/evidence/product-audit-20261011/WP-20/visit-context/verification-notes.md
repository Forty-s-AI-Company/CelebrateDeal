# Public visit context

New server resolver uses canonical publicLiveAvailabilityWhere, getRuntimeLivePublishReadiness and resolveLiveRuntimeWindow. Waiting/playing resolve live mode, replay resolves replay mode, unavailable rejects. Reads database clock; Live then Video then metric-version locks; matches current content fingerprint/duration and exactly one enabled scoped version. Returns only scope/version/lifetime. Selects readiness fields explicitly, never vendor/customer/secret records. Does not create or activate collection. Must be composed in same collector write transaction; no HTTP route activated yet.

Validation targeted context/version tests, scoped lint and full tsc PASS94cd3cf35a2a722aaf9a36a60545b6e43761428ffa2553bf007658e143946559. Initial failures preserved: fixture missing required name/email and incorrectly parameterized array cases; second failure fixture declared ended before future scheduled start. Corrected synthetic fixture chronology, not production gate. Added absent/ambiguous/mismatched version refusal.

Limitations: actual DB integration NOT_RUN for resolver; independent review NOT_RUN. Related form/template/product readiness resource mutations are not locked by this resolver; collector integration must assess transaction consistency. Existing public page gates copied by invoking canonical helpers, no new project publication policy invented. Landing-page/funnel-specific access is outside this live-page resolver. Safe URL consistency with session resolver remains to assess. Still need initial identity consistency, collector/coverage activation, full metrics pipeline.

Rollback: remove two new resolver/test files. No active runtime path or deployment changed.
