-- Viewer nickname and avatar per live room (owner 2026-11-26).
--
--   * "LiveViewerProfile": one row per viewer per live. The viewer is the
--     SHA-256 of an opaque long-lived profile cookie combined with the live id
--     ("viewerKeyHash"), so the same browser coming back to the same live
--     keeps its nickname, and rows of different lives cannot be linked. The
--     90-second admission session is not used: it is deleted when the viewer
--     leaves.
--   * "normalizedNickname" (NFKC, lower case, no whitespace) is unique per
--     (vendorId, liveId): two viewers racing for the same name are decided by
--     this unique index, not by a read-then-write. Scripted role names and the
--     vendor name are checked by the application in the same request.
--   * "LiveChatMessage"."viewerProfileId": the profile a viewer message was
--     written with. The composite foreign key keeps the profile in the same
--     vendor and live as the message. NO ACTION (checked at the end of the
--     statement) lets a Live or Vendor delete cascade to both tables.
--     "authorName" stays the registration name snapshot, so merchant views
--     and exports do not change.
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
    "normalizedNickname" TEXT NOT NULL,
    "avatarSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveViewerProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LiveViewerProfile_viewerKeyHash_check" CHECK ("viewerKeyHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "LiveViewerProfile_nickname_check" CHECK (
      char_length("nickname") BETWEEN 1 AND 20
      AND "nickname" = btrim("nickname")
    ),
    -- Lower-casing can lengthen a few characters; the application derives it
    -- from "nickname", which is at most 20 characters.
    CONSTRAINT "LiveViewerProfile_normalizedNickname_check" CHECK (
      char_length("normalizedNickname") BETWEEN 1 AND 40
      AND "normalizedNickname" !~ '\s'
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
-- No two viewers of one live share a nickname (case, width and spaces ignored).
CREATE UNIQUE INDEX "LiveViewerProfile_vendorId_liveId_normalizedNickname_key" ON "LiveViewerProfile"("vendorId", "liveId", "normalizedNickname");

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
-- passes; NOT VALID + VALIDATE keeps writes flowing during that scan.
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_viewerProfile_source_check"
  CHECK ("viewerProfileId" IS NULL OR ("source" = 'viewer' AND "roleId" IS NULL)) NOT VALID;
ALTER TABLE "LiveChatMessage" VALIDATE CONSTRAINT "LiveChatMessage_viewerProfile_source_check";

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LiveViewerProfile" ENABLE ROW LEVEL SECURITY;
