-- Forward-only, tenant/course-qualified community. Never expose customer hashes
-- in the public feed; the column is used only for ownership and idempotency.
CREATE TABLE "CourseCommunityPost" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "customerKeyHash" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hiddenAt" TIMESTAMP(3),
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CourseCommunityPost_pkey" PRIMARY KEY ("vendorId", "productId", "id"),
  CONSTRAINT "CourseCommunityPost_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product" ("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseCommunityPost_body_length" CHECK (char_length("body") BETWEEN 1 AND 5000),
  CONSTRAINT "CourseCommunityPost_author_length" CHECK (char_length("authorName") BETWEEN 1 AND 60)
);
CREATE INDEX "CourseCommunityPost_vendorId_productId_hiddenAt_createdAt_id_idx" ON "CourseCommunityPost" ("vendorId", "productId", "hiddenAt", "createdAt", "id");
CREATE TABLE "CourseCommunityReply" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "customerKeyHash" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hiddenAt" TIMESTAMP(3),
  CONSTRAINT "CourseCommunityReply_pkey" PRIMARY KEY ("vendorId", "productId", "id"),
  CONSTRAINT "CourseCommunityReply_vendorId_productId_postId_fkey" FOREIGN KEY ("vendorId", "productId", "postId") REFERENCES "CourseCommunityPost" ("vendorId", "productId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseCommunityReply_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000),
  CONSTRAINT "CourseCommunityReply_author_length" CHECK (char_length("authorName") BETWEEN 1 AND 60)
);
CREATE INDEX "CourseCommunityReply_vendorId_productId_postId_createdAt_id_idx" ON "CourseCommunityReply" ("vendorId", "productId", "postId", "createdAt", "id");
CREATE TABLE "CourseCommunityReaction" (
  "vendorId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "customerKeyHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseCommunityReaction_pkey" PRIMARY KEY ("vendorId", "productId", "postId", "customerKeyHash"),
  CONSTRAINT "CourseCommunityReaction_vendorId_productId_postId_fkey" FOREIGN KEY ("vendorId", "productId", "postId") REFERENCES "CourseCommunityPost" ("vendorId", "productId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Server-only repositories enforce purchase rights. Public DB roles receive
-- no policies granting access to discussion content or learner identity hashes.
ALTER TABLE "CourseCommunityPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourseCommunityReply" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourseCommunityReaction" ENABLE ROW LEVEL SECURITY;
