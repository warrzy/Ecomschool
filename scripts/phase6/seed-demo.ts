import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createTeacher } from "@/lib/services/teachers";
import { createSubject, setClassroomSubject } from "@/lib/services/subjects";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { upsertPolicy } from "@/lib/services/grading/policy";
import {
  ensureDefaultAssessmentTypes,
  createAssessment,
} from "@/lib/services/grading/assessments";
import { saveGrades } from "@/lib/services/grading/grades";
import { computeAndStore, setValidationStatus } from "@/lib/services/grading/results";
import {
  generateClassReportCards,
  updateResultAnnotations,
  ensureDefaultTemplates,
} from "@/lib/services/grading/reportcards";
import { createAnnouncement } from "@/lib/services/announcements";

/**
 * École de DÉMONSTRATION — données entièrement fictives.
 * Tous les noms, emails (@demo.local) et résultats sont inventés.
 * Idempotent : ré-exécutable sans doublons (upserts + find-or-create).
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo2026!";

async function demoUser(
  schoolId: string,
  email: string,
  roleName: string,
  firstName: string,
  lastName: string,
) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const role = await prisma.role.findFirstOrThrow({
    where: { name: roleName, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { schoolId, status: "ACTIVE", firstName, lastName },
    create: { email, passwordHash, schoolId, status: "ACTIVE", firstName, lastName },
    select: { id: true },
  });
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId, userId: user.id } },
    update: { roleId: role.id, status: "ACTIVE" },
    create: { schoolId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  return user.id;
}

async function main() {
  const school = await prisma.school.upsert({
    where: { code: "DEMO-ECOLE" },
    update: { status: "ACTIVE" },
    create: {
      code: "DEMO-ECOLE",
      slug: "demo-ecole",
      name: "Collège Démo ECOM (données fictives)",
      city: "Ouagadougou",
      address: "Secteur 15 — adresse fictive",
      phone: "+226 00 00 00 00",
      email: "contact@demo.local",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const schoolId = school.id;

  const adminId = await demoUser(schoolId, "admin@demo.local", "ADMIN_SCHOOL", "Admin", "Démo");
  const ctx = { userId: adminId, schoolId };

  // Année + périodes (idempotent)
  let yearId = (
    await prisma.academicYear.findFirst({
      where: { schoolId, name: "2025-2026" },
      select: { id: true },
    })
  )?.id;
  if (!yearId) {
    const year = await createYear(ctx, {
      name: "2025-2026",
      startDate: "2025-10-01",
      endDate: "2026-06-30",
      periodType: "TRIMESTER",
      isCurrent: true,
    });
    if (!year.ok) throw new Error(`createYear: ${year.error}`);
    yearId = year.result.id;
  }
  const year = { ok: true as const, result: { id: yearId } };
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId, academicYearId: year.result.id },
    orderBy: { number: "asc" },
  });
  const t1 = periods.find((p) => p.number === 1)!;

  // Niveau + classe (idempotent)
  let levelId = (
    await prisma.level.findFirst({
      where: { schoolId, name: "6e (démo)" },
      select: { id: true },
    })
  )?.id;
  if (!levelId) {
    const level = await createLevel(ctx, { name: "6e (démo)", order: 1 });
    if (!level.ok) throw new Error(`createLevel: ${level.error}`);
    levelId = level.result.id;
  }
  let classroomId = (
    await prisma.classroom.findFirst({
      where: { schoolId, name: "6e A (démo)", academicYearId: year.result.id },
      select: { id: true },
    })
  )?.id;
  if (!classroomId) {
    const classroom = await createClassroom(ctx, {
      name: "6e A (démo)",
      levelId,
      academicYearId: year.result.id,
      capacity: 40,
    });
    if (!classroom.ok) throw new Error(`createClassroom: ${classroom.error}`);
    classroomId = classroom.result.id;
  }
  const level = { result: { id: levelId } };
  const classroom = { result: { id: classroomId } };

  // Modèle collège pour le niveau démo
  await ensureDefaultTemplates(ctx);
  await prisma.reportCardTemplate.updateMany({
    where: { schoolId, key: "college" },
    data: { levelId: level.result.id },
  });

  // Enseignant + compte
  const teacher = await createTeacher(ctx, {
    firstName: "Awa",
    lastName: "Kaboré (fictif)",
    email: "enseignant@demo.local",
  });
  if (!teacher.ok) throw new Error(`createTeacher: ${teacher.error}`);
  const teacherUserId = await demoUser(schoolId, "enseignant@demo.local", "TEACHER", "Awa", "Kaboré");
  await prisma.teacher.update({
    where: { id: teacher.result.id },
    data: { userId: teacherUserId },
  });

  // Matières
  const subjectDefs = [
    { name: "Mathématiques (démo)", code: "MTH", coef: 3 },
    { name: "Français (démo)", code: "FRA", coef: 3 },
    { name: "Histoire-Géographie (démo)", code: "HIS", coef: 2 },
  ];
  const subjectIds: string[] = [];
  for (const s of subjectDefs) {
    const sub = await createSubject(ctx, { name: s.name, code: s.code });
    const subjectId = sub.ok
      ? sub.result.id
      : (
          await prisma.subject.findFirstOrThrow({
            where: { schoolId, name: s.name },
            select: { id: true },
          })
        ).id;
    subjectIds.push(subjectId);
    await setClassroomSubject(ctx, {
      classroomId: classroom.result.id,
      subjectId,
      coefficient: s.coef,
      teacherId: teacher.result.id,
    });
    await prisma.teachingAssignment.upsert({
      where: {
        teacherId_classroomId_subjectId_academicYearId: {
          teacherId: teacher.result.id,
          classroomId: classroom.result.id,
          subjectId,
          academicYearId: year.result.id,
        },
      },
      update: {},
      create: {
        schoolId,
        teacherId: teacher.result.id,
        classroomId: classroom.result.id,
        subjectId,
        academicYearId: year.result.id,
      },
    });
  }

  // Politique de notation
  await upsertPolicy(ctx, {
    academicYearId: year.result.id,
    maxScore: 20,
    passMark: 10,
    precision: 2,
    rounding: "HALF_UP",
    missingGradePolicy: "EXCLUDE",
    absentPolicy: "EXCLUDE",
    tieRule: "SHARED_RANK",
  });

  // Élèves fictifs + tuteur fictif
  const demoStudents = [
    { matricule: "DEMO-001", firstName: "Aminata", lastName: "Ouédraogo", sex: "FEMALE" as const },
    { matricule: "DEMO-002", firstName: "Ibrahim", lastName: "Sawadogo", sex: "MALE" as const },
    { matricule: "DEMO-003", firstName: "Fatoumata", lastName: "Zongo", sex: "FEMALE" as const },
  ];
  const studentIds: string[] = [];
  for (const s of demoStudents) {
    const st = await createStudent(ctx, s);
    const studentId = st.ok
      ? st.result.id
      : (
          await prisma.student.findFirstOrThrow({
            where: { schoolId, matricule: s.matricule },
            select: { id: true },
          })
        ).id;
    studentIds.push(studentId);
    const existing = await prisma.enrollment.findFirst({
      where: { schoolId, studentId, academicYearId: year.result.id, status: "ENROLLED" },
      select: { id: true },
    });
    if (!existing) {
      const en = await enrollStudent(ctx, {
        studentId,
        classroomId: classroom.result.id,
        academicYearId: year.result.id,
      });
      if (en.ok) {
        await prisma.enrollment.update({
          where: { id: en.result.id },
          data: { enrolledAt: new Date("2025-10-02T00:00:00.000Z") },
        });
      }
    }
  }

  // Parent fictif rattaché aux 2 premiers élèves
  const guardian = await prisma.guardian.upsert({
    where: { id: "demo-guardian-1" },
    update: {},
    create: {
      id: "demo-guardian-1",
      schoolId,
      firstName: "Moussa",
      lastName: "Ouédraogo (fictif)",
      email: "parent@demo.local",
      phone: "+226 70 00 00 00",
    },
    select: { id: true },
  });
  for (const sid of studentIds.slice(0, 2)) {
    await prisma.studentGuardian.upsert({
      where: {
        studentId_guardianId_relation: {
          studentId: sid,
          guardianId: guardian.id,
          relation: "FATHER",
        },
      },
      update: {},
      create: { schoolId, studentId: sid, guardianId: guardian.id, relation: "FATHER" },
    });
  }
  const parentUserId = await demoUser(schoolId, "parent@demo.local", "PARENT", "Moussa", "Ouédraogo");
  await prisma.guardian.update({
    where: { id: guardian.id },
    data: { userId: parentUserId },
  });
  const studentUserId = await demoUser(schoolId, "eleve@demo.local", "STUDENT", "Aminata", "Ouédraogo");
  await prisma.student.update({
    where: { id: studentIds[0] },
    data: { userId: studentUserId },
  });

  // Évaluations + notes (T1)
  const types = await ensureDefaultAssessmentTypes(ctx);
  const devoir = types.find((t) => t.code === "DEVOIR")!;
  const compo = types.find((t) => t.code === "COMPOSITION")!;
  const gradeMatrix = [15, 12, 9, 14, 11, 16];
  for (const [si, subjectId] of subjectIds.entries()) {
    for (const [ti, type] of [devoir, compo].entries()) {
      const existing = await prisma.assessment.findFirst({
        where: {
          schoolId,
          classroomId: classroom.result.id,
          subjectId,
          title: `${type.code === "DEVOIR" ? "Devoir" : "Composition"} démo ${si + 1}`,
        },
        select: { id: true },
      });
      let assessId = existing?.id;
      if (!assessId) {
        const a = await createAssessment(ctx, {
          academicYearId: year.result.id,
          academicPeriodId: t1.id,
          classroomId: classroom.result.id,
          subjectId,
          teacherId: teacher.result.id,
          typeId: type.id,
          title: `${type.code === "DEVOIR" ? "Devoir" : "Composition"} démo ${si + 1}`,
          date: new Date(ti === 0 ? "2025-11-15T00:00:00.000Z" : "2025-12-10T00:00:00.000Z"),
          maxScore: 20,
          coefficient: ti === 0 ? 1 : 2,
        });
        if (!a.ok) continue;
        assessId = a.result.id;
      }
      await saveGrades(ctx, assessId, [
        { studentId: studentIds[0], value: gradeMatrix[(si * 2 + ti) % 6], status: "ENTERED" },
        { studentId: studentIds[1], value: gradeMatrix[(si * 2 + ti + 1) % 6], status: "ENTERED" },
        { studentId: studentIds[2], value: gradeMatrix[(si * 2 + ti + 2) % 6], status: "ENTERED" },
      ]);
      await prisma.assessment.update({
        where: { id: assessId },
        data: { status: "PUBLISHED" },
      });
    }
  }

  // Calcul → validation → publication T1
  await computeAndStore(ctx, {
    classroomId: classroom.result.id,
    academicPeriodId: t1.id,
  });
  await generateClassReportCards(ctx, {
    classroomId: classroom.result.id,
    academicPeriodId: t1.id,
  });
  await setValidationStatus(ctx, {
    classroomId: classroom.result.id,
    academicPeriodId: t1.id,
    status: "VALIDATED",
  });
  for (const sid of studentIds) {
    await updateResultAnnotations(ctx, {
      studentId: sid,
      academicPeriodId: t1.id,
      generalAppreciation: "Trimestre fictif — travail correct.",
      councilDecision: "Encouragements",
      directionNote: "Poursuivre les efforts",
      sign: true,
    });
  }
  await generateClassReportCards(ctx, {
    classroomId: classroom.result.id,
    academicPeriodId: t1.id,
  });
  await setValidationStatus(ctx, {
    classroomId: classroom.result.id,
    academicPeriodId: t1.id,
    status: "PUBLISHED",
  });

  // Annonce de démonstration
  await createAnnouncement(ctx, {
    title: "Bienvenue sur le portail démo",
    body: "Ceci est une annonce fictive de démonstration.",
    audience: "ALL",
    publish: true,
  });

  console.log("=== ÉCOLE DE DÉMONSTRATION (données fictives) ===");
  console.log(`École : ${schoolId}`);
  console.log(`Mot de passe commun : ${DEMO_PASSWORD}`);
  console.log("admin@demo.local (ADMIN) · enseignant@demo.local (TEACHER)");
  console.log("parent@demo.local (PARENT → 2 enfants) · eleve@demo.local (STUDENT)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
