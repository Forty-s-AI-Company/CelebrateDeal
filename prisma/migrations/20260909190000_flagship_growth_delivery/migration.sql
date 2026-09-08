ALTER TABLE "TrackingSetting" ADD COLUMN "facebookAccessTokenEncrypted" TEXT;
ALTER TABLE "TrackingSetting" ADD COLUMN "facebookTestEventCode" TEXT;
ALTER TABLE "Product" ADD COLUMN "upsellProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "upsellDiscountCents" INTEGER;
ALTER TABLE "Product" ADD COLUMN "downsellProductId" TEXT;
CREATE INDEX "Product_vendorId_upsellProductId_idx" ON "Product"("vendorId", "upsellProductId");
CREATE INDEX "Product_vendorId_downsellProductId_idx" ON "Product"("vendorId", "downsellProductId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_upsellProductId_fkey" FOREIGN KEY ("vendorId", "upsellProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_downsellProductId_fkey" FOREIGN KEY ("vendorId", "downsellProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CourseLesson" ("id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "productId" TEXT NOT NULL, "chapterTitle" TEXT NOT NULL, "title" TEXT NOT NULL, "videoUrl" TEXT, "durationSeconds" INTEGER NOT NULL DEFAULT 0, "position" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "CourseLesson_vendorId_id_key" ON "CourseLesson"("vendorId", "id");
CREATE UNIQUE INDEX "CourseLesson_vendorId_productId_position_key" ON "CourseLesson"("vendorId", "productId", "position");
CREATE INDEX "CourseLesson_vendorId_productId_idx" ON "CourseLesson"("vendorId", "productId");
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CourseLessonProgress" ("id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "productId" TEXT NOT NULL, "lessonId" TEXT NOT NULL, "customerKeyHash" TEXT NOT NULL, "watchedSeconds" INTEGER NOT NULL DEFAULT 0, "completedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CourseLessonProgress_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "CourseLessonProgress_vendorId_lessonId_customerKeyHash_key" ON "CourseLessonProgress"("vendorId", "lessonId", "customerKeyHash");
CREATE INDEX "CourseLessonProgress_vendorId_productId_customerKeyHash_idx" ON "CourseLessonProgress"("vendorId", "productId", "customerKeyHash");
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_lessonId_fkey" FOREIGN KEY ("vendorId", "lessonId") REFERENCES "CourseLesson"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommunityPost" ("id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "customerKeyHash" TEXT NOT NULL, "authorName" TEXT NOT NULL, "body" TEXT NOT NULL, "isPinned" BOOLEAN NOT NULL DEFAULT false, "isAnnouncement" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "CommunityPost_vendorId_id_key" ON "CommunityPost"("vendorId", "id");
CREATE INDEX "CommunityPost_vendorId_isPinned_createdAt_idx" ON "CommunityPost"("vendorId", "isPinned", "createdAt");
CREATE INDEX "CommunityPost_vendorId_customerKeyHash_createdAt_idx" ON "CommunityPost"("vendorId", "customerKeyHash", "createdAt");
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommunityComment" ("id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "postId" TEXT NOT NULL, "customerKeyHash" TEXT NOT NULL, "authorName" TEXT NOT NULL, "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "CommunityComment_vendorId_id_key" ON "CommunityComment"("vendorId", "id");
CREATE INDEX "CommunityComment_vendorId_postId_createdAt_idx" ON "CommunityComment"("vendorId", "postId", "createdAt");
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_vendorId_postId_fkey" FOREIGN KEY ("vendorId", "postId") REFERENCES "CommunityPost"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommunityReaction" ("id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "postId" TEXT NOT NULL, "customerKeyHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CommunityReaction_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "CommunityReaction_vendorId_postId_customerKeyHash_key" ON "CommunityReaction"("vendorId", "postId", "customerKeyHash");
CREATE INDEX "CommunityReaction_vendorId_postId_idx" ON "CommunityReaction"("vendorId", "postId");
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_vendorId_postId_fkey" FOREIGN KEY ("vendorId", "postId") REFERENCES "CommunityPost"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
