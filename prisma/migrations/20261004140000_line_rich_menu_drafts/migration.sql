-- Additive draft storage; existing LINE account and delivery records are untouched.
CREATE TABLE "LineRichMenuDraft" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "menu" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineRichMenuDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LineRichMenuDraft_vendorId_key" ON "LineRichMenuDraft"("vendorId");
ALTER TABLE "LineRichMenuDraft" ADD CONSTRAINT "LineRichMenuDraft_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Draft access goes through the owner-scoped server actions, never the public Data API.
ALTER TABLE "LineRichMenuDraft" ENABLE ROW LEVEL SECURITY;
