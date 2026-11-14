-- RH-1 : personnel — additif uniquement (aucune table existante modifiée).
CREATE TYPE "EmploymentCategory" AS ENUM ('TEACHING', 'NON_TEACHING');
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEPARTED');
CREATE TYPE "ContractType" AS ENUM ('CDI', 'CDD', 'VACATION', 'INTERN');
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');

CREATE TABLE "Employee" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "matricule" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "sex" "Gender",
  "birthDate" TIMESTAMP(3),
  "phone" TEXT,
  "email" TEXT,
  "nationalId" TEXT,
  "category" "EmploymentCategory" NOT NULL DEFAULT 'NON_TEACHING',
  "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "hireDate" TIMESTAMP(3),
  "departureDate" TIMESTAMP(3),
  "teacherId" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Employee_schoolId_matricule_key" ON "Employee"("schoolId", "matricule");
CREATE INDEX "Employee_schoolId_idx" ON "Employee"("schoolId");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EmployeeContract" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "type" "ContractType" NOT NULL,
  "position" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "baseSalary" INTEGER NOT NULL DEFAULT 0,
  "amendsContractId" TEXT,
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeContract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeContract_employeeId_idx" ON "EmployeeContract"("employeeId");
ALTER TABLE "EmployeeContract" ADD CONSTRAINT "EmployeeContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployeeDocument" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "fileUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
