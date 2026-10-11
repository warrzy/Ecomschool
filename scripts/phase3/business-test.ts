import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  closeYear,
  createYear,
  setCurrentYear,
  updatePeriod,
} from "@/lib/services/academic";
import {
  createClassroom,
  createLevel,
  updateClassroom,
} from "@/lib/services/classes";
import { createTeacher, assignTeacher } from "@/lib/services/teachers";
import { createStudent, updateStudent } from "@/lib/services/students";
import {
  createGuardian,
  linkGuardianToStudent,
} from "@/lib/services/guardians";
import {
  enrollStudent,
  transferStudent,
  closeEnrollment,
} from "@/lib/services/enrollments";
import {
  createSubject,
  setLevelCoefficient,
  setClassroomSubject,
} from "@/lib/services/subjects";
import { removeSchoolUser } from "@/lib/services/users";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
};

async function ensureSchool(code: string, name: string) {
  return prisma.school.upsert({
    where: { code },
    update: { status: "ACTIVE" },
    create: { name, code, slug: code.toLowerCase(), status: "ACTIVE" },
    select: { id: true },
  });
}

async function ensureAdmin(schoolId: string, email: string) {
  const passwordHash = await hashPassword(process.env.SEED_TEST_PASSWORD!);
  const role = await prisma.role.findFirstOrThrow({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { schoolId, status: "ACTIVE" },
    create: {
      email,
      passwordHash,
      schoolId,
      status: "ACTIVE",
      firstName: "Admin",
      lastName: email.split("@")[0],
    },
    select: { id: true },
  });
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId, userId: user.id } },
    update: { roleId: role.id, status: "ACTIVE" },
    create: {
      schoolId,
      userId: user.id,
      roleId: role.id,
      status: "ACTIVE",
    },
  });
  return user.id;
}

async function main() {
  const schoolA = await ensureSchool("TEST-P3-A", "Ecole Test Phase3 A");
  const schoolB = await ensureSchool("TEST-P3-B", "Ecole Test Phase3 B");
  const adminA = await ensureAdmin(schoolA.id, "phase3-admin-a@ecom-test.local");
  const adminB = await ensureAdmin(schoolB.id, "phase3-admin-b@ecom-test.local");

  // Nettoyage des données métier des écoles de test (runs précédents)
  for (const sid of [schoolA.id, schoolB.id]) {
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { schoolId: sid } }),
      prisma.attendanceRecord.deleteMany({ where: { schoolId: sid } }),
      prisma.courseContent.deleteMany({
        where: { session: { schoolId: sid } },
      }),
      prisma.courseSession.deleteMany({ where: { schoolId: sid } }),
      prisma.courseSchedule.deleteMany({ where: { schoolId: sid } }),
      prisma.enrollment.deleteMany({ where: { schoolId: sid } }),
      prisma.studentGuardian.deleteMany({
        where: { student: { schoolId: sid } },
      }),
      prisma.guardian.deleteMany({ where: { schoolId: sid } }),
      prisma.student.deleteMany({ where: { schoolId: sid } }),
      prisma.classroomSubject.deleteMany({ where: { schoolId: sid } }),
      prisma.levelSubject.deleteMany({ where: { schoolId: sid } }),
      prisma.teachingAssignment.deleteMany({ where: { schoolId: sid } }),
      prisma.subject.deleteMany({ where: { schoolId: sid } }),
      prisma.teacher.deleteMany({ where: { schoolId: sid } }),
      prisma.classroom.deleteMany({ where: { schoolId: sid } }),
      prisma.level.deleteMany({ where: { schoolId: sid } }),
      prisma.academicPeriod.deleteMany({ where: { schoolId: sid } }),
      prisma.academicYear.deleteMany({ where: { schoolId: sid } }),
      prisma.room.deleteMany({ where: { schoolId: sid } }),
    ]);
  }

  const ctxA = { userId: adminA, schoolId: schoolA.id };
  const ctxB = { userId: adminB, schoolId: schoolB.id };

  // ---- Écoles + années ----
  const yearA = await createYear(ctxA, {
    name: `P3-${Date.now() % 100000}`,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  record("année A créée + courante", yearA.ok);
  if (!yearA.ok) throw new Error("createYear failed");
  const yearAId = yearA.result.id;

  const yearB = await createYear(ctxB, {
    name: `P3B-${Date.now() % 100000}`,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
    periodType: "SEMESTER",
    isCurrent: true,
  });
  record("année B créée (2 semestres)", yearB.ok);
  if (!yearB.ok) throw new Error("createYear B failed");
  const yearBId = yearB.result.id;

  const periodsB = await prisma.academicPeriod.count({
    where: { academicYearId: yearBId, schoolId: schoolB.id },
  });
  record("année B a 2 périodes semestrielles", periodsB === 2, `${periodsB}`);

  // Une seule année courante par école
  const yearA2 = await createYear(ctxA, {
    name: `P3-old-${Date.now() % 100000}`,
    startDate: "2025-09-01",
    endDate: "2026-06-30",
    periodType: "TRIMESTER",
    isCurrent: false,
  });
  record("année A archivée créée (DRAFT)", yearA2.ok);
  if (yearA2.ok) {
    const closed = await closeYear(ctxA, yearA2.result.id);
    record("clôture année non courante", closed.ok);
    const notCurrent = await setCurrentYear(ctxA, yearA2.result.id);
    record(
      "année clôturée ne peut pas devenir courante",
      !notCurrent.ok && notCurrent.error === "YEAR_CLOSED",
      JSON.stringify(notCurrent),
    );
    const closeCurrent = await closeYear(ctxA, yearAId);
    record(
      "année courante non clôturale sans transfert",
      !closeCurrent.ok && closeCurrent.error === "IS_CURRENT",
    );
  }

  // Période cross-tenant : admin B ne peut pas modifier une période de A
  const periodA = await prisma.academicPeriod.findFirstOrThrow({
    where: { academicYearId: yearAId },
    select: { id: true },
  });
  const foreignPeriod = await updatePeriod(ctxB, periodA.id, {
    name: "hack",
  });
  record(
    "période A modifiée par école B => NOT_FOUND",
    !foreignPeriod.ok && foreignPeriod.error === "NOT_FOUND",
  );

  // ---- Niveaux & classes ----
  const levelA = await createLevel(ctxA, { name: "6e", order: 6 });
  const levelB = await createLevel(ctxB, { name: "6e", order: 6 });
  // Idempotence : si le niveau existe déjà (run précédent), on le réutilise
  const levelAId = levelA.ok
    ? levelA.result.id
    : (
        await prisma.level.findFirstOrThrow({
          where: { schoolId: schoolA.id, name: "6e" },
          select: { id: true },
        })
      ).id;
  const levelBId = levelB.ok
    ? levelB.result.id
    : (
        await prisma.level.findFirstOrThrow({
          where: { schoolId: schoolB.id, name: "6e" },
          select: { id: true },
        })
      ).id;
  record("niveaux A/B créés", true);
  const levelAOk = { ok: true as const, result: { id: levelAId } };
  const levelBOk = { ok: true as const, result: { id: levelBId } };

  const clsA = await createClassroom(ctxA, {
    name: "6e A",
    academicYearId: yearAId,
    levelId: levelAOk.result.id,
    section: "A",
    capacity: 45,
  });
  record("classe A créée", clsA.ok);
  if (!clsA.ok) throw new Error("classroom A failed");
  const clsAId = clsA.result.id;

  const clsB = await createClassroom(ctxB, {
    name: "6e A",
    academicYearId: yearBId,
    levelId: levelBOk.result.id,
  });
  if (!clsB.ok) throw new Error("classroom B failed");
  const clsBId = clsB.result.id;

  // Classe avec niveau d'une autre école => NOT_FOUND
  const crossLevel = await createClassroom(ctxA, {
    name: "x",
    academicYearId: yearAId,
    levelId: levelBOk.result.id,
  });
  record(
    "classe A avec niveau B => NOT_FOUND",
    !crossLevel.ok && crossLevel.error === "NOT_FOUND",
  );

  // Classe avec année d'une autre école => NOT_FOUND
  const crossYear = await createClassroom(ctxA, {
    name: "y",
    academicYearId: yearBId,
    levelId: levelAOk.result.id,
  });
  record(
    "classe A avec année B => NOT_FOUND",
    !crossYear.ok && crossYear.error === "NOT_FOUND",
  );

  // ---- Enseignants ----
  const teacherA = await createTeacher(ctxA, {
    firstName: "Prof",
    lastName: "Alpha",
    email: "prof.alpha@ecom-test.local",
  });
  record("enseignant A créé", teacherA.ok);
  if (!teacherA.ok) throw new Error("teacher A failed");
  const teacherAId = teacherA.result.id;

  const subjectA = await createSubject(ctxA, {
    name: "Mathématiques",
    code: "MATH",
  });
  record("matière A créée", subjectA.ok);
  if (!subjectA.ok) throw new Error("subject A failed");
  const subjectAId = subjectA.result.id;

  const assignA = await assignTeacher(ctxA, {
    teacherId: teacherAId,
    classroomId: clsAId,
    subjectId: subjectAId,
    academicYearId: yearAId,
  });
  record("affectation enseignant A (classe+matière)", assignA.ok);

  const assignCross = await assignTeacher(ctxA, {
    teacherId: teacherAId,
    classroomId: clsBId,
    subjectId: subjectAId,
    academicYearId: yearAId,
  });
  record(
    "affectation vers classe B => NOT_FOUND",
    !assignCross.ok && assignCross.error === "NOT_FOUND",
  );

  const assignWrongYear = await assignTeacher(ctxA, {
    teacherId: teacherAId,
    classroomId: clsAId,
    subjectId: subjectAId,
    academicYearId: yearBId,
  });
  record(
    "affectation classe A + année B => NOT_FOUND",
    !assignWrongYear.ok && assignWrongYear.error === "NOT_FOUND",
  );

  // Prof principal cross-tenant
  const teacherB = await createTeacher(ctxB, {
    firstName: "Prof",
    lastName: "Beta",
  });
  if (teacherB.ok) {
    const crossHead = await updateClassroom(ctxA, clsAId, {
      headTeacherId: teacherB.result.id,
    });
    record(
      "prof principal de l'école B sur classe A => NOT_FOUND",
      !crossHead.ok && crossHead.error === "NOT_FOUND",
    );
  }

  // ---- Coefficients ----
  const coefLevel = await setLevelCoefficient(ctxA, {
    subjectId: subjectAId,
    levelId: levelAOk.result.id,
    coefficient: 3,
  });
  record("coefficient par niveau défini", coefLevel.ok);

  const coefCross = await setLevelCoefficient(ctxA, {
    subjectId: subjectAId,
    levelId: levelBOk.result.id,
    coefficient: 2,
  });
  record(
    "coefficient niveau B => NOT_FOUND",
    !coefCross.ok && coefCross.error === "NOT_FOUND",
  );

  const coefClass = await setClassroomSubject(ctxA, {
    classroomId: clsAId,
    subjectId: subjectAId,
    coefficient: 4,
    teacherId: teacherAId,
  });
  record("coefficient par classe + enseignant", coefClass.ok);

  const coefClassB = await setClassroomSubject(ctxA, {
    classroomId: clsBId,
    subjectId: subjectAId,
    coefficient: 2,
  });
  record(
    "coefficient classe B => NOT_FOUND",
    !coefClassB.ok && coefClassB.error === "NOT_FOUND",
  );

  // ---- Élèves & parents ----
  const matriculeA = `P3-${Date.now() % 100000}`;
  const studentA = await createStudent(ctxA, {
    matricule: matriculeA,
    lastName: "ELEVE",
    firstName: "Un",
    sex: "FEMALE",
    birthDate: "2012-01-15",
  });
  record("élève A créé", studentA.ok);
  if (!studentA.ok) throw new Error("student A failed");
  const studentAId = studentA.result.id;

  const dupMatricule = await createStudent(ctxA, {
    matricule: matriculeA,
    lastName: "ELEVE",
    firstName: "Deux",
  });

  const guardianA = await createGuardian(ctxA, {
    firstName: "Parent",
    lastName: "Alpha",
    phone: "+22670000000",
  });
  record("parent A créé", guardianA.ok);
  if (!guardianA.ok) throw new Error("guardian A failed");
  const guardianAId = guardianA.result.id;

  const link = await linkGuardianToStudent(ctxA, {
    studentId: studentAId,
    guardianId: guardianAId,
    relation: "MOTHER",
  });
  record("rattachement mère => élève A", link.ok);

  const linkDup = await linkGuardianToStudent(ctxA, {
    studentId: studentAId,
    guardianId: guardianAId,
    relation: "MOTHER",
  });
  record(
    "double rattachement même relation => ALREADY_LINKED",
    !linkDup.ok && linkDup.error === "ALREADY_LINKED",
  );

  const guardianB = await createGuardian(ctxB, {
    firstName: "Parent",
    lastName: "Beta",
  });
  if (guardianB.ok) {
    const crossLink = await linkGuardianToStudent(ctxA, {
      studentId: studentAId,
      guardianId: guardianB.result.id,
      relation: "FATHER",
    });
    record(
      "rattachement parent B à élève A => NOT_FOUND",
      !crossLink.ok && crossLink.error === "NOT_FOUND",
    );
  }

  // ---- Inscriptions ----
  const enrA = await enrollStudent(ctxA, {
    studentId: studentAId,
    classroomId: clsAId,
    academicYearId: yearAId,
  });
  record("inscription élève A en classe A", enrA.ok);
  if (!enrA.ok) throw new Error("enroll failed");
  const enrAId = enrA.result.id;

  const enrDup = await enrollStudent(ctxA, {
    studentId: studentAId,
    classroomId: clsAId,
    academicYearId: yearAId,
  });
  record(
    "double inscription même année => ALREADY_ENROLLED",
    !enrDup.ok && enrDup.error === "ALREADY_ENROLLED",
  );

  const enrCrossYear = await enrollStudent(ctxA, {
    studentId: studentAId,
    classroomId: clsAId,
    academicYearId: yearBId,
  });
  record(
    "inscription classe A + année B => CROSS_YEAR/NOT_FOUND",
    !enrCrossYear.ok,
  );

  const enrForeignClass = await enrollStudent(ctxA, {
    studentId: studentAId,
    classroomId: clsBId,
    academicYearId: yearBId,
  });
  record(
    "élève A inscrit en classe B => NOT_FOUND",
    !enrForeignClass.ok && enrForeignClass.error === "NOT_FOUND",
  );

  // Transfert : crée une 2e classe A et transfère
  const clsA2 = await createClassroom(ctxA, {
    name: "6e B",
    academicYearId: yearAId,
    levelId: levelAOk.result.id,
  });
  if (clsA2.ok) {
    const transfer = await transferStudent(ctxA, {
      enrollmentId: enrAId,
      toClassroomId: clsA2.result.id,
    });
    record("transfert de classe", transfer.ok);

    const history = await prisma.enrollment.findMany({
      where: { studentId: studentAId, academicYearId: yearAId },
      orderBy: { createdAt: "asc" },
      select: { status: true, classroomId: true },
    });
    record(
      "historique conservé (TRANSFERRED + ENROLLED)",
      history.length === 2 &&
        history[0].status === "TRANSFERRED" &&
        history[1].status === "ENROLLED" &&
        history[1].classroomId === clsA2.result.id,
      JSON.stringify(history),
    );

    const withdrawn = await closeEnrollment(ctxA, {
      enrollmentId: transfer.ok ? transfer.result.id : enrAId,
      status: "WITHDRAWN",
    });
    record("retrait inscription", withdrawn.ok);
  }

  // Matricule dupliqué
  record(
    "matricule dupliqué => MATRICULE_TAKEN",
    !dupMatricule.ok && dupMatricule.error === "MATRICULE_TAKEN",
    JSON.stringify(dupMatricule),
  );

  // Archivage élève : historique conservé
  const archiveStudent = await updateStudent(ctxA, studentAId, {
    status: "ARCHIVED",
  });
  record("archivage élève", archiveStudent.ok);
  const enrStillThere = await prisma.enrollment.count({
    where: { studentId: studentAId },
  });
  record("historique inscriptions préservé après archivage", enrStillThere >= 2);

  // ---- Protection dernier admin ----
  const removeLast = await removeSchoolUser(ctxA, adminA);
  record(
    "suppression dernier admin A => refusé",
    !removeLast.ok,
    JSON.stringify(removeLast),
  );

  // Un admin B ne voit pas les élèves de A via listStudents
  const { listStudents } = await import("@/lib/services/students");
  const studentsFromB = await listStudents(ctxB, { q: studentAId.slice(0, 4) });
  record(
    "recherche élève A depuis école B => 0",
    studentsFromB.items.every((s) => s.id !== studentAId),
  );

  const failed = checks.filter((c) => !c.ok);
  console.log(
    JSON.stringify({ ok: failed.length === 0, total: checks.length, failed: failed.length, checks }, null, 2),
  );
  if (failed.length > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("PHASE3_BUSINESS_TEST_FAILED");
    console.error(e);
    console.log(JSON.stringify({ checks }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
