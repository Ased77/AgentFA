-- Payment gateway columns.
--
-- `providerRef` becomes `refId` (the reference the payer sees), and rows gain
-- our own `orderId`, the gateway's `providerToken`, a settlement timestamp and
-- a failure reason. Written by hand rather than generated so existing rows keep
-- their data instead of being dropped and re-added.

-- RenameColumn
ALTER TABLE "Transaction" RENAME COLUMN "providerRef" TO "refId";

-- AddColumn
ALTER TABLE "Transaction"
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "providerToken" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "failureReason" TEXT;

-- Backfill the order id for any row created before this migration.
UPDATE "Transaction"
SET "orderId" = 'legacy-' || "id"
WHERE "orderId" IS NULL;

-- Enforce the new contract.
ALTER TABLE "Transaction" ALTER COLUMN "orderId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_orderId_key" ON "Transaction"("orderId");
CREATE UNIQUE INDEX "Transaction_providerToken_key" ON "Transaction"("providerToken");
