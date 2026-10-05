-- CreateTable
CREATE TABLE "CourseLesson" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "chapterTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "videoUrl" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonProgress" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseLesson_vendorId_productId_publishedAt_idx" ON "CourseLesson"("vendorId", "productId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_vendorId_id_key" ON "CourseLesson"("vendorId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_vendorId_productId_id_key" ON "CourseLesson"("vendorId", "productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_vendorId_productId_position_key" ON "CourseLesson"("vendorId", "productId", "position");

-- CreateIndex
CREATE INDEX "CourseLessonProgress_vendorId_productId_customerKeyHash_idx" ON "CourseLessonProgress"("vendorId", "productId", "customerKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonProgress_vendorId_lessonId_customerKeyHash_key" ON "CourseLessonProgress"("vendorId", "lessonId", "customerKeyHash");

-- AddForeignKey
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_productId_lessonId_fkey" FOREIGN KEY ("vendorId", "productId", "lessonId") REFERENCES "CourseLesson"("vendorId", "productId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep invalid clocks and unbounded curriculum data out of the durable store.
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_duration_bounds" CHECK ("durationSeconds" BETWEEN 0 AND 86400);
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_title_bounds" CHECK (length(btrim("title")) BETWEEN 1 AND 180 AND length(btrim("chapterTitle")) BETWEEN 1 AND 120);
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_video_bounds" CHECK ("videoUrl" IS NULL OR length("videoUrl") BETWEEN 1 AND 2048);
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_seconds_bounds" CHECK ("watchedSeconds" BETWEEN 0 AND 86400);
ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_identity_bounds" CHECK (length("customerKeyHash") BETWEEN 1 AND 256);

-- Access is through the authenticated server repository; no public policies.
ALTER TABLE "CourseLesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourseLessonProgress" ENABLE ROW LEVEL SECURITY;
