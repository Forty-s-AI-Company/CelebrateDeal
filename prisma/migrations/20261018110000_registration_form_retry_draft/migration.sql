-- Forward-only and additive: a short-lived encrypted retry copy of a rejected
-- native registration POST. It never becomes a FormSubmission and no existing
-- table, column or row changes.
CREATE TABLE "RegistrationFormRetryDraft" (
    "idHash" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationFormRetryDraft_pkey" PRIMARY KEY ("idHash"),
    -- Only the SHA-256 lookup hash of the browser capability is stored.
    CONSTRAINT "RegistrationFormRetryDraft_idHash_check" CHECK ("idHash" ~ '^[a-f0-9]{64}$'),
    -- Canonical (percent-decoded) public registration entry path only: one
    -- or two segments that may contain CJK and other letters, as toSlug()
    -- allows; no query, fragment, host, dot segment, "%", whitespace,
    -- control character or backslash. The application additionally limits
    -- segments to letters, digits, "_" and "-".
    CONSTRAINT "RegistrationFormRetryDraft_sourcePath_check" CHECK (
        char_length("sourcePath") <= 2048
        AND "sourcePath" ~ '^/(form|p|lp)/[^/?#%.\\[:space:][:cntrl:]]+(/[^/?#%.\\[:space:][:cntrl:]]+)?$'
    ),
    -- Ciphertext envelope only, bounded like the application reader.
    CONSTRAINT "RegistrationFormRetryDraft_payload_check" CHECK (
        "encryptedPayload" ~ '^v1\.' AND char_length("encryptedPayload") <= 533400
    ),
    -- Short-lived by construction: at most the 10-minute application TTL.
    CONSTRAINT "RegistrationFormRetryDraft_expiry_check" CHECK (
        "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '10 minutes'
    )
);

CREATE INDEX "RegistrationFormRetryDraft_expiresAt_idx" ON "RegistrationFormRetryDraft"("expiresAt");
CREATE INDEX "RegistrationFormRetryDraft_vendorId_expiresAt_idx" ON "RegistrationFormRetryDraft"("vendorId", "expiresAt");
CREATE INDEX "RegistrationFormRetryDraft_vendorId_formId_idx" ON "RegistrationFormRetryDraft"("vendorId", "formId");

-- The draft belongs to exactly the tenant that owns the form and is deleted
-- with the form (and therefore with the vendor).
ALTER TABLE "RegistrationFormRetryDraft"
    ADD CONSTRAINT "RegistrationFormRetryDraft_vendorId_formId_fkey"
    FOREIGN KEY ("vendorId", "formId") REFERENCES "RegistrationForm"("vendorId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationFormRetryDraft" ENABLE ROW LEVEL SECURITY;
