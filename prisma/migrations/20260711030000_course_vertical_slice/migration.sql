CREATE UNIQUE INDEX "Video_id_vendorId_key" ON "Video"("id", "vendorId");
CREATE UNIQUE INDEX "RegistrationForm_id_vendorId_key" ON "RegistrationForm"("id", "vendorId");
CREATE UNIQUE INDEX "Live_id_vendorId_key" ON "Live"("id", "vendorId");

CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "registrationFormId" TEXT,
  "defaultProductId" TEXT,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "coverImageUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Course_status_valid" CHECK ("status" IN ('draft', 'published', 'archived')),
  CONSTRAINT "Course_publication_valid" CHECK (("status" = 'published' AND "publishedAt" IS NOT NULL) OR "status" <> 'published')
);

CREATE TABLE "CourseLesson" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "videoId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "isPreview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseLesson_status_valid" CHECK ("status" IN ('draft', 'published')),
  CONSTRAINT "CourseLesson_sort_order_nonnegative" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "CourseSession" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "liveId" TEXT,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "capacity" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseSession_status_valid" CHECK ("status" IN ('scheduled', 'live', 'ended', 'canceled')),
  CONSTRAINT "CourseSession_time_valid" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt"),
  CONSTRAINT "CourseSession_capacity_valid" CHECK ("capacity" IS NULL OR "capacity" > 0)
);

CREATE TABLE "Enrollment" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sessionId" TEXT,
  "affiliateId" TEXT,
  "attributionClickId" TEXT,
  "referralCode" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "source" TEXT NOT NULL DEFAULT 'course_page',
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Enrollment_email_not_blank" CHECK (btrim("email") <> ''),
  CONSTRAINT "Enrollment_status_valid" CHECK ("status" IN ('confirmed', 'canceled', 'completed')),
  CONSTRAINT "Enrollment_cancel_state_valid" CHECK (("status" = 'canceled' AND "canceledAt" IS NOT NULL) OR ("status" <> 'canceled' AND "canceledAt" IS NULL))
);

CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");
CREATE UNIQUE INDEX "Course_id_vendorId_key" ON "Course"("id", "vendorId");
CREATE INDEX "Course_vendorId_status_createdAt_idx" ON "Course"("vendorId", "status", "createdAt");
CREATE UNIQUE INDEX "CourseLesson_courseId_sortOrder_key" ON "CourseLesson"("courseId", "sortOrder");
CREATE UNIQUE INDEX "CourseLesson_id_vendorId_key" ON "CourseLesson"("id", "vendorId");
CREATE INDEX "CourseLesson_vendorId_status_idx" ON "CourseLesson"("vendorId", "status");
CREATE UNIQUE INDEX "CourseSession_id_vendorId_key" ON "CourseSession"("id", "vendorId");
CREATE INDEX "CourseSession_courseId_startsAt_idx" ON "CourseSession"("courseId", "startsAt");
CREATE INDEX "CourseSession_vendorId_status_startsAt_idx" ON "CourseSession"("vendorId", "status", "startsAt");
CREATE UNIQUE INDEX "Enrollment_courseId_email_key" ON "Enrollment"("courseId", "email");
CREATE INDEX "Enrollment_vendorId_status_enrolledAt_idx" ON "Enrollment"("vendorId", "status", "enrolledAt");
CREATE INDEX "Enrollment_affiliateId_enrolledAt_idx" ON "Enrollment"("affiliateId", "enrolledAt");

ALTER TABLE "Course"
ADD CONSTRAINT "Course_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Course_registrationFormId_vendorId_fkey" FOREIGN KEY ("registrationFormId", "vendorId") REFERENCES "RegistrationForm"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Course_defaultProductId_vendorId_fkey" FOREIGN KEY ("defaultProductId", "vendorId") REFERENCES "Product"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseLesson"
ADD CONSTRAINT "CourseLesson_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "CourseLesson_courseId_vendorId_fkey" FOREIGN KEY ("courseId", "vendorId") REFERENCES "Course"("id", "vendorId") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "CourseLesson_videoId_vendorId_fkey" FOREIGN KEY ("videoId", "vendorId") REFERENCES "Video"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseSession"
ADD CONSTRAINT "CourseSession_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "CourseSession_courseId_vendorId_fkey" FOREIGN KEY ("courseId", "vendorId") REFERENCES "Course"("id", "vendorId") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "CourseSession_liveId_vendorId_fkey" FOREIGN KEY ("liveId", "vendorId") REFERENCES "Live"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Enrollment"
ADD CONSTRAINT "Enrollment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Enrollment_courseId_vendorId_fkey" FOREIGN KEY ("courseId", "vendorId") REFERENCES "Course"("id", "vendorId") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Enrollment_sessionId_vendorId_fkey" FOREIGN KEY ("sessionId", "vendorId") REFERENCES "CourseSession"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Enrollment_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rollback: export Enrollment first, then drop Enrollment, CourseSession, CourseLesson, Course in that order.
-- Finally drop the three id/vendorId unique indexes only after confirming no other composite FK uses them.
