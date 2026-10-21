/**
 * Recette F2-E2-C bis — vérification des gardes d'intégrité des
 * résultats/bulletins après verrouillage de période ou clôture d'année.
 * Rejoue les scénarios R1, R3, R6, R7, R8, R2b de l'audit en mode
 * PASS/FAIL (les opérations doivent être REFUSÉES post-correctif).
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
  rectifyReportCard,
} from "../../src/lib/services/grading/reportcards";
import { saveGrades } from "../../src/lib/services/grading/grades";
import { setLevelCoefficient } from "../../src/lib/services/subjects";
import { updatePeriod } from "../../src/lib/services/academic";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

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
  const [t1, t2] = await prisma.academicPeriod.findMany({ where: { academicYearId: year.id }, orderBy: { number: "asc" } });
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
  check("computeAndStore période ouverte : OK", c1.ok);
  const sprBefore = await prisma.studentPeriodResult.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { generalAverage: true, status: true },
  });
  check("résultat st1 calculé (11.33 attendu)", sprBefore?.generalAverage === 11.33);

  await setValidationStatus(ctx, { classroomId: cls.id, academicPeriodId: t1.id, status: "VALIDATED" });
  const g1 = await generateClassReportCards(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  check("generateClassReportCards période ouverte : 2 bulletins",
    g1.ok && g1.result.generated === 2);
  await setValidationStatus(ctx, { classroomId: cls.id, academicPeriodId: t1.id, status: "PUBLISHED" });
  const card1 = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const v1Avg = (card1?.versions[0]?.payload as { generalAverage?: number } | undefined)?.generalAverage;
  check("bulletin v1 publié, moyenne figée 11.33",
    card1?.status === "PUBLISHED" && card1?.currentVersion === 1 && v1Avg === 11.33);

  console.log("\n== Étape 2 : VERROUILLAGE de la période T1 ==");
  await updatePeriod(ctx, t1.id, { isLocked: true });

  console.log("\n== Étape 3 : opérations APRÈS verrouillage — doivent être refusées ou contrôlées ==");

  // R1 — recalcul sur période verrouillée → PERIOD_LOCKED, rien ne change
  const c2 = await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  check("R1 : recalcul période verrouillée refusé (PERIOD_LOCKED)",
    !c2.ok && c2.error === "PERIOD_LOCKED");
  const sprAfter = await prisma.studentPeriodResult.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { generalAverage: true, status: true },
  });
  const cardAfter = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { status: true, currentVersion: true },
  });
  check("R1b : résultat toujours PUBLISHED à 11.33 après refus",
    sprAfter?.status === "PUBLISHED" && sprAfter?.generalAverage === 11.33);
  check("R1c : bulletin toujours PUBLISHED v1 après refus",
    cardAfter?.status === "PUBLISHED" && cardAfter?.currentVersion === 1);

  // R2 — coefficient modifiable (P2 documenté, hors périmètre) + recalcul toujours refusé
  const coef = await setLevelCoefficient(ctx, { subjectId: subject.id, levelId: level.id, coefficient: 5 });
  note(`R2 : coefficient modifiable post-verrouillage = ${coef.ok} (P2 documenté — effet neutralisé par le blocage du recalcul)`);
  const c2b = await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  check("R2b : recalcul après changement de coefficient toujours refusé",
    !c2b.ok && c2b.error === "PERIOD_LOCKED");

  // R2c — génération ordinaire de bulletin sur période verrouillée
  const g2 = await generateReportCard(ctx, { studentId: st1.id, academicPeriodId: t1.id });
  check("R2c : génération ordinaire de bulletin refusée (PERIOD_LOCKED)",
    !g2.ok && g2.error === "PERIOD_LOCKED");
  const cardV = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t1.id },
    select: { currentVersion: true },
  });
  check("R2d : version du bulletin inchangée (toujours v1)", cardV?.currentVersion === 1);

  // R3 — déclassement du workflow résultats sur période verrouillée
  const st3 = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-03", firstName: "C", lastName: "Trois" } });
  await enrollStudent(ctx, { studentId: st3.id, classroomId: cls2.id, academicYearId: year.id });
  // Calcul de cls2 fait AVANT verrouillage n'est plus possible — la période
  // est déjà verrouillée. On crée le ResultValidation en base pour tester
  // les transitions directement.
  await prisma.resultValidation.create({
    data: {
      schoolId: school.id, classroomId: cls2.id, academicPeriodId: t1.id,
      status: "VALIDATED", computedAt: new Date(), computedById: user.id,
    },
  });
  const rv1 = await setValidationStatus(ctx, { classroomId: cls2.id, academicPeriodId: t1.id, status: "CALCULATED" });
  check("R3 : VALIDATED→CALCULATED refusé sur période verrouillée (PERIOD_LOCKED)",
    !rv1.ok && rv1.error === "PERIOD_LOCKED");
  const rv2 = await setValidationStatus(ctx, { classroomId: cls2.id, academicPeriodId: t1.id, status: "DRAFT" });
  check("R3b : CALCULATED→DRAFT refusé sur période verrouillée (PERIOD_LOCKED)",
    !rv2.ok && rv2.error === "PERIOD_LOCKED");
  const rvState = await prisma.resultValidation.findFirst({
    where: { classroomId: cls2.id, academicPeriodId: t1.id }, select: { status: true },
  });
  check("R3c : statut de validation inchangé (VALIDATED) après refus",
    rvState?.status === "VALIDATED");

  // R3d — VALIDATED→PUBLISHED reste permis (diffusion administrative)
  const rv3 = await setValidationStatus(ctx, { classroomId: cls2.id, academicPeriodId: t1.id, status: "PUBLISHED" });
  check("R3d : VALIDATED→PUBLISHED permis sur période verrouillée", rv3.ok);

  // R4 — rectification : seule voie de régénération post-verrouillage
  const rectNoReason = await rectifyReportCard(ctx, card1!.id, "  ");
  check("R4 : rectification sans motif refusée (INVALID_INPUT)",
    !rectNoReason.ok && rectNoReason.error === "INVALID_INPUT");
  const rect = await rectifyReportCard(ctx, card1!.id, "Correction audit");
  check("R4b : rectification avec motif acceptée sur période verrouillée", rect.ok);
  const cardRect = await prisma.reportCard.findFirst({
    where: { id: card1!.id },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  check("R4c : rectification → v2 créée, statut RECTIFIED, v1 conservée",
    cardRect?.currentVersion === 2 &&
    cardRect?.status === "RECTIFIED" &&
    cardRect?.versions.length === 2 &&
    (cardRect?.versions[0]?.payload as { generalAverage?: number })?.generalAverage === 11.33);

  // R5 — bulletin PUBLISHED : la génération ordinaire est bloquée même sur période OUVERTE
  const rectOpen = await generateReportCard(ctx, { studentId: st1.id, academicPeriodId: t1.id });
  check("R5 : génération ordinaire sur bulletin publié refusée (PERIOD_LOCKED ici)",
    !rectOpen.ok);

  // R6 — nouvel élève inscrit : recalcul toujours refusé → pas d'injection
  const st4 = await prisma.student.create({ data: { schoolId: school.id, matricule: "BIS-04", firstName: "D", lastName: "Quatre" } });
  const e4 = await enrollStudent(ctx, { studentId: st4.id, classroomId: cls.id, academicYearId: year.id });
  await prisma.enrollment.updateMany({
    where: { schoolId: school.id, studentId: st4.id },
    data: { enrolledAt: new Date("2025-10-01") },
  });
  check("R6 : inscription toujours possible (P2 — comportement métier conservé)", e4.ok);
  await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t1.id });
  const sprSt4 = await prisma.studentPeriodResult.findFirst({
    where: { studentId: st4.id, academicPeriodId: t1.id },
    select: { id: true },
  });
  check("R6b : aucun résultat injecté pour le nouvel élève (recalcul refusé)", !sprSt4);

  console.log("\n== Étape 4 : année CLOSED ==");

  // R7 — recalcul annuel sur année fermée
  const an1 = await computeAnnualResults(ctx, closedYear.id);
  check("R7 : computeAnnualResults refusé sur année CLOSED (YEAR_CLOSED)",
    !an1.ok && an1.error === "YEAR_CLOSED");

  // R8 — saisie de notes sur année fermée (évaluation OPEN, période non verrouillée)
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
  check("R8 : saveGrades refusé sur année CLOSED (YEAR_CLOSED)",
    !sg.ok && sg.error === "YEAR_CLOSED");
  const gClosed = await prisma.grade.count({ where: { assessmentId: aC.id } });
  check("R8b : aucune note écrite après refus", gClosed === 0);

  // R9 — recalcul période sur année fermée (même période non verrouillée)
  const c3 = await computeAndStore(ctx, { classroomId: clsClosed.id, academicPeriodId: t1Closed!.id });
  check("R9 : computeAndStore refusé sur année CLOSED (YEAR_CLOSED)",
    !c3.ok && c3.error === "YEAR_CLOSED");

  // R10 — transitions de validation sur année fermée
  await prisma.resultValidation.create({
    data: {
      schoolId: school.id, classroomId: clsClosed.id, academicPeriodId: t1Closed!.id,
      status: "VALIDATED", computedAt: new Date(), computedById: user.id,
    },
  });
  const rvC = await setValidationStatus(ctx, { classroomId: clsClosed.id, academicPeriodId: t1Closed!.id, status: "PUBLISHED" });
  check("R10 : transition de validation refusée sur année CLOSED (YEAR_CLOSED)",
    !rvC.ok && rvC.error === "YEAR_CLOSED");

  // R11 — génération ordinaire de bulletin sur année fermée
  await prisma.studentPeriodResult.create({
    data: {
      schoolId: school.id, academicPeriodId: t1Closed!.id, classroomId: clsClosed.id,
      studentId: stC.id, generalAverage: 12, totalCoefficients: 2, subjectsCount: 1,
      status: "VALIDATED", computedAt: new Date(), computedById: user.id,
    },
  });
  const gC = await generateReportCard(ctx, { studentId: stC.id, academicPeriodId: t1Closed!.id });
  check("R11 : génération ordinaire refusée sur année CLOSED (YEAR_CLOSED)",
    !gC.ok && gC.error === "YEAR_CLOSED");

  // R12 — updatePeriod refuse sur année close (contrôle existant)
  const up = await updatePeriod(ctx, t1Closed!.id, { isLocked: true });
  check("R12 : updatePeriod refuse sur année CLOSED (contrôle existant)",
    !up.ok && up.error === "YEAR_CLOSED");

  console.log("\n== Étape 5 : non-régression sur période OUVERTE (T2) ==");

  const aT2 = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: t2.id,
      classroomId: cls.id, subjectId: subject.id, typeId: aType.id,
      title: "Devoir T2", date: new Date("2026-02-01"), maxScore: 20,
      status: "VALIDATED", createdById: user.id,
    },
  });
  await prisma.grade.createMany({
    data: [
      { schoolId: school.id, assessmentId: aT2.id, studentId: st1.id, value: 16, status: "ENTERED" },
      { schoolId: school.id, assessmentId: aT2.id, studentId: st2.id, value: 8, status: "ENTERED" },
    ],
  });
  const cT2 = await computeAndStore(ctx, { classroomId: cls.id, academicPeriodId: t2.id });
  check("NR1 : recalcul sur période ouverte : OK", cT2.ok);
  const vT2 = await setValidationStatus(ctx, { classroomId: cls.id, academicPeriodId: t2.id, status: "VALIDATED" });
  check("NR2 : transition VALIDATED sur période ouverte : OK", vT2.ok);
  const gT2 = await generateClassReportCards(ctx, { classroomId: cls.id, academicPeriodId: t2.id });
  check("NR3 : génération de bulletins sur période ouverte : OK",
    gT2.ok && gT2.result.generated > 0);
  const pT2 = await setValidationStatus(ctx, { classroomId: cls.id, academicPeriodId: t2.id, status: "PUBLISHED" });
  check("NR4 : publication sur période ouverte : OK", pT2.ok);

  // Bulletin PUBLISHED sur période OUVERTE : génération ordinaire bloquée,
  // rectification permise avec motif
  const cardT2 = await prisma.reportCard.findFirst({
    where: { studentId: st1.id, academicPeriodId: t2.id }, select: { id: true, status: true },
  });
  const gOrd = await generateReportCard(ctx, { studentId: st1.id, academicPeriodId: t2.id });
  check("NR5 : régénération ordinaire d'un bulletin PUBLISHED refusée (RECTIFICATION_REQUIRED)",
    !gOrd.ok && gOrd.error === "RECTIFICATION_REQUIRED");
  const rectT2 = await rectifyReportCard(ctx, cardT2!.id, "Coquille appréciation");
  check("NR6 : rectification d'un bulletin publié sur période ouverte : OK", rectT2.ok);

  // Annual results sur année OUVERTE : OK
  const an2 = await computeAnnualResults(ctx, year.id);
  check("NR7 : computeAnnualResults sur année ouverte : OK", an2.ok);

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
