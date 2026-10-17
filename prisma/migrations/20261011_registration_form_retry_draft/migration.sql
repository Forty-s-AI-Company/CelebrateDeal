-- Additive only: retry drafts remain separate from confirmed submissions.
CREATE TABLE "RegistrationFormRetryDraft" (
    "idHash" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationFormRetryDraft_pkey" PRIMARY KEY ("idHash")
);
CREATE INDEX "RegistrationFormRetryDraft_expiresAt_idx" ON "RegistrationFormRetryDraft"("expiresAt");
