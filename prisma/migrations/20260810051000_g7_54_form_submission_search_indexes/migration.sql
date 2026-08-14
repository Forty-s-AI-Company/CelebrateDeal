-- G7-54 uses case-insensitive contains search across three contact fields.
-- Trigram GIN indexes let PostgreSQL combine each candidate set with the
-- existing form/status indexes instead of scanning every submission row.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "FormSubmission_name_trgm_idx"
  ON "FormSubmission" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "FormSubmission_email_trgm_idx"
  ON "FormSubmission" USING GIN ("email" gin_trgm_ops);

CREATE INDEX "FormSubmission_phone_trgm_idx"
  ON "FormSubmission" USING GIN ("phone" gin_trgm_ops);
