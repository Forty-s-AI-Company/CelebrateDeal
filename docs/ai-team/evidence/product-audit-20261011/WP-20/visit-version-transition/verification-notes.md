# Authenticated version transition during preparation

versionForLive extracts candidate version only inside bounded parser, then verifies full canonical signed proof, vendor/live scope, key and issued time. Only authenticated valid/expired proof returns version. Unknown/retired key, forged, cross-live/vendor, future-issued proof rejected. prepareMetricVisit reads database clock in same transaction and may allocate new identity only when authenticated old version differs from canonical current version. No visit fact emitted; same-version proof still passes through persisted visitor existence/recovery checks. collectPreparedMetricVisit remains strict current-version verification; client pins original prepared version and never retries its event into another.

This permits a new version cohort, not restoration of an old deleted identity. Old-version row existence is not an authorization prerequisite for a public visitor to prepare the new cohort; current public context/version gates still apply. Existing old facts unchanged. Independent review of this distinction NOT_RUN.

Validation targeted proof/collection/client tests, scoped lint and full tsc PASSa4d5d54371f25ba013074f5eec96e2dc2d920ac9c9210028acb9ce5d60808b40. Actual DB transition and browser cookie replacement E2E NOT_RUN. No production/deployment/key setup.

Remaining: browser cookie expiry removes proof before server recovery, long-lived page version transition needs lifecycle reset/new logical event, full HTTPS route+DB integration, durable coverage/gaps, complete metrics pipeline and independent review. Cannot claim WP20 complete.

Rollback: remove versionForLive and preparation transition branch/tests only; old current-version gates remain.
