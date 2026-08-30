-- G8.02: add the explicit scheduled-role flag without rewriting existing role data.

ALTER TABLE "InteractionRole"
  ADD COLUMN "isScheduled" BOOLEAN NOT NULL DEFAULT false;
