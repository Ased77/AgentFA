-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "email",
DROP COLUMN "passwordHash",
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginCode_phone_createdAt_idx" ON "LoginCode"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- RenameIndex
ALTER INDEX "Transaction_providerRef_key" RENAME TO "Transaction_refId_key";

