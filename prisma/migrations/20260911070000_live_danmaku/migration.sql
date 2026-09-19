-- Additive, default-off state. Existing card responses remain unchanged.
ALTER TABLE "Live" ADD COLUMN "danmakuState" JSONB;
