ALTER TABLE "TrackingSetting"
ADD COLUMN "attributionPolicy" TEXT NOT NULL DEFAULT 'last_touch',
ADD COLUMN "attributionWindowDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "TrackingSetting"
ADD CONSTRAINT "TrackingSetting_attributionWindowDays_check"
CHECK ("attributionWindowDays" BETWEEN 1 AND 90);
