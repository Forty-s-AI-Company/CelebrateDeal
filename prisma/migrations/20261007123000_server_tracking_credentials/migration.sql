-- Add tenant-bound ciphertext and a CAS revision; never persist plaintext tokens.
ALTER TABLE "TrackingSetting"
  ADD COLUMN "facebookAccessTokenEncrypted" TEXT,
  ADD COLUMN "facebookTestEventCode" TEXT,
  ADD COLUMN "credentialRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrackingSetting" ADD CONSTRAINT "TrackingSetting_credentialRevision_nonnegative" CHECK ("credentialRevision" >= 0);
