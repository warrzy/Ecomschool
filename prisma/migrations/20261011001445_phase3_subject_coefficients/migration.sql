-- CreateTable
CREATE TABLE "LevelSubject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "coefficient" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassroomSubject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "coefficient" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassroomSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LevelSubject_schoolId_idx" ON "LevelSubject"("schoolId");

-- CreateIndex
CREATE INDEX "LevelSubject_subjectId_idx" ON "LevelSubject"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "LevelSubject_levelId_subjectId_key" ON "LevelSubject"("levelId", "subjectId");

-- CreateIndex
CREATE INDEX "ClassroomSubject_schoolId_idx" ON "ClassroomSubject"("schoolId");

-- CreateIndex
CREATE INDEX "ClassroomSubject_subjectId_idx" ON "ClassroomSubject"("subjectId");

-- CreateIndex
CREATE INDEX "ClassroomSubject_teacherId_idx" ON "ClassroomSubject"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomSubject_classroomId_subjectId_key" ON "ClassroomSubject"("classroomId", "subjectId");

-- AddForeignKey
ALTER TABLE "LevelSubject" ADD CONSTRAINT "LevelSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelSubject" ADD CONSTRAINT "LevelSubject_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelSubject" ADD CONSTRAINT "LevelSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomSubject" ADD CONSTRAINT "ClassroomSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomSubject" ADD CONSTRAINT "ClassroomSubject_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomSubject" ADD CONSTRAINT "ClassroomSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomSubject" ADD CONSTRAINT "ClassroomSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
