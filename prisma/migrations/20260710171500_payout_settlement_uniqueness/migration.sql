-- A locked settlement can be assigned to only one payout item.
CREATE UNIQUE INDEX "PayoutItem_settlementId_key" ON "PayoutItem"("settlementId");
