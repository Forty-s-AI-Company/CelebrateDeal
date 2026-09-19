-- Fail closed if prelaunch data already violates the tenant/live ownership
-- contract. The constraints below must never legitimize mismatched rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "LiveInteractionResponse" response
    JOIN "LiveInteractionRun" run
      ON run."vendorId" = response."vendorId"
     AND run."id" = response."runId"
    WHERE run."liveId" <> response."liveId"
  ) THEN
    RAISE EXCEPTION 'LiveInteractionResponse run/live ownership mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "LiveInteractionResponse" response
    JOIN "FormSubmission" submission
      ON submission."id" = response."formSubmissionId"
    WHERE response."formSubmissionId" IS NOT NULL
      AND submission."liveId" IS DISTINCT FROM response."liveId"
  ) THEN
    RAISE EXCEPTION 'LiveInteractionResponse registration/live ownership mismatch';
  END IF;
END $$;

CREATE UNIQUE INDEX "LiveInteractionRun_vendorId_liveId_id_key"
  ON "LiveInteractionRun"("vendorId", "liveId", "id");

ALTER TABLE "LiveInteractionResponse"
  ADD CONSTRAINT "LiveInteractionResponse_vendorId_liveId_runId_fkey"
  FOREIGN KEY ("vendorId", "liveId", "runId")
  REFERENCES "LiveInteractionRun"("vendorId", "liveId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the original single-column ON DELETE SET NULL foreign key. It clears
-- formSubmissionId first; this composite guard then prevents cross-live links.
ALTER TABLE "LiveInteractionResponse"
  ADD CONSTRAINT "LiveInteractionResponse_liveId_formSubmissionId_fkey"
  FOREIGN KEY ("liveId", "formSubmissionId")
  REFERENCES "FormSubmission"("liveId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
