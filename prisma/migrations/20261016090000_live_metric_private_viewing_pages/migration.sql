BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Every join runs under the same private owner and caller RR snapshot. A role
-- that cannot bypass a forced RLS policy fails instead of seeing partial rows.
CREATE FUNCTION public.wp20_metric_playback_intake_page(vendor_id TEXT,live_id TEXT,version_id TEXT,cursor_id TEXT,page_limit INTEGER)
RETURNS TABLE(id TEXT,"issuedAt" TIMESTAMPTZ,"expiresAt" TIMESTAMPTZ,"lossAt" TIMESTAMPTZ,"renewalCount" BIGINT,
 "sessionId" TEXT,"verifiedAt" TIMESTAMPTZ,"closedAt" TIMESTAMPTZ,complete BOOLEAN,"identityCurrent" BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
BEGIN
 IF vendor_id IS NULL OR live_id IS NULL OR version_id IS NULL
  OR vendor_id !~ '^[A-Za-z0-9_-]{1,128}$' OR live_id !~ '^[A-Za-z0-9_-]{1,128}$' OR version_id !~ '^[A-Za-z0-9_-]{1,128}$'
  OR page_limit IS NULL OR page_limit<1 OR page_limit>501 THEN
  RAISE EXCEPTION 'invalid private viewing page scope or bound' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
SELECT i.id,i."issuedAt",i."expiresAt",i."lossAt",i."renewalCount",s.id AS "sessionId",g."verifiedAt",s."closedAt",s.complete,
        coalesce(f."verificationStatus"='VERIFIED' AND f."verifiedAt"=(g."verifiedAt" AT TIME ZONE 'UTC')
          AND f."liveId"=g."liveId" AND f."formId"=l."formId" AND form."vendorId"=g."vendorId",false) AS "identityCurrent"
      FROM public."LiveMetricPlaybackIntake" i
      LEFT JOIN public."LiveMetricSession" s ON s."intakeId"=i.id AND s."vendorId"=i."vendorId" AND s."liveId"=i."liveId"
        AND s."versionId"=i."versionId" AND s."admissionSessionId"=i."admissionSessionId"
      LEFT JOIN public."LiveMetricRegistration" g ON g.id=s."registrationId" AND g."vendorId"=s."vendorId" AND g."liveId"=s."liveId" AND g."versionId"=s."versionId"
      LEFT JOIN public."Live" l ON l.id=i."liveId" AND l."vendorId"=i."vendorId"
      LEFT JOIN public."FormSubmission" f ON f.id=g."submissionId"
      LEFT JOIN public."RegistrationForm" form ON form.id=f."formId"
      WHERE i."vendorId"=vendor_id AND i."liveId"=live_id AND i."versionId"=version_id AND (cursor_id IS NULL OR i.id>cursor_id)
      ORDER BY i.id LIMIT page_limit;
END $$;
CREATE FUNCTION public.wp20_metric_viewing_page(vendor_id TEXT,live_id TEXT,version_id TEXT,scope_start TIMESTAMPTZ,scope_end TIMESTAMPTZ,
 cursor_session TEXT,cursor_sequence INTEGER,page_limit INTEGER)
RETURNS TABLE("sessionId" TEXT,"verifiedAt" TIMESTAMPTZ,"anchorAt" TIMESTAMPTZ,"expiresAt" TIMESTAMPTZ,"closedAt" TIMESTAMPTZ,
 complete BOOLEAN,"lastSequence" INTEGER,"finalSequence" INTEGER,"lastElapsedMs" INTEGER,"identityCurrent" BOOLEAN,
 "intervalId" TEXT,sequence INTEGER,"wallStartAt" TIMESTAMPTZ,"wallEndAt" TIMESTAMPTZ,"mediaStartMs" INTEGER,"mediaEndMs" INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
BEGIN
 IF vendor_id IS NULL OR live_id IS NULL OR version_id IS NULL
  OR vendor_id !~ '^[A-Za-z0-9_-]{1,128}$' OR live_id !~ '^[A-Za-z0-9_-]{1,128}$' OR version_id !~ '^[A-Za-z0-9_-]{1,128}$'
  OR page_limit IS NULL OR page_limit<1 OR page_limit>501 THEN
  RAISE EXCEPTION 'invalid private viewing page scope or bound' USING ERRCODE='22023';
 END IF;
 IF scope_start IS NULL OR scope_end IS NULL OR scope_start>=scope_end
  OR (cursor_session IS NOT NULL AND cursor_sequence IS NULL) THEN
  RAISE EXCEPTION 'invalid private viewing window or cursor' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
SELECT s.id AS "sessionId",g."verifiedAt",s."anchorAt",s."expiresAt",s."closedAt",s.complete,s."lastSequence",s."finalSequence",s."lastElapsedMs",
            coalesce(f."verificationStatus"='VERIFIED' AND f."verifiedAt"=(g."verifiedAt" AT TIME ZONE 'UTC')
              AND f."liveId"=g."liveId" AND f."formId"=l."formId" AND form."vendorId"=g."vendorId",false) AS "identityCurrent",
            i.id AS "intervalId",i.sequence,i."wallStartAt",i."wallEndAt",i."mediaStartMs",i."mediaEndMs"
          FROM public."LiveMetricSession" s
          -- The validated composite Session->Registration FK makes this join
          -- total; deleting the parent cascades to the session. Current source
          -- identity remains LEFT JOINed below, so revocations stay visible.
          JOIN public."LiveMetricRegistration" g ON g.id=s."registrationId" AND g."vendorId"=s."vendorId" AND g."liveId"=s."liveId" AND g."versionId"=s."versionId"
          JOIN public."Live" l ON l.id=s."liveId" AND l."vendorId"=s."vendorId"
          LEFT JOIN public."FormSubmission" f ON f.id=g."submissionId"
          LEFT JOIN public."RegistrationForm" form ON form.id=f."formId"
          LEFT JOIN public."LiveMetricInterval" i ON i."sessionId"=s.id AND i."vendorId"=s."vendorId" AND i."liveId"=s."liveId" AND i."versionId"=s."versionId"
          WHERE s."vendorId"=vendor_id AND s."liveId"=live_id AND s."versionId"=version_id
            AND s."anchorAt"<scope_end AND s."expiresAt">scope_start AND (cursor_session IS NULL OR (s.id,coalesce(i.sequence,-1))>(cursor_session,cursor_sequence))
          ORDER BY s.id,coalesce(i.sequence,-1) LIMIT page_limit;
END $$;
REVOKE ALL ON FUNCTION public.wp20_metric_playback_intake_page(text,text,text,text,integer),public.wp20_metric_viewing_page(text,text,text,timestamptz,timestamptz,text,integer,integer) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_playback_intake_page(text,text,text,text,integer),public.wp20_metric_viewing_page(text,text,text,timestamptz,timestamptz,text,integer,integer) FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid IN ('public.wp20_metric_playback_intake_page(text,text,text,text,integer)'::regprocedure,
   'public.wp20_metric_viewing_page(text,text,text,timestamptz,timestamptz,text,integer,integer)'::regprocedure) AND a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'unexpected private viewing page privileges' USING ERRCODE='23514';
 END IF;
END $$;
COMMIT;
