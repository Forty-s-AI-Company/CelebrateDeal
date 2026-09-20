CREATE TYPE "ConsultationBookingStatus" AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

CREATE TABLE "ConsultationEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
    "weeklySchedule" JSONB NOT NULL,
    "intakeFormFields" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsultationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultationBooking" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "ConsultationBookingStatus" NOT NULL DEFAULT 'scheduled',
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "clientPhone" TEXT NOT NULL,
    "answers" JSONB,
    "meetingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsultationBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsultationEvent_vendorId_id_key" ON "ConsultationEvent"("vendorId", "id");
CREATE INDEX "ConsultationEvent_vendorId_isActive_idx" ON "ConsultationEvent"("vendorId", "isActive");
CREATE INDEX "ConsultationEvent_vendorId_createdAt_idx" ON "ConsultationEvent"("vendorId", "createdAt");
CREATE UNIQUE INDEX "ConsultationBooking_vendorId_id_key" ON "ConsultationBooking"("vendorId", "id");
CREATE INDEX "ConsultationBooking_vendorId_eventId_startTime_idx" ON "ConsultationBooking"("vendorId", "eventId", "startTime");
CREATE INDEX "ConsultationBooking_vendorId_eventId_status_startTime_idx" ON "ConsultationBooking"("vendorId", "eventId", "status", "startTime");
-- Database-level last line of defense for simultaneous requests for the exact
-- same active slot. Cancelled/no-show history does not prevent a new booking.
CREATE UNIQUE INDEX "ConsultationBooking_active_slot_key"
  ON "ConsultationBooking"("vendorId", "eventId", "startTime")
  WHERE "status" = 'scheduled';

ALTER TABLE "ConsultationEvent" ADD CONSTRAINT "ConsultationEvent_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_vendorId_eventId_fkey"
  FOREIGN KEY ("vendorId", "eventId") REFERENCES "ConsultationEvent"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
