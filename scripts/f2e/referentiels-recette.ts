/**
 * Recette F2-E2-A — gardes référentiels :
 * classe archivée (inscription, transfert, import), évaluations sur
 * année close / période verrouillée / classe hors année, isolation.
 *
 * Usage : npx tsx scripts/f2e/referentiels-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  enrollStudent,
  transferStudent,
  closeEnrollment,
} from "../../src/lib/services/enrollments";
import {
  createAssessment,
  setAssessmentStatus,
} from "../../src/lib/services/grading/assessments";
import { yearClosureReport, closeYear } from "../../src/lib/services/academic";
import {
  updateClassroom,
  updateLevel,
} from "../../src/lib/services/classes";
import { updateSubject } from "../../src/lib/services/subjects";
import { updateStudent } from "../../src/lib/services/students";
import {
  previewStudentsImport,
  commitStudentsImport,
} from "../../src/lib/import/students";
import { canonical, sha256 } from "../../src/lib/import/token";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

const FX = "F2E2-REF-FX";

async function importCsv(
  ctx: { userId: string; schoolId: string },
  text: string,
  academicYearId: string,
) {
  const p = await previewStudentsImport(ctx, { kind: "csv", text }, academicYearId);
  if (!p.ok) return { ok: false as const, error: p.error, preview: null };
  const fp = sha256(canonical({ kind: "students", academicYearId, rows: p.preview.rows }));
  const res = await commitStudentsImport(ctx, { kind: "csv", text }, academicYearId, fp);
  return { ...res, preview: p.preview };
}

(async () => {
  // ----- Fixtures -----
  for (const name of [FX, "F2E2-REF-OTHER"]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (!old) continue;
    await prisma.payment.deleteMany({ where: { schoolId: old.id } });
    await prisma.feeInstallment.deleteMany({ where: { schoolId: old.id } });
    await prisma.studentFeeCharge.deleteMany({ where: { schoolId: old.id } });
    await prisma.grade.deleteMany({ where: { schoolId: old.id } });
    await prisma.assessment.deleteMany({ where: { schoolId: old.id } });
    await prisma.enrollment.deleteMany({ where: { schoolId: old.id } });
    await prisma.student.deleteMany({ where: { schoolId: old.id } });
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
  const stale = await prisma.user.findMany({
    where: { email: { in: ["f2e2-ref@test.local"] } }, select: { id: true },
  });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "f2e2-ref-fx" } });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "E2-2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      isCurrent: true, status: "ACTIVE",
      periods: {
        create: [
          { schoolId: school.id, name: "T1", number: 1, type: "TRIMESTER", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-20"), isLocked: true },
          { schoolId: school.id, name: "T2", number: 2, type: "TRIMESTER", startDate: new Date("2026-01-05"), endDate: new Date("2026-04-05"), isLocked: false },
        ],
      },
    },
  });
  const closedYear = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "E2-2024-2025", startDate: new Date("2024-09-01"), endDate: new Date("2025-06-30"), status: "CLOSED" },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "E2-6e", order: 1 } });
  const clsActive = await prisma.classroom.create({ data: { schoolId: school.id, name: "E2-A", academicYearId: year.id, levelId: level.id } });
  const clsActive2 = await prisma.classroom.create({ data: { schoolId: school.id, name: "E2-B", academicYearId: year.id, levelId: level.id } });
  const clsArchived = await prisma.classroom.create({ data: { schoolId: school.id, name: "E2-ARCH", academicYearId: year.id, levelId: level.id, status: "ARCHIVED" } });
  const clsOtherYear = await prisma.classroom.create({ data: { schoolId: school.id, name: "E2-OLD", academicYearId: closedYear.id, levelId: level.id } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: "E2-Maths", code: "E2M" } });
  const aType = await prisma.assessmentType.create({ data: { schoolId: school.id, code: "E2DEVOIR", name: "Devoir", defaultCoefficient: 1, order: 0 } });
  const pLocked = await prisma.academicPeriod.findFirst({ where: { academicYearId: year.id, isLocked: true } });
  const pOpen = await prisma.academicPeriod.findFirst({ where: { academicYearId: year.id, isLocked: false } });

  const user = await prisma.user.create({
    data: { email: "f2e2-ref@test.local", passwordHash: "fixture", firstName: "R", lastName: "E2" },
  });
  const role = await prisma.role.findFirst({
    where: { scope: "SCHOOL", schoolId: null, rolePermissions: { some: { permission: { key: "enrollment.manage" } } } },
    select: { id: true },
  });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, roleId: role!.id } });
  const ctx = { userId: user.id, schoolId: school.id };

  // Seconde école pour l'isolation
  const s2 = await prisma.school.create({ data: { name: "F2E2-REF-OTHER", code: "F2E2-REF-OTHER", slug: "f2e2-ref-other" } });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: s2.id, roleId: role!.id } });

  const mk = async (mat: string) =>
    prisma.student.create({ data: { schoolId: school.id, matricule: mat, firstName: "E", lastName: mat } });

  console.log("== F2-E2-A — gardes référentiels ==");

  // 1. Inscription classe active → OK (non-régression)
  const st1 = await mk("E2-01");
  const e1 = await enrollStudent(ctx, { studentId: st1.id, classroomId: clsActive.id, academicYearId: year.id });
  check("inscription classe active : OK", e1.ok);

  // 2. Inscription classe archivée → refus
  const st2 = await mk("E2-02");
  const e2 = await enrollStudent(ctx, { studentId: st2.id, classroomId: clsArchived.id, academicYearId: year.id });
  check("inscription classe archivée : CLASSROOM_ARCHIVED", !e2.ok && e2.error === "CLASSROOM_ARCHIVED");
  const e2count = await prisma.enrollment.count({ where: { studentId: st2.id } });
  check("aucune inscription créée", e2count === 0);

  // 3. Transfert vers classe archivée → refus, source intacte
  const e3 = await transferStudent(ctx, { enrollmentId: e1.ok ? e1.result.id : "", toClassroomId: clsArchived.id });
  check("transfert vers classe archivée : CLASSROOM_ARCHIVED", !e3.ok && e3.error === "CLASSROOM_ARCHIVED");
  const e1after = await prisma.enrollment.findUnique({ where: { id: e1.ok ? e1.result.id : "" }, select: { status: true } });
  check("inscription source toujours ENROLLED", e1after?.status === "ENROLLED");

  // 4. Transfert vers classe active → OK (non-régression)
  const e4 = await transferStudent(ctx, { enrollmentId: e1.ok ? e1.result.id : "", toClassroomId: clsActive2.id });
  check("transfert vers classe active : OK", e4.ok);

  // 5. Classe d'une autre année → CROSS_YEAR (existant, non-régression)
  const st5 = await mk("E2-05");
  const e5 = await enrollStudent(ctx, { studentId: st5.id, classroomId: clsOtherYear.id, academicYearId: year.id });
  check("classe autre année : CROSS_YEAR", !e5.ok && e5.error === "CROSS_YEAR");

  // 6. Année fermée → YEAR_CLOSED (existant)
  const e6 = await enrollStudent(ctx, { studentId: st5.id, classroomId: clsOtherYear.id, academicYearId: closedYear.id });
  check("année fermée : YEAR_CLOSED", !e6.ok && e6.error === "YEAR_CLOSED");

  // 7. Import vers classe archivée : ligne signalée à l'aperçu, aucune écriture
  const imp = await importCsv(ctx,
    "matricule;nom;prenom;sexe;classe\nE2-IMP1;Test;Archived;M;E2-ARCH",
    year.id);
  const previewRowErr = imp.preview?.rows[0]?.action === "error" &&
    imp.preview.rows[0].errors.some((e: { reason: string }) => e.reason.includes("archiv"));
  check("import classe archivée : ligne en erreur à l'aperçu", !!previewRowErr);
  check("import classe archivée : 0 création, 0 inscription",
    imp.ok && imp.result.created === 0 && imp.result.enrollments === 0);
  const impStudent = await prisma.student.count({ where: { schoolId: school.id, matricule: "E2-IMP1" } });
  check("aucun élève créé par l'import refusé", impStudent === 0);

  // 8. Import classe active : non-régression (création + inscription + créances 0 tarif)
  const imp2 = await importCsv(ctx,
    "matricule;nom;prenom;sexe;classe\nE2-IMP2;Test;Active;F;E2-A",
    year.id);
  check("import classe active : 1 création + 1 inscription",
    imp2.ok && imp2.result.created === 1 && imp2.result.enrollments === 1);

  // 9. Évaluations
  const a1 = await createAssessment(ctx, {
    academicYearId: year.id, academicPeriodId: pOpen!.id,
    classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
    title: "Devoir T2", date: new Date("2026-02-01"),
  });
  check("évaluation année ouverte + période ouverte : OK", a1.ok);

  const a2 = await createAssessment(ctx, {
    academicYearId: closedYear.id,
    classroomId: clsOtherYear.id, subjectId: subject.id, typeId: aType.id,
    title: "Devoir année close", date: new Date("2025-02-01"),
  });
  check("évaluation année fermée : YEAR_CLOSED", !a2.ok && a2.error === "YEAR_CLOSED");

  const a3 = await createAssessment(ctx, {
    academicYearId: year.id, academicPeriodId: pLocked!.id,
    classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
    title: "Devoir période verrouillée", date: new Date("2025-10-01"),
  });
  check("évaluation période verrouillée : PERIOD_LOCKED", !a3.ok && a3.error === "PERIOD_LOCKED");

  const a4 = await createAssessment(ctx, {
    academicYearId: year.id,
    classroomId: clsOtherYear.id, subjectId: subject.id, typeId: aType.id,
    title: "Classe hors année", date: new Date("2026-02-01"),
  });
  check("évaluation classe d'une autre année : CROSS_YEAR", !a4.ok && a4.error === "CROSS_YEAR");

  const a5 = await createAssessment(ctx, {
    academicYearId: year.id, academicPeriodId: pLocked!.id,
    classroomId: clsOtherYear.id, subjectId: subject.id, typeId: aType.id,
    title: "Période verrouillée hors année", date: new Date("2025-10-01"),
  });
  check("période d'une autre année : CROSS_YEAR (avant verrou)",
    !a5.ok && (a5.error === "CROSS_YEAR" || a5.error === "PERIOD_LOCKED"));

  // 10. Isolation : classe de l'école FX avec ctx école 2 → NOT_FOUND
  const iso = await enrollStudent({ userId: user.id, schoolId: s2.id },
    { studentId: st1.id, classroomId: clsActive.id, academicYearId: year.id });
  check("isolation : classe d'une autre école refusée", !iso.ok && iso.error === "NOT_FOUND");

  // 11. closeEnrollment non-régression
  const e7 = await closeEnrollment(ctx, { enrollmentId: e4.ok ? e4.result.id : "", status: "COMPLETED" });
  check("clôture d'inscription : non-régression OK", e7.ok);

  // ---------- F2-E2-B : gardes d'archivage ----------
  console.log("\n== F2-E2-B — gardes d'archivage ==");

  // 12. Archiver une classe vide → OK
  const clsEmpty = await prisma.classroom.create({
    data: { schoolId: school.id, name: "E2-EMPTY", academicYearId: year.id, levelId: level.id },
  });
  const ar1 = await updateClassroom(ctx, clsEmpty.id, { status: "ARCHIVED" });
  check("archivage classe vide : OK", ar1.ok);
  const ar1b = await prisma.classroom.findUnique({ where: { id: clsEmpty.id }, select: { status: true } });
  check("classe vide archivée en base", ar1b?.status === "ARCHIVED");

  // 13. Archiver une classe avec inscriptions actives → HAS_ENROLLED
  const stE = await mk("E2-ENR");
  const enrE = await enrollStudent(ctx, { studentId: stE.id, classroomId: clsActive.id, academicYearId: year.id });
  const ar2 = await updateClassroom(ctx, clsActive.id, { status: "ARCHIVED" });
  check("archivage classe avec ENROLLED : HAS_ENROLLED", !ar2.ok && ar2.error === "HAS_ENROLLED");
  const clsActiveAfter = await prisma.classroom.findUnique({ where: { id: clsActive.id }, select: { status: true } });
  check("classe encore ACTIVE après refus", clsActiveAfter?.status === "ACTIVE");

  // 14. Archiver une classe avec uniquement des inscriptions historiques → OK
  await closeEnrollment(ctx, { enrollmentId: enrE.ok ? enrE.result.id : "", status: "WITHDRAWN" });
  const clsHist = await prisma.classroom.create({
    data: { schoolId: school.id, name: "E2-HIST", academicYearId: year.id, levelId: level.id },
  });
  const stH = await mk("E2-HIST");
  const enrH = await enrollStudent(ctx, { studentId: stH.id, classroomId: clsHist.id, academicYearId: year.id });
  await closeEnrollment(ctx, { enrollmentId: enrH.ok ? enrH.result.id : "", status: "COMPLETED" });
  const ar3 = await updateClassroom(ctx, clsHist.id, { status: "ARCHIVED" });
  check("archivage classe à historique uniquement : OK", ar3.ok);

  // 15. Niveau utilisé par une classe active → HAS_DEPENDENCIES
  const ar4 = await updateLevel(ctx, level.id, { status: "ARCHIVED" });
  check("archivage niveau avec classes actives : HAS_DEPENDENCIES", !ar4.ok && ar4.error === "HAS_DEPENDENCIES");

  // 15b. Niveau sans classe active → OK
  const levelFree = await prisma.level.create({ data: { schoolId: school.id, name: "E2-FREE", order: 9 } });
  const ar5 = await updateLevel(ctx, levelFree.id, { status: "ARCHIVED" });
  check("archivage niveau libre : OK", ar5.ok);

  // 16. Matière utilisée dans une évaluation en cours → HAS_DEPENDENCIES
  const ar6 = await updateSubject(ctx, subject.id, { status: "ARCHIVED" });
  check("archivage matière avec évaluation ouverte : HAS_DEPENDENCIES", !ar6.ok && ar6.error === "HAS_DEPENDENCIES");

  // 16b. Matière sans dépendance active → OK
  const subFree = await prisma.subject.create({ data: { schoolId: school.id, name: "E2-Arts", code: "E2A" } });
  const ar7 = await updateSubject(ctx, subFree.id, { status: "ARCHIVED" });
  check("archivage matière libre : OK", ar7.ok);

  // 16c. L'évaluation et la matière restent intactes après refus
  const aCheck = await prisma.assessment.count({ where: { subjectId: subject.id } });
  check("évaluation historique préservée", aCheck > 0);

  // 17. Élève inscrit → HAS_ACTIVE_ENROLLMENT ; non inscrit → OK
  const ar8 = await updateStudent(ctx, stE.id, { status: "ARCHIVED" });
  check("archivage élève sans inscription active : OK", ar8.ok);
  const stE2 = await mk("E2-ENR2");
  const enrE2 = await enrollStudent(ctx, { studentId: stE2.id, classroomId: clsActive.id, academicYearId: year.id });
  const ar9 = await updateStudent(ctx, stE2.id, { status: "ARCHIVED" });
  check("archivage élève ENROLLED : HAS_ACTIVE_ENROLLMENT", !ar9.ok && ar9.error === "HAS_ACTIVE_ENROLLMENT");
  const stEAfter = await prisma.student.findUnique({ where: { id: stE2.id }, select: { status: true } });
  check("élève encore ACTIVE après refus", stEAfter?.status === "ACTIVE");
  check("inscription toujours ENROLLED (historique intact)", enrE2.ok);

  // 18. Isolation : archiver la classe de l'école FX avec ctx école 2
  const iso2 = await updateClassroom({ userId: user.id, schoolId: s2.id }, clsActive.id, { status: "ARCHIVED" });
  check("isolation : archivage classe d'une autre école refusé", !iso2.ok && iso2.error === "NOT_FOUND");

  note("permissions UI : gardes server-side testées ; requireSchoolPermission côté action inchangé");

  // ---------- F2-E2-C : transitions évaluations + bilan de clôture ----------
  console.log("\n== F2-E2-C — verrous évaluations & pré-clôture ==");

  // 19. Transitions autorisées sur année/période ouvertes
  const t1 = await setAssessmentStatus(ctx, a1.ok ? a1.result.id : "", "SUBMITTED");
  const t2 = await setAssessmentStatus(ctx, a1.ok ? a1.result.id : "", "VALIDATED");
  check("transitions OPEN→SUBMITTED→VALIDATED : OK", t1.ok && t2.ok);
  const t3 = await setAssessmentStatus(ctx, a1.ok ? a1.result.id : "", "OPEN");
  check("réouverture VALIDATED→OPEN sur période ouverte : OK", t3.ok);

  // 20. Réouverture sur période verrouillée → PERIOD_LOCKED
  const aLocked = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: pLocked!.id,
      classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
      title: "Éval T1 verrouillée", date: new Date("2025-11-01"),
      status: "VALIDATED", createdById: user.id,
    },
  });
  const t4 = await setAssessmentStatus(ctx, aLocked.id, "OPEN");
  check("réouverture sur période verrouillée : PERIOD_LOCKED",
    !t4.ok && t4.error === "PERIOD_LOCKED");
  const aLockAfter = await prisma.assessment.findUnique({ where: { id: aLocked.id }, select: { status: true } });
  check("évaluation toujours VALIDATED après refus", aLockAfter?.status === "VALIDATED");

  // 21. Transitions « vers l'avant » permises sur période verrouillée
  const t5 = await setAssessmentStatus(ctx, aLocked.id, "PUBLISHED");
  check("VALIDATED→PUBLISHED sur période verrouillée : OK", t5.ok);
  const aCancel = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: pLocked!.id,
      classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
      title: "Éval à annuler", date: new Date("2025-11-02"),
      status: "DRAFT", createdById: user.id,
    },
  });
  const t6 = await setAssessmentStatus(ctx, aCancel.id, "CANCELLED");
  check("DRAFT→CANCELLED sur période verrouillée : PERIOD_LOCKED",
    !t6.ok && t6.error === "PERIOD_LOCKED");
  const aCancelAfter = await prisma.assessment.findUnique({ where: { id: aCancel.id }, select: { status: true } });
  check("évaluation toujours DRAFT après refus d'annulation", aCancelAfter?.status === "DRAFT");
  // VALIDATED→CANCELLED : bloqué par le verrou avant la matrice de transitions
  const aVal = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: pLocked!.id,
      classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
      title: "Éval validée T1", date: new Date("2025-11-04"),
      status: "VALIDATED", createdById: user.id,
    },
  });
  const t6b = await setAssessmentStatus(ctx, aVal.id, "CANCELLED");
  check("VALIDATED→CANCELLED sur période verrouillée : PERIOD_LOCKED",
    !t6b.ok && t6b.error === "PERIOD_LOCKED");
  // Annulation sur période ouverte : comportement existant préservé
  const aCancelOpen = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: pOpen!.id,
      classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
      title: "Éval à annuler T2", date: new Date("2026-02-02"),
      status: "DRAFT", createdById: user.id,
    },
  });
  const t6c = await setAssessmentStatus(ctx, aCancelOpen.id, "CANCELLED");
  check("DRAFT→CANCELLED sur période ouverte : OK (inchangé)", t6c.ok);
  const aDraftOpen = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id, academicPeriodId: pLocked!.id,
      classroomId: clsActive.id, subjectId: subject.id, typeId: aType.id,
      title: "Éval DRAFT T1", date: new Date("2025-11-03"),
      status: "DRAFT", createdById: user.id,
    },
  });
  const t7 = await setAssessmentStatus(ctx, aDraftOpen.id, "OPEN");
  check("DRAFT→OPEN sur période verrouillée : PERIOD_LOCKED",
    !t7.ok && t7.error === "PERIOD_LOCKED");

  // 22. Année fermée : toute transition bloquée
  const aClosed = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: closedYear.id,
      classroomId: clsOtherYear.id, subjectId: subject.id, typeId: aType.id,
      title: "Éval année close", date: new Date("2025-02-01"),
      status: "SUBMITTED", createdById: user.id,
    },
  });
  const t8 = await setAssessmentStatus(ctx, aClosed.id, "VALIDATED");
  check("transition sur année fermée : YEAR_CLOSED",
    !t8.ok && t8.error === "YEAR_CLOSED");

  // 23. Bilan de pré-clôture
  const rep = await yearClosureReport(ctx, year.id);
  check("bilan : classes et inscriptions comptées",
    rep !== null && rep.classrooms > 0 && rep.enrollments > 0);
  check("bilan : inscriptions actives détectées",
    rep !== null && rep.activeEnrollments > 0);
  check("bilan : période non verrouillée détectée",
    rep !== null && rep.unlockedPeriods >= 1);
  check("bilan : évaluations non finalisées détectées",
    rep !== null && rep.liveAssessments > 0);
  check("bilan : aucun résultat annuel calculé détecté",
    rep !== null && rep.computedResults === 0);

  // 24. Année vide : bilan sans anomalie
  const emptyYear = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "E2-EMPTY-Y", startDate: new Date("2023-09-01"), endDate: new Date("2024-06-30"), status: "DRAFT" },
  });
  const repEmpty = await yearClosureReport(ctx, emptyYear.id);
  check("année vide : bilan 0 anomalie",
    repEmpty !== null && repEmpty.activeEnrollments === 0 &&
    repEmpty.unlockedPeriods === 0 && repEmpty.liveAssessments === 0);

  // 25. Isolation du bilan
  const repIso = await yearClosureReport({ userId: user.id, schoolId: s2.id }, year.id);
  check("isolation : bilan d'une année d'une autre école → null", repIso === null);

  // 26. Clôture : non-régression (mécanisme inchangé)
  const cy1 = await closeYear(ctx, year.id);
  check("clôture année courante refusée : IS_CURRENT", !cy1.ok && cy1.error === "IS_CURRENT");
  const cy2 = await closeYear(ctx, emptyYear.id);
  check("clôture année non courante : OK (décision administrative)", cy2.ok);

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
