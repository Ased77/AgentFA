-- Browser crash and failed-request reports.
--
-- Hand-written to match the style of the other migrations (a `prisma migrate
-- dev` run would also work, but it needs a database; this is one table).

-- CreateTable
CREATE TABLE "ClientError" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawMessage" TEXT,
    "stack" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT '',
    "release" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT '',
    "viewport" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- Unique: a fingerprint is one group, so a repeat report is a single atomic
-- upsert that increments the count instead of a second row.
CREATE UNIQUE INDEX "ClientError_fingerprint_key" ON "ClientError"("fingerprint");

-- CreateIndex
CREATE INDEX "ClientError_lastSeenAt_idx" ON "ClientError"("lastSeenAt");

-- AddForeignKey
--
-- Reports outlive the account they came from: a deleted user should not erase
-- the evidence of the crash they hit.
ALTER TABLE "ClientError" ADD CONSTRAINT "ClientError_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
