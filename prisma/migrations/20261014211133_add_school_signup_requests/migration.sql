-- CreateEnum
CREATE TYPE "SignupRequestStatus" AS ENUM ('PENDING', 'CONTACTED', 'APPROVED', 'CONVERTED', 'REJECTED');

-- CreateTable
CREATE TABLE "SchoolSignupRequest" (
    "id" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "note" TEXT,
    "requestedPlanId" TEXT,
    "status" "SignupRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "convertedSchoolId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSignupRequest_convertedSchoolId_key" ON "SchoolSignupRequest"("convertedSchoolId");

-- CreateIndex
CREATE INDEX "SchoolSignupRequest_status_createdAt_idx" ON "SchoolSignupRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolSignupRequest_contactEmail_idx" ON "SchoolSignupRequest"("contactEmail");

-- AddForeignKey
ALTER TABLE "SchoolSignupRequest" ADD CONSTRAINT "SchoolSignupRequest_requestedPlanId_fkey" FOREIGN KEY ("requestedPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolSignupRequest" ADD CONSTRAINT "SchoolSignupRequest_convertedSchoolId_fkey" FOREIGN KEY ("convertedSchoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
