-- Viewer nickname and avatar per live room (owner 2026-11-26).
--
--   * "LiveViewerProfile": one row per viewer per live. The viewer is the
--     SHA-256 of an opaque long-lived profile cookie combined with the live id
--     ("viewerKeyHash"), so the same browser coming back to the same live
--     keeps its nickname, and rows of different lives cannot be linked. The
--     90-second admission session is not used as the identity: it is deleted
--     when the viewer leaves.
--   * "normalizedNickname" (NFKC, lower case, no whitespace) is unique per
--     (vendorId, liveId): two viewers racing for the same name are decided by
--     this unique index, not by a read-then-write. A profile idle for 7 days
--     ("lastActiveAt") stops holding its name: the next viewer who asks for
--     that name first sets the idle row's "normalizedNickname" to NULL
--     (PostgreSQL unique indexes treat NULLs as distinct), and a NULL row is
--     never shown. Scripted role names, the vendor name and recent chat
--     authors without a nickname are checked by the application.
--   * "createdBySessionHash": the admission session's token hash that created
--     the row; the application allows at most 3 new profiles per admission
--     session and live.
--   * "LiveChatMessage"."viewerProfileId": the profile a viewer message was
--     written with. The composite foreign key keeps the profile in the same
--     vendor and live as the message. NO ACTION (checked at the end of the
--     statement) lets a Live or Vendor delete cascade to both tables.
--     "authorName" stays the registration name snapshot, so merchant views
--     do not change.
--
-- Locks: ALTER TABLE "LiveChatMessage" (ADD COLUMN, ADD CONSTRAINT CHECK,
-- ADD FOREIGN KEY) takes ACCESS EXCLUSIVE on "LiveChatMessage" until COMMIT,
-- so chat reads and writes wait for the whole migration, including the
-- CHECK validation scan and the CREATE INDEX on that table. lock_timeout 5s
-- bounds the wait to acquire it; the scans are proportional to the number of
-- chat rows.
--
-- Forward-only and additive: one new table, one nullable column, no existing
-- row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "LiveViewerProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "viewerKeyHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "normalizedNickname" TEXT,
    "avatarSeed" TEXT NOT NULL,
    "createdBySessionHash" TEXT NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveViewerProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LiveViewerProfile_viewerKeyHash_check" CHECK ("viewerKeyHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "LiveViewerProfile_createdBySessionHash_check" CHECK ("createdBySessionHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "LiveViewerProfile_nickname_check" CHECK (
      char_length("nickname") BETWEEN 1 AND 20
      AND "nickname" = btrim("nickname")
    ),
    -- Lower-casing can lengthen a few characters; the application derives it
    -- from "nickname", which is at most 20 characters. NULL = released.
    CONSTRAINT "LiveViewerProfile_normalizedNickname_check" CHECK (
      "normalizedNickname" IS NULL
      OR (char_length("normalizedNickname") BETWEEN 1 AND 40 AND "normalizedNickname" !~ '\s')
    ),
    -- The 20 preset seeds (src/lib/interaction-role.ts); never a URL.
    CONSTRAINT "LiveViewerProfile_avatarSeed_check" CHECK ("avatarSeed" ~ '^[a-z]+-[a-z]+$')
);

-- AlterTable
ALTER TABLE "LiveChatMessage" ADD COLUMN "viewerProfileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LiveViewerProfile_vendorId_liveId_id_key" ON "LiveViewerProfile"("vendorId", "liveId", "id");

-- CreateIndex
-- One profile per viewer per live; also the lookup by profile cookie.
CREATE UNIQUE INDEX "LiveViewerProfile_vendorId_liveId_viewerKeyHash_key" ON "LiveViewerProfile"("vendorId", "liveId", "viewerKeyHash");

-- CreateIndex
-- No two active viewers of one live share a nickname (case, width and spaces
-- ignored); released rows (NULL) do not take part.
CREATE UNIQUE INDEX "LiveViewerProfile_vendorId_liveId_normalizedNickname_key" ON "LiveViewerProfile"("vendorId", "liveId", "normalizedNickname");

-- CreateIndex
-- The 3-profiles-per-admission-session count.
CREATE INDEX "LiveViewerProfile_vendorId_liveId_createdBySessionHash_idx" ON "LiveViewerProfile"("vendorId", "liveId", "createdBySessionHash");

-- CreateIndex
-- The retention sweep (src/lib/data-retention.ts).
CREATE INDEX "LiveViewerProfile_lastActiveAt_idx" ON "LiveViewerProfile"("lastActiveAt");

-- CreateIndex
-- Only non-null rows matter; keeps the NO ACTION check on profile delete cheap.
CREATE INDEX "LiveChatMessage_viewerProfileId_idx" ON "LiveChatMessage"("viewerProfileId");

-- AddForeignKey
ALTER TABLE "LiveViewerProfile" ADD CONSTRAINT "LiveViewerProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveViewerProfile" ADD CONSTRAINT "LiveViewerProfile_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_vendorId_liveId_viewerProfileId_fkey" FOREIGN KEY ("vendorId", "liveId", "viewerProfileId") REFERENCES "LiveViewerProfile"("vendorId", "liveId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Only a real viewer message carries a nickname profile (never a scripted
-- role or staff row). Every existing row has NULL, so the validation scan
-- passes. It runs under the ACCESS EXCLUSIVE lock taken above.
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_viewerProfile_source_check"
  CHECK ("viewerProfileId" IS NULL OR ("source" = 'viewer' AND "roleId" IS NULL));

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LiveViewerProfile" ENABLE ROW LEVEL SECURITY;
