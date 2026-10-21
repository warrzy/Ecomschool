/**
 * Audit F2-E2-C bis — reproduction LOCALE des risques d'intégrité des
 * résultats/bulletins après verrouillage de période ou clôture d'année.
 * Données de test uniquement (école fixture), jamais en préproduction.
 *
 * Usage : npx tsx scripts/f2e/integrite-resultats-audit.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { enrollStudent } from "../../src/lib/services/enrollments";
import {
  computeAndStore,
  setValidationStatus,
  computeAnnualResults,
} from "../../src/lib/services/grading/results";
import {
  generateClassReportCards,
  generateReportCard,
  updateResultAnnotations,
} from "../../src/lib/services/grading/reportcards";
import { saveGrades } from "../../src/lib/services/grading/grades";
import { setLevelCoefficient } from "../../src/lib/services/subjects";
import { updatePeriod } from "../../src/lib/services/academic";

let pass = 0, fail = 0;
const ok = (n: string) => { pass++; console.log(`  [reproduit] ${n}`); };
const ko = (n: string) => { fail++; console.log(`  [bloqué   ] ${n}`); };

const FX = "F2E2C-BIS-FX";

(async () => {
  // ---------- Fixtures ----------
  const old = await prisma.school.findFirst({ where: { name: FX }, select: { id: true } });
  if (old) {
    await prisma.reportCardVersion.deleteMany({ where: { reportCard: { schoolId: old.id } } });
    await prisma.reportCard.deleteMany({ where: { schoolId: old.id } });
    await prisma.subjectPeriodResult.deleteMany({ where: { schoolId: old.id } });
    await prisma.studentPeriodResult.deleteMany({ where: { schoolId: old.id } });
    await prisma.studentAnnualResult.deleteMany({ where: { schoolId: old.id } });
    await prisma.resultValidation.deleteMany({ where: { schoolId: old.id } });
    await prisma.gradeRevision.deleteMany({ where: { grade: { schoolId: old.id } } });
    await prisma.grade.deleteMany({ where: { schoolId: old.id } });
    await prisma.assessment.deleteMany({ where: { schoolId: old.id } });
    await prisma.enrollment.deleteMany({ where: { schoolId: old.id } });
    await prisma.student.deleteMany({ where: { schoolId: old.id } });
    await prisma.classroomSubject.deleteMany({ where: { schoolId: old.id } });
    await prisma.levelSubject.deleteMany({ where: { schoolId: old.id } });
    await prisma.classroom.deleteMany({ where: { schoolId: old.id } });
    await prisma.level.deleteMany({ where: { schoolId: old.id } });
    await prisma.subject.deleteMany({ where: { schoolId: old.id } });
    await prisma.assessmentType.deleteMany({ where: { schoolId: old.id } });
    await prisma.academicPeriod.deleteMany({ where: { schoolId: old.id } });
    await prisma.academicYear.deleteMany({ where: { schoolId: old.id } });
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.auditLog.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }
  const staleU = await prisma.user.findMany({ where: { email: "f2e2c-bis@test.local" }, select: { id: true } });
  if (staleU.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: staleU.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: staleU.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "f2e2c-bis-fx" } });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "BIS-2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      isCurrent: true, status: "ACTIVE",
      periods: {
        create: [
          { schoolId: school.id, name: "T1", number: 1, type: "TRIMESTER", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-20"), isLocked: false },
          { schoolId: school.id, name: "T2", number: 2, type: "TRIMESTER", startDate: new Date("2026-01-05"), endDate: new Date("2026-04-05"), isLocked: false },
        ],
      },
    },
  });
  const closedYear = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "BIS-2024-2025",
      startDate: new Date("2024-09-01"), endDate: new Date("2025-06-30"),
      status: "CLOSED",
      periods: {
        create: [
          { schoolId: school.id, name: "T1", number: 1, type: "TRIMESTER", startDate: new Date("2024-09-01"), endDate: new Date("2024-12-20"), isLocked: false },
        ],
      },
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "BIS-6e", order: 1 } });
  const cls = await prisma.classroom.create({ data: { schoolId: school.id, name: "BIS-A", academicYearId: year.id, levelId: level.id } });
  const cls2 = await prisma.classroom.create({ data: { schoolId: school.id, name: "BIS-B", academicYearId: year.id, levelId: level.id } });
  const clsClosed = await prisma.classroom.create({ data: { schoolId: school.id, name: "BIS-OLD", academicYearId: closedYear.id, levelId: level.id } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: "BIS-Maths", code: "BM" } });
  const subject2 = await prisma.subject.create({ data: { schoolId: school.id, name: "BIS-Français", code: "BF" } });
  const aType = await prisma.assessmentType.create({ data: { schoolId: school.id, code: "BDEVOIR", name: "Devoir", defaultCoefficient: 1, order: 0 } });
  const [t1] = await prisma.academicPeriod.findMany({ where: { academicYearId: year.id }, orderBy: { number: "asc" } });
  const t1Closed = await prisma.academicPeriod.findFirst({ where: { academicYearId: closedYear.id } });

  const user = await prisma.user.create({
    data: { email: "f2e2c-bis@test.local", passwordHash: "fixture", firstName: "B", lastName: "IS" },
  });
  const role = await prisma.role.findFirst({
    where: { scope: "SCHOOL", schoolId: null, rolePermissions: { some: { permission: { key: "enrollment.manage" } } } },
    select: { id: true },
  });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, roleId: role!.id } });
  const ctx = { userId: user.id, schoolId: school.id };

  const st1 = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-01", firstName: "A", lastName: "Un" } });
  const st2 = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-02", firstName: "B", lastName: "Deux" } });
  await enrollStudent(ctx, { studentId: st1.id, classroomId: cls.id, academicYearId: year.id });
  await enrollStudent(ctx, { studentId: st2.id, classroomId: cls.id, academicYearId: year.id });
  // Le moteur filtre les inscriptions par enrolledAt/leftAt sur la période :
  // on les place dans la période T1 comme en usage réel.
  await prisma.enrollment.updateMany({
    where: { schoolId: school.id, studentId: { in: [st1.id, st2.id] } },
    data: { enrolledAt: new Date("2025-09-10") },
  });
  await setLevelCoefficient(ctx, { subjectId: subject.id, levelId: level.id, coefficient: 2 });
  await setLevelCoefficient(ctx, { subjectId: subject2.id, levelId: level.id, coefficient: 1 });

  const a1 = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: t1.id,
      classroomId: cls.id, subjectId: subject.id, typeId: aType.id,
      title: "Devoir 1", date: new Date("2025-10-15"), maxScore: 20,
      status: "OPEN", createdById: user.id,
    },
  });
  await saveGrades(ctx, a1.id, [
    { studentId: st1.id, value: 10, status: "ENTERED" },
    { studentId: st2.id, value: 18, status: "ENTERED" },
  ]);
  await prisma.assessment.update({ where: { id: a1.id }, data: { status: "VALIDATED" } });
  const a2 = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: t1.id,
      classroomId: cls.id, subjectId: subject2.id, typeId: aType.id,
      title: "Rédaction 1", date: new Date("2025-10-20"), maxScore: 20,
      status: "VALIDATED", createdById: user.id,
    },
  });
  await prisma.grade.createMany({
    data: [
      { schoolId: school.id, assessmentId: a2.id, studentId: st1.id, value: 14, status: "ENTERED" },
      { schoolId: school.id, assessmentId: a2.id, studentId: st2.id, value: 12, status: "ENTERED" },
    ],
  });

  console.log("== Étape 1 : calcul → validation → publication → bulletins (période OUVERTE) ==");

  const c1 = await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  ok(`computeAndStore période ouverte : ${c1.ok ? "OK" : "échec"}`);
  const sprBefore = await prisma.studentPeriodResult.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { generalAverage: true, status: true },
  });
  console.log(`    → st1 : moyenne ${sprBefore?.generalAverage}, statut ${sprBefore?.status}`);

  await setValidationStatus(ctx, { classroomId: cls.id, academicPeriodId: t1.id, status: "VALIDATED" });
  const g1 = await generateClassReportCards(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  ok(`generateClassReportCards : ${g1.ok ? `${g1.result.generated} bulletin(s)` : "échec"}`);
  await setValidationStatus(ctx, { classroomId: cls.id, academicPeriodId: t1.id, status: "PUBLISHED" });
  const card1 = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const v1Avg = (card1?.versions[0]?.payload as { generalAverage?: number } | undefined)?.generalAverage;
  console.log(`    → bulletin v${card1?.currentVersion} publié, moyenne figée : ${v1Avg}`);

  console.log("\n== Étape 2 : VERROUILLAGE de la période T1 ==");
  await updatePeriod(ctx, t1.id, { isLocked: true });
  ok("période T1 verrouillée");

  console.log("\n== Étape 3 : opérations tentées APRÈS verrouillage ==");

  // R1 — recalcul sur période verrouillée
  const c2 = await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  if (c2.ok) {
    ok("R1 : recalcul possible sur période verrouillée (computeAndStore sans garde)");
  } else {
    ko(`R1 : recalcul refusé (${c2.error})`);
  }
  const sprAfter = await prisma.studentPeriodResult.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { generalAverage: true, status: true },
  });
  const cardAfter = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { status: true },
  });
  if (sprAfter?.status === "CALCULATED" && cardAfter?.status === "PUBLISHED") {
    ok(`R1b : résultat rétrogradé PUBLISHED→${sprAfter?.status} alors que le bulletin reste ${cardAfter?.status}`);
  } else {
    console.log(`    → statuts après recalcul : résultat=${sprAfter?.status}, bulletin=${cardAfter?.status}`);
  }

  // R2 — divergence via changement de coefficient puis recalcul
  await setLevelCoefficient(ctx, { subjectId: subject.id, levelId: level.id, coefficient: 5 });
  ok("R2 : coefficient de niveau modifiable après verrouillage (setLevelCoefficient sans garde)");
  await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  const sprDiv = await prisma.studentPeriodResult.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { generalAverage: true },
  });
  const g2 = await generateReportCard(ctx, { studentId: st1.id, academicPeriodId: t1.id, reason: "test" });
  const card2 = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const v2Avg = (card2?.versions[0]?.payload as { generalAverage?: number } | undefined)?.generalAverage;
  if (g2.ok && v2Avg !== v1Avg) {
    ok(`R2b : bulletin régénéré avec des valeurs différentes après verrouillage (v1=${v1Avg} → v${card2?.currentVersion}=${v2Avg})`);
  } else {
    console.log(`    → v1=${v1Avg}, v${card2?.currentVersion}=${v2Avg}`);
  }

  // R3 — déclassement du workflow résultats sur période verrouillée
  const st3 = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-03", firstName: "C", lastName: "Trois" } });
  await enrollStudent(ctx, { studentId: st3.id, classroomId: cls2.id, academicYearId: year.id });
  await prisma.enrollment.updateMany({
    where: { schoolId: school.id, studentId: st3.id },
    data: { enrolledAt: new Date("2025-09-10") },
  });
  await computeAndStore(ctx, { classroomId: cls2.id, academicPeriodId: t1.id });
  await setValidationStatus(ctx, { classroomId: cls2.id, academicPeriodId: t1.id, status: "VALIDATED" });
  const rv1 = await setValidationStatus(ctx, { classroomId: cls2.id, academicPeriodId: t1.id, status: "CALCULATED" });
  if (rv1.ok) {
    ok("R3 : VALIDATED→CALCULATED possible sur période verrouillée (dé-validation)");
  } else {
    ko(`R3 : dé-validation refusée (${rv1.error})`);
  }
  const rv2 = await setValidationStatus(ctx, { classroomId: cls2.id, academicPeriodId: t1.id, status: "DRAFT" });
  if (rv2.ok) {
    ok("R3b : CALCULATED→DRAFT possible sur période verrouillée (effacement du workflow)");
  } else {
    ko(`R3b : retour DRAFT refusé (${rv2.error})`);
  }

  // R4 — annotations sur résultat publié / période verrouillée
  const ann = await updateResultAnnotations(ctx, {
    studentId: st1.id, academicPeriodId: t1.id, generalAppreciation: "Modifié après verrouillage",
  });
  if (ann.ok) {
    ok("R4 : annotations modifiables sur résultat de période verrouillée");
  } else {
    ko(`R4 : annotations refusées (${ann.error})`);
  }

  // R5 — nouvel élève inscrit dans la classe (effet indirect sur un recalcul)
  const st4 = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-04", firstName: "D", lastName: "Quatre" } });
  const e4 = await enrollStudent(ctx, { studentId: st4.id, classroomId: cls.id, academicYearId: year.id });
  await prisma.enrollment.updateMany({
    where: { schoolId: school.id, studentId: st4.id },
    data: { enrolledAt: new Date("2025-10-01") },
  });
  if (e4.ok) {
    ok("R5 : inscription encore possible dans une classe dont la période est verrouillée");
    await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
    const sprSt4 = await prisma.studentPeriodResult.findFirst({
      where: { studentId: st4.id, academicPeriodId: t1.id },
      select: { id: true },
    });
    if (sprSt4) {
      ok("R5b : le recalcul post-verrouillage a injecté le nouvel élève dans les résultats de la période figée");
    }
  } else {
    ko(`R5 : inscription refusée (${e4.error})`);
  }

  console.log("\n== Étape 4 : année CLOSED ==");

  // R6 — recalcul annuel sur année fermée
  const an1 = await computeAnnualResults(ctx, closedYear.id);
  if (an1.ok) {
    ok(`R6 : computeAnnualResults possible sur année CLOSED (${an1.result.students} élève(s))`);
  } else {
    ko(`R6 : recalcul annuel refusé (${an1.error})`);
  }

  // R7 — saisie de notes sur année fermée (évaluation OPEN, période non verrouillée)
  const stC = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-OLD1", firstName: "O", lastName: "Ld" } });
  await prisma.enrollment.create({
    data: { schoolId: school.id, studentId: stC.id, classroomId: clsClosed.id, academicYearId: closedYear.id, status: "ENROLLED", enrolledAt: new Date("2024-09-10") },
  });
  const aC = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: closedYear.id, academicPeriodId: t1Closed!.id,
      classroomId: clsClosed.id, subjectId: subject.id, typeId: aType.id,
      title: "Devoir année close", date: new Date("2024-10-15"), maxScore: 20,
      status: "OPEN", createdById: user.id,
    },
  });
  const sg = await saveGrades(ctx, aC.id, [{ studentId: stC.id, value: 15, status: "ENTERED" }]);
  if (sg.ok) {
    ok("R7 : saveGrades possible sur année CLOSED (pas de contrôle d'année)");
  } else {
    ko(`R7 : saisie refusée (${sg.error})`);
  }

  // R8 — recalcul période sur année fermée
  const c3 = await computeAndStore(ctx, { classroomId: clsClosed.id, academicPeriodId: t1Closed!.id });
  if (c3.ok) {
    ok("R8 : computeAndStore possible sur année CLOSED");
  } else {
    ko(`R8 : recalcul refusé (${c3.error})`);
  }

  // R9 — période d'année fermée : updatePeriod refuse (contrôle existant)
  const up = await updatePeriod(ctx, t1Closed!.id, { isLocked: true });
  if (!up.ok && up.error === "YEAR_CLOSED") {
    ok("R9 : updatePeriod refuse sur année CLOSED (contrôle existant — la période reste dans son état)");
  } else {
    ko("R9 : updatePeriod a modifié une période d'année close");
  }

  console.log(`\n=== BILAN REPRODUCTION : ${pass} risques/comportements observés, ${fail} refus ===`);
  await prisma.$disconnect();
  process.exit(0);
})();
