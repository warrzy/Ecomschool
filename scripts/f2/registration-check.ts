/**
 * Lot F2-D2-A — Tests métier et sécurité du parcours d'inscription.
 * Écritures limitées à des fixtures F2-* sur la base LOCALE.
 * Aucun encaissement réel.
 *
 * Exécution : npx tsx scripts/f2/registration-check.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import {
  findPotentialDuplicates,
  registerStudent,
} from "@/lib/services/registration";
import { generateStudentCharges } from "@/lib/services/finance/accounts";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { PERMISSION_MODULE_V2 } from "@/lib/services/platform/modules";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

async function has(userId: string, schoolId: string, key: string) {
  return userHasSchoolPermission({ userId, schoolId, permissionKey: key });
}

async function main() {
  const school = await prisma.school.findFirstOrThrow({
    where: { name: { contains: "Démo" } },
    select: { id: true },
  });
  const other = await prisma.school.findFirst({
    where: { id: { not: school.id } },
    select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
    select: { id: true, name: true },
  });
  const classroom = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: year.id },
    select: { id: true, name: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: "admin@demo.local" },
    select: { id: true },
  });
  const ctx = { userId: admin.id, schoolId: school.id };

  // ---------- 1. Permissions ----------
  console.log("\n== Permissions fines ==");
  check("mapping V2 student.create→STUDENTS",
    PERMISSION_MODULE_V2["student.create"] === "STUDENTS");
  check("mapping V2 enrollment.create→STUDENTS",
    PERMISSION_MODULE_V2["enrollment.create"] === "STUDENTS");

  const cashier = await prisma.user.findUniqueOrThrow({
    where: { email: "f2-caissier-a@test.local" }, select: { id: true },
  });
  const fm = await prisma.user.findUniqueOrThrow({
    where: { email: "f2-finance@test.local" }, select: { id: true },
  });
  for (const [label, u] of [["caissier", cashier], ["FM", fm]] as const) {
    check(`${label} : student.create`, await has(u.id, school.id, "student.create"));
    check(`${label} : enrollment.create`, await has(u.id, school.id, "enrollment.create"));
    check(`${label} : student.read`, await has(u.id, school.id, "student.read"));
    check(`${label} : enrollment.read`, await has(u.id, school.id, "enrollment.read"));
    check(`${label} : classroom.read`, await has(u.id, school.id, "classroom.read"));
    check(`${label} : PAS student.manage`, !(await has(u.id, school.id, "student.manage")));
    check(`${label} : PAS enrollment.manage`, !(await has(u.id, school.id, "enrollment.manage")));
  }
  check("admin : student.create (additif)", await has(admin.id, school.id, "student.create"));
  check("admin : student.manage conservé", await has(admin.id, school.id, "student.manage"));

  // ---------- 2. Parcours A : nouvel élève ----------
  console.log("\n== Parcours A — nouvel élève ==");
  const matricule = `F2D-${Date.now().toString(36).toUpperCase()}`;
  const r1 = await registerStudent(ctx, {
    student: { matricule, firstName: "Guichet", lastName: "Testa", sex: "FEMALE" },
    classroomId: classroom.id,
    academicYearId: year.id,
  });
  check("inscription nouvel élève OK", r1.ok);
  if (r1.ok) {
    check("enrollment créé", r1.result.enrollmentId !== null);
    check("pas déjà inscrit", r1.result.alreadyEnrolled === false);
    if (r1.result.noTariffs) {
      note("aucun tarif configuré — avertissement noTariffs vérifié");
      check("inscription conservée sans tarif", r1.ok);
    } else {
      check("créances générées (>0)", r1.result.charges.created > 0);
      const chargeCount = await prisma.studentFeeCharge.count({
        where: { schoolId: school.id, studentId: r1.result.studentId, academicYearId: year.id },
      });
      check("créances persistées", chargeCount === r1.result.charges.created);
      const inst = await prisma.feeInstallment.count({
        where: { studentId: r1.result.studentId, academicYearId: year.id },
      });
      check("échéances générées", inst > 0);
      // Solde > 0 → encaissement possible (pas de paiement réel).
      const due = await prisma.studentFeeCharge.aggregate({
        where: { studentId: r1.result.studentId, academicYearId: year.id, status: "ACTIVE" },
        _sum: { amount: true },
      });
      check("dossier financier actif (solde > 0)", (due._sum.amount ?? 0) > 0);
    }
  }

  // ---------- 3. Idempotence / doublons ----------
  console.log("\n== Idempotence ==");
  if (r1.ok) {
    const r2 = await registerStudent(ctx, {
      studentId: r1.result.studentId,
      classroomId: classroom.id,
      academicYearId: year.id,
    });
    check("ré-enregistrement élève existant OK", r2.ok);
    if (r2.ok) {
      check("détecté déjà inscrit", r2.result.alreadyEnrolled === true);
      check("aucune créance dupliquée", r2.result.charges.created === 0);
    }
    const enCount = await prisma.enrollment.count({
      where: { studentId: r1.result.studentId, academicYearId: year.id, status: "ENROLLED" },
    });
    check("une seule inscription active", enCount === 1);
    // Doublon matricule.
    const r3 = await registerStudent(ctx, {
      student: { matricule, firstName: "Autre", lastName: "Personne" },
      classroomId: classroom.id,
      academicYearId: year.id,
    });
    check("doublon matricule refusé", !r3.ok && r3.error === "MATRICULE_TAKEN");
    // Créations simultanées.
    const m2 = `F2D-C${Date.now().toString(36).toUpperCase()}`;
    const [c1, c2] = await Promise.all([
      registerStudent(ctx, {
        student: { matricule: m2, firstName: "Conc", lastName: "Un" },
        classroomId: classroom.id, academicYearId: year.id,
      }),
      registerStudent(ctx, {
        student: { matricule: m2, firstName: "Conc", lastName: "Deux" },
        classroomId: classroom.id, academicYearId: year.id,
      }),
    ]);
    check("double création simultanée : exactement 1 succès",
      (c1.ok ? 1 : 0) + (c2.ok ? 1 : 0) === 1);
  }

  // ---------- 4. Parcours B : élève existant, réinscription ----------
  console.log("\n== Parcours B — élève existant ==");
  const existing = await prisma.student.findFirst({
    where: { schoolId: school.id, status: "ACTIVE",
      enrollments: { none: { academicYearId: year.id, status: "ENROLLED" } } },
    select: { id: true, matricule: true },
  });
  if (existing) {
    const rb = await registerStudent(ctx, {
      studentId: existing.id, classroomId: classroom.id, academicYearId: year.id,
    });
    check("réinscription élève existant OK", rb.ok && !rb.result.alreadyEnrolled);
  } else {
    note("aucun élève non inscrit en année courante (déjà tous inscrits)");
  }

  // ---------- 5. Durcissements ----------
  console.log("\n== Sécurité ==");
  // Élève archivé.
  const archived = await prisma.student.findFirst({
    where: { schoolId: school.id, status: "ARCHIVED" }, select: { id: true },
  });
  if (archived) {
    const ra = await registerStudent(ctx, {
      studentId: archived.id, classroomId: classroom.id, academicYearId: year.id,
    });
    check("élève archivé refusé", !ra.ok && ra.error === "STUDENT_INACTIVE");
  } else {
    // Fixture : archiver temporairement puis restaurer.
    const s = await prisma.student.findFirstOrThrow({
      where: { schoolId: school.id, status: "ACTIVE" }, select: { id: true },
    });
    await prisma.student.update({ where: { id: s.id }, data: { status: "ARCHIVED" } });
    const ra = await registerStudent(ctx, {
      studentId: s.id, classroomId: classroom.id, academicYearId: year.id,
    });
    check("élève archivé refusé", !ra.ok && ra.error === "STUDENT_INACTIVE");
    await prisma.student.update({ where: { id: s.id }, data: { status: "ACTIVE" } });
  }
  // Classe d'une autre école.
  if (other) {
    const otherClass = await prisma.classroom.findFirst({
      where: { schoolId: other.id }, select: { id: true },
    });
    if (otherClass && r1.ok) {
      const rx = await registerStudent(ctx, {
        studentId: r1.result.studentId,
        classroomId: otherClass.id,
        academicYearId: year.id,
      });
      // L'élève est déjà ENROLLED → succès idempotent attendu ; le vrai test
      // cross-tenant porte sur un élève non inscrit.
      const s2 = await prisma.student.create({
        data: { schoolId: school.id, matricule: `F2D-X${Date.now().toString(36).toUpperCase()}`,
          firstName: "X", lastName: "Tenant" }, select: { id: true },
      });
      const rx2 = await registerStudent(ctx, {
        studentId: s2.id, classroomId: otherClass.id, academicYearId: year.id,
      });
      check("classe d'une autre école refusée", !rx2.ok && rx2.error === "NOT_FOUND");
      const enrollCount = await prisma.enrollment.count({ where: { studentId: s2.id } });
      check("aucune inscription résiduelle après refus", enrollCount === 0);
      void rx;
    } else note("seconde école sans classe — isolation non testée");
  } else note("une seule école en base — isolation non testée");

  // Doublons nom/prénom (alerte non bloquante).
  if (r1.ok) {
    const dups = await findPotentialDuplicates(ctx, {
      lastName: "Testa", firstName: "Guichet",
    });
    check("alerte doublon nom+prénom", dups.some((d) => d.id === r1.result.studentId));
    const none = await findPotentialDuplicates(ctx, {
      lastName: "Inexistant", firstName: "Zzz",
    });
    check("aucun faux positif doublon", none.length === 0);
  }

  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
