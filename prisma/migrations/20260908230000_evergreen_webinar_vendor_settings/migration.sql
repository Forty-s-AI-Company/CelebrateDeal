ALTER TABLE "Live"
  ADD COLUMN "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "evergreenScheduleMode" TEXT NOT NULL DEFAULT 'just_in_time',
  ADD COLUMN "evergreenIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "evergreenDailyTimes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "evergreenSessionStartAt" TIMESTAMP(3),
  ADD COLUMN "evergreenPitchAtSeconds" INTEGER,
  ADD COLUMN "evergreenConsultationAtSeconds" INTEGER,
  ADD COLUMN "evergreenPreviewEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "evergreenPreviewRate" DOUBLE PRECISION NOT NULL DEFAULT 1;
