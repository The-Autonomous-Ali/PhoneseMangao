-- Google sign-in becomes the primary customer login, so a User row can now be
-- created from an email alone and pick up its phone number at first checkout.
--
-- Dropping NOT NULL on "phone" is the only destructive-looking step, and it is
-- a widening change: every existing row keeps its value. The two new unique
-- indexes are safe on existing rows because both columns start entirely NULL,
-- and Postgres treats NULLs as distinct in a unique index.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");
