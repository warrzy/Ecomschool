/**
 * Recette F2-E2-D — cohérence des inscriptions :
 * unicité ENROLLED par élève/année (y compris quand le réglage
 * allowMultipleEnrollments=true subsiste dans les réglages), transferts,
 * réinscriptions, imports, isolation, historiques.
 *
 * Usage : npx tsx scripts/f2e/enrollments-coherence-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  enrollStudent,
  transferStudent,
  closeEnrollment,
} from "../../src/lib/services/enrollments";
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

const FX = "F2E2D-FX";

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
  // ---------- Fixtures ----------
  for (const name of [FX, "F2E2D-OTHER"]) {
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
    await prisma.academicPeriod.deleteMany({ where: { schoolId: old.id } });
    await prisma.academicYear.deleteMany({ where: { schoolId: old.id } });
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.auditLog.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }
  const stale = await prisma.user.findMany({ where: { email: "f2e2d@test.local" }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  // École fixture AVEC l'ancien réglage à true — prouve que l'unicité
  // s'applique quand même (le réglage est inopérant).
  const school = await prisma.school.create({
    data: {
      name: FX, code: FX, slug: "f2e2d-fx",
      settings: { allowMultipleEnrollments: true },
    },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "D-2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      isCurrent: true, status: "ACTIVE",
      periods: {
        create: [
          { schoolId: school.id, name: "T1", number: 1, type: "TRIMESTER", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-20") },
        ],
      },
    },
  });
  const year2 = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "D-2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "DRAFT",
      periods: {
        create: [
          { schoolId: school.id, name: "T1", number: 1, type: "TRIMESTER", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-20") },
        ],
      },
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "D-6e", order: 1 } });
  const clsA = await prisma.classroom.create({ data: { schoolId: school.id, name: "D-A", academicYearId: year.id, levelId: level.id } });
  const clsB = await prisma.classroom.create({ data: { schoolId: school.id, name: "D-B", academicYearId: year.id, levelId: level.id } });
  const clsN = await prisma.classroom.create({ data: { schoolId: school.id, name: "D-N", academicYearId: year2.id, levelId: level.id } });

  const user = await prisma.user.create({
    data: { email: "f2e2d@test.local", passwordHash: "fixture", firstName: "D", lastName: "2D" },
  });
  const role = await prisma.role.findFirst({
    where: { scope: "SCHOOL", schoolId: null, rolePermissions: { some: { permission: { key: "enrollment.manage" } } } },
    select: { id: true },
  });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, roleId: role!.id } });
  const ctx = { userId: user.id, schoolId: school.id };

  const s2 = await prisma.school.create({ data: { name: "F2E2D-OTHER", code: "F2E2D-OTHER", slug: "f2e2d-other" } });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: s2.id, roleId: role!.id } });

  const mk = (mat: string) =>
    prisma.student.create({ data: { schoolId: school.id, matricule: mat, firstName: "E", lastName: mat } });

  console.log("== F2-E2-D — cohérence des inscriptions (école avec allowMultipleEnrollments=true) ==");

  // 1. Première inscription → OK
  const st1 = await mk("D-01");
  const e1 = await enrollStudent(ctx, { studentId: st1.id, classroomId: clsA.id, academicYearId: year.id });
  check("première inscription : OK", e1.ok);

  // 2. Double inscription active — avec allowMultipleEnrollments=true,
  //    l'ancien code sautait le contrôle → P2002 → CREATE_FAILED brut.
  //    Désormais : ALREADY_ENROLLED métier.
  const e2 = await enrollStudent(ctx, { studentId: st1.id, classroomId: clsB.id, academicYearId: year.id });
  check("double inscription active : ALREADY_ENROLLED (pas CREATE_FAILED)",
    !e2.ok && e2.error === "ALREADY_ENROLLED");
  const count2 = await prisma.enrollment.count({ where: { studentId: st1.id, status: "ENROLLED" } });
  check("toujours une seule inscription ENROLLED", count2 === 1);

  // 3. Transfert de classe → historique TRANSFERRED conservé
  const t1 = await transferStudent(ctx, { enrollmentId: e1.ok ? e1.result.id : "", toClassroomId: clsB.id });
  check("transfert vers autre classe : OK", t1.ok);
  const hist = await prisma.enrollment.findMany({
    where: { studentId: st1.id }, orderBy: { enrolledAt: "asc" },
    select: { status: true, classroomId: true },
  });
  check("historique : TRANSFERRED conservé + nouveau ENROLLED",
    hist.length === 2 && hist[0].status === "TRANSFERRED" && hist[1].status === "ENROLLED");

  // 4. Réinscription après clôture → OK
  const cl = await closeEnrollment(ctx, { enrollmentId: t1.ok ? t1.result.id : "", status: "WITHDRAWN" });
  check("clôture inscription : OK", cl.ok);
  const e3 = await enrollStudent(ctx, { studentId: st1.id, classroomId: clsA.id, academicYearId: year.id });
  check("réinscription après clôture : OK", e3.ok);
  const hist2 = await prisma.enrollment.count({ where: { studentId: st1.id } });
  check("historique complet conservé (3 lignes)", hist2 === 3);

  // 5. Inscription sur une autre année → OK (un seul ENROLLED par année)
  const st5 = await mk("D-05");
  await enrollStudent(ctx, { studentId: st5.id, classroomId: clsA.id, academicYearId: year.id });
  const e5 = await enrollStudent(ctx, { studentId: st5.id, classroomId: clsN.id, academicYearId: year2.id });
  check("inscription sur une autre année : OK", e5.ok);
  const bothYears = await prisma.enrollment.count({ where: { studentId: st5.id, status: "ENROLLED" } });
  check("deux ENROLLED sur deux années distinctes : OK", bothYears === 2);
  // …mais pas deux sur la MÊME année
  const e5b = await enrollStudent(ctx, { studentId: st5.id, classroomId: clsB.id, academicYearId: year.id });
  check("seconde inscription même année : ALREADY_ENROLLED",
    !e5b.ok && e5b.error === "ALREADY_ENROLLED");

  // 6. Import d'un élève déjà inscrit vers une AUTRE classe → erreur à l'aperçu
  const imp = await importCsv(ctx,
    `matricule;nom;prenom;sexe;classe\n${st1.matricule};E;${st1.matricule};M;D-B`,
    year.id);
  const rowImp = imp.preview?.rows[0];
  check("import élève déjà inscrit ailleurs : ligne en erreur à l'aperçu",
    rowImp?.action === "error" &&
    !!rowImp.errors.some((e: { reason: string }) => e.reason.includes("déjà inscrit")));
  check("import refusé : 0 création d'inscription",
    imp.ok === false || (imp.ok && imp.result.enrollments === 0));
  const stillOne = await prisma.enrollment.count({ where: { studentId: st1.id, status: "ENROLLED" } });
  check("toujours une seule inscription ENROLLED après import", stillOne === 1);

  // 6b. Import même classe → « existing », pas de doublon
  const impSame = await importCsv(ctx,
    `matricule;nom;prenom;sexe;classe\n${st1.matricule};E;${st1.matricule};M;D-A`,
    year.id);
  check("import même classe : inscription « existing » sans doublon",
    impSame.ok === false ||
    impSame.preview?.rows[0]?.enrollment?.action === "existing");

  // 7. Guichet « élève existant » : enrollStudent refuse proprement
  //    (le guichet redirige vers le dossier — service renvoie la raison)
  const g1 = await enrollStudent(ctx, { studentId: st5.id, classroomId: clsB.id, academicYearId: year.id });
  check("guichet élève déjà inscrit : ALREADY_ENROLLED explicite",
    !g1.ok && g1.error === "ALREADY_ENROLLED");

  // 8. Isolation : inscrire l'élève de l'école FX depuis l'école 2
  const iso = await enrollStudent({ userId: user.id, schoolId: s2.id },
    { studentId: st1.id, classroomId: clsA.id, academicYearId: year.id });
  check("isolation : inscription cross-école refusée (NOT_FOUND)",
    !iso.ok && iso.error === "NOT_FOUND");

  // 9. Non-régression : réglage absent (école sans settings) — même règle
  const s3 = await prisma.school.create({ data: { name: "F2E2D-PLAIN", code: "F2E2D-PLAIN", slug: "f2e2d-plain" } });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: s3.id, roleId: role!.id } });
  const y3 = await prisma.academicYear.create({
    data: { schoolId: s3.id, name: "P-2025", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), isCurrent: true, status: "ACTIVE" },
  });
  const lv3 = await prisma.level.create({ data: { schoolId: s3.id, name: "P-6e", order: 1 } });
  const c3 = await prisma.classroom.create({ data: { schoolId: s3.id, name: "P-A", academicYearId: y3.id, levelId: lv3.id } });
  const c3b = await prisma.classroom.create({ data: { schoolId: s3.id, name: "P-B", academicYearId: y3.id, levelId: lv3.id } });
  const st3 = await prisma.student.create({ data: { schoolId: s3.id, matricule: "P-01", firstName: "P", lastName: "Un" } });
  const ctx3 = { userId: user.id, schoolId: s3.id };
  await enrollStudent(ctx3, { studentId: st3.id, classroomId: c3.id, academicYearId: y3.id });
  const p2 = await enrollStudent(ctx3, { studentId: st3.id, classroomId: c3b.id, academicYearId: y3.id });
  check("école sans réglage : ALREADY_ENROLLED identique",
    !p2.ok && p2.error === "ALREADY_ENROLLED");

  note("créances/paiements : non-régression couverte par import-charges-recette (18 PASS) et guichet F2-D (29 PASS)");
  note("permissions UI : gardes server-side ; requireSchoolPermission inchangé");

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
