/**
 * Recette F2-E1 — génération des créances après import d'élèves.
 * Flux réel : previewStudentsImport → commitStudentsImport (fingerprint
 * recalculé comme dans la route de commit), créances vérifiées en base.
 *
 * Usage : npx tsx scripts/f2e/import-charges-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  previewStudentsImport,
  commitStudentsImport,
} from "../../src/lib/import/students";
import {
  generateStudentCharges,
  missingStudentCharges,
} from "../../src/lib/services/finance/accounts";
import { canonical, sha256 } from "../../src/lib/import/token";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

const FX = "F2E-IMPORT-FX";
const csv = (rows: string[][]) =>
  ["matricule;nom;prenom;sexe;classe", ...rows.map((r) => r.join(";"))].join("\n");

async function fingerprintOf(
  ctx: { userId: string; schoolId: string },
  academicYearId: string,
  text: string,
) {
  const p = await previewStudentsImport(
    ctx,
    { kind: "csv", text },
    academicYearId,
  );
  if (!p.ok) return { error: p.error };
  return {
    hash: sha256(canonical({ kind: "students", academicYearId, rows: p.preview.rows })),
  };
}

async function importCsv(
  ctx: { userId: string; schoolId: string },
  text: string,
  academicYearId: string,
) {
  const fp = await fingerprintOf(ctx, academicYearId, text);
  if ("error" in fp) return { ok: false as const, error: fp.error };
  return commitStudentsImport(
    ctx,
    { kind: "csv", text },
    academicYearId,
    fp.hash,
  );
}

async function fixtures() {
  const olds = await prisma.school.findMany({
    where: { name: { in: [FX, "F2E-IMPORT-NOTAR"] } },
    select: { id: true },
  });
  for (const old of olds) {
    await prisma.payment.deleteMany({ where: { schoolId: old.id } });
    await prisma.feeInstallment.deleteMany({ where: { schoolId: old.id } });
    await prisma.studentFeeCharge.deleteMany({ where: { schoolId: old.id } });
    await prisma.enrollment.deleteMany({ where: { schoolId: old.id } });
    await prisma.student.deleteMany({ where: { schoolId: old.id } });
    await prisma.feeTariff.deleteMany({ where: { schoolId: old.id } });
    await prisma.feeCategory.deleteMany({ where: { schoolId: old.id } });
    await prisma.classroom.deleteMany({ where: { schoolId: old.id } });
    await prisma.level.deleteMany({ where: { schoolId: old.id } });
    await prisma.academicYear.deleteMany({ where: { schoolId: old.id } });
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.auditLog.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }
  const school = await prisma.school.create({
    data: { name: FX, code: FX, slug: "f2e-import-fx" },
  });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "F2E-IMP-2025-2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), isCurrent: true },
  });
  const level = await prisma.level.create({
    data: { schoolId: school.id, name: "F2E-IMP-6e", order: 1 },
  });
  const clsA = await prisma.classroom.create({
    data: { schoolId: school.id, name: "F2EIMP-A", academicYearId: year.id, levelId: level.id },
  });
  const clsB = await prisma.classroom.create({
    data: { schoolId: school.id, name: "F2EIMP-B", academicYearId: year.id, levelId: level.id },
  });
  const clsNoTariff = await prisma.classroom.create({
    data: { schoolId: school.id, name: "F2EIMP-NOTARIFF", academicYearId: year.id, levelId: level.id },
  });

  // Catégories + tarifs : global obligatoire, par classe obligatoire,
  // non obligatoire (ne doit pas être généré).
  const catInsc = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "F2EINSC", label: "Inscription" } });
  const catCant = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "F2ECANT", label: "Cantine" } });
  const catOpt = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "F2EOPT", label: "Option" } });
  await prisma.feeTariff.create({ data: { schoolId: school.id, academicYearId: year.id, categoryId: catInsc.id, amount: 10000, mandatory: true } });
  await prisma.feeTariff.create({ data: { schoolId: school.id, academicYearId: year.id, categoryId: catCant.id, classroomId: clsA.id, amount: 5000, mandatory: true } });
  await prisma.feeTariff.create({ data: { schoolId: school.id, academicYearId: year.id, categoryId: catCant.id, classroomId: clsB.id, amount: 7000, mandatory: true } });
  await prisma.feeTariff.create({ data: { schoolId: school.id, academicYearId: year.id, categoryId: catOpt.id, amount: 2000, mandatory: false } });
  // Classe sans AUCUN tarif applicable : clsNoTariff n'a pas de tarif de classe —
  // mais le tarif global l'atteint. Pour un vrai cas « aucun tarif », on
  // isole via une seconde école sans tarifs plus bas.

  // Utilisateur fixture : membership avec rôle ADMIN_SCHOOL global
  // (student.manage + enrollment.manage).
  const staleUsers = await prisma.user.findMany({
    where: { email: { in: ["f2e-import@test.local", "f2e-import-denied@test.local"] } },
    select: { id: true },
  });
  if (staleUsers.length > 0) {
    const ids = staleUsers.map((u) => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  const role = await prisma.role.findFirst({
    where: {
      scope: "SCHOOL",
      schoolId: null,
      rolePermissions: { some: { permission: { key: "enrollment.manage" } } },
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: "f2e-import@test.local",
      passwordHash: "fixture",
      firstName: "Recette",
      lastName: "F2E1",
    },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, roleId: role!.id },
  });
  // Deuxième utilisateur sans membership → refus enrollment.manage.
  const userDenied = await prisma.user.create({
    data: { email: "f2e-import-denied@test.local", passwordHash: "fixture" },
  });

  return { school, year, level, clsA, clsB, clsNoTariff, catInsc, catCant, catOpt, user, userDenied };
}

const chargesOf = async (schoolId: string, matricule: string, yearId: string) =>
  prisma.studentFeeCharge.findMany({
    where: { schoolId, academicYearId: yearId, student: { matricule } },
    select: { amount: true, category: { select: { code: true } }, status: true },
  });

(async () => {
  const f = await fixtures();
  const ctx = { userId: f.user.id, schoolId: f.school.id };
  console.log("== F2-E1 — import + créances ==");

  // 1. Nouvel élève + inscription classe A → créances global + classe A
  let res = await importCsv(ctx, csv([["F2EIMP-01", "Ouédraogo", "Awa", "F", "F2EIMP-A"]]), f.year.id);
  check("import nouvel élève : 1 création + 1 inscription + 2 créances",
    res.ok && res.result.created === 1 && res.result.enrollments === 1 && res.result.chargesCreated === 2);
  let ch = await chargesOf(f.school.id, "F2EIMP-01", f.year.id);
  check("créances F2EIMP-01 : Inscription 10000 + Cantine A 5000",
    ch.length === 2 && ch.some((c) => c.amount === 10000) && ch.some((c) => c.amount === 5000));
  const inst = await prisma.feeInstallment.count({
    where: { schoolId: f.school.id, charge: { student: { matricule: "F2EIMP-01" } } },
  });
  check("échéances générées pour les créances importées", inst > 0);
  const pay = await prisma.payment.count({
    where: { schoolId: f.school.id, student: { matricule: "F2EIMP-01" } },
  });
  check("aucun encaissement automatique", pay === 0);

  // 2. Deuxième élève classe B → tarif de classe différent
  res = await importCsv(ctx, csv([["F2EIMP-02", "Compaoré", "Boureima", "M", "F2EIMP-B"]]), f.year.id);
  ch = await chargesOf(f.school.id, "F2EIMP-02", f.year.id);
  check("tarif par classe : Cantine B = 7000 (pas 5000)",
    res.ok && ch.some((c) => c.amount === 7000) && !ch.some((c) => c.amount === 5000));
  check("tarif non obligatoire non généré",
    !ch.some((c) => c.category.code === "F2EOPT"));

  // 3. Élève existant non inscrit + import classe → inscription + créances
  await prisma.student.create({
    data: { schoolId: f.school.id, matricule: "F2EIMP-03", firstName: "Issouf", lastName: "Zida" },
  });
  res = await importCsv(ctx, csv([["F2EIMP-03", "", "", "", "F2EIMP-A"]]), f.year.id);
  ch = await chargesOf(f.school.id, "F2EIMP-03", f.year.id);
  check("existant non inscrit → inchangé + inscription + 2 créances",
    res.ok && res.result.unchanged === 1 && res.result.enrollments === 1 && res.result.chargesCreated === 2 && ch.length === 2);

  // 4. Élève déjà inscrit : réimport sans classe → aucune créance nouvelle
  res = await importCsv(ctx, csv([["F2EIMP-01", "", "", "", ""]]), f.year.id);
  check("réimport sans classe : 0 créance nouvelle",
    res.ok && res.result.enrollments === 0 && res.result.chargesCreated === 0);

  // 5. Réimport du même fichier avec classe → déjà inscrit, pas de doublon
  res = await importCsv(ctx, csv([["F2EIMP-01", "", "", "", "F2EIMP-A"]]), f.year.id);
  ch = await chargesOf(f.school.id, "F2EIMP-01", f.year.id);
  check("réimport déjà inscrit : inscription existante, 0 créance, pas de doublon",
    res.ok && res.result.enrollments === 0 && res.result.chargesCreated === 0 && ch.length === 2);

  // 6. Import groupé : 3 élèves en une fois
  res = await importCsv(ctx, csv([
    ["F2EIMP-10", "Kaboré", "Moussa", "M", "F2EIMP-A"],
    ["F2EIMP-11", "Sawadogo", "Fatou", "F", "F2EIMP-B"],
    ["F2EIMP-12", "Nikièma", "Salif", "M", "F2EIMP-A"],
  ]), f.year.id);
  check("import groupé : 3 inscriptions, 6 créances",
    res.ok && res.result.enrollments === 3 && res.result.chargesCreated === 6);

  // 7. Aucun tarif applicable : seconde école sans tarifs
  const s2 = await prisma.school.create({
    data: { name: "F2E-IMPORT-NOTAR", code: "F2E-IMPORT-NOTAR", slug: "f2e-import-notar" },
  });
  const y2 = await prisma.academicYear.create({
    data: { schoolId: s2.id, name: "NT-2025-2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), isCurrent: true },
  });
  const l2 = await prisma.level.create({ data: { schoolId: s2.id, name: "NT-6e", order: 1 } });
  const c2 = await prisma.classroom.create({
    data: { schoolId: s2.id, name: "NT-A", academicYearId: y2.id, levelId: l2.id },
  });
  await prisma.schoolMembership.create({
    data: { userId: f.user.id, schoolId: s2.id, roleId: (await prisma.role.findFirst({ where: { scope: "SCHOOL", schoolId: null, rolePermissions: { some: { permission: { key: "enrollment.manage" } } } }, select: { id: true } }))!.id },
  });
  res = await importCsv({ userId: f.user.id, schoolId: s2.id }, csv([["NT-01", "Traoré", "Assetou", "F", "NT-A"]]), y2.id);
  check("école sans tarifs : inscription conservée + noTariffs=1 + 0 échec",
    res.ok && res.result.enrollments === 1 && res.result.noTariffs === 1 && res.result.chargesFailed === 0);
  const nt = await prisma.student.findFirst({ where: { schoolId: s2.id, matricule: "NT-01" }, select: { id: true } });
  const miss = await missingStudentCharges({ userId: f.user.id, schoolId: s2.id }, { studentId: nt!.id, academicYearId: y2.id });
  check("sans tarifs : missingStudentCharges signale 0 attendue", miss.enrolled && miss.missing === 0);

  // 7b. Reprise : tarif ajouté après import → manquante détectée → reprise
  const catNT = await prisma.feeCategory.create({ data: { schoolId: s2.id, code: "NTFRAIS", label: "Frais NT" } });
  await prisma.feeTariff.create({ data: { schoolId: s2.id, academicYearId: y2.id, categoryId: catNT.id, amount: 4000, mandatory: true } });
  const miss2 = await missingStudentCharges({ userId: f.user.id, schoolId: s2.id }, { studentId: nt!.id, academicYearId: y2.id });
  check("tarif ajouté après import : 1 créance manquante détectée", miss2.missing === 1);
  const rec = await generateStudentCharges({ userId: f.user.id, schoolId: s2.id }, { studentId: nt!.id, academicYearId: y2.id });
  const rec2 = await generateStudentCharges({ userId: f.user.id, schoolId: s2.id }, { studentId: nt!.id, academicYearId: y2.id });
  check("reprise idempotente : créée 1 puis existing sans doublon",
    rec.ok && rec.result.created === 1 && rec2.ok && rec2.result.created === 0 && rec2.result.existing === 1);

  // 8. Permission : utilisateur sans membership → refus enrollment.manage
  res = await importCsv({ userId: f.userDenied.id, schoolId: f.school.id },
    csv([["F2EIMP-20", "Denis", "X", "M", "F2EIMP-A"]]), f.year.id);
  check("utilisateur sans droit inscription : import refusé", !res.ok);
  const deniedStudent = await prisma.student.count({ where: { schoolId: f.school.id, matricule: "F2EIMP-20" } });
  check("aucune écriture pour l'utilisateur refusé", deniedStudent === 0);

  // 9. Isolation : matricule existant dans l'école démo, importé dans F2E
  //    → nouvel élève créé dans F2E, tarifs démo non appliqués.
  const demoStudent = await prisma.student.findFirst({ select: { matricule: true } });
  if (demoStudent) {
    res = await importCsv(ctx, csv([[demoStudent.matricule, "Copie", "Isolation", "F", "F2EIMP-A"]]), f.year.id);
    check("matricule d'une autre école : création isolée, pas de conflit",
      res.ok && res.result.created === 1);
    const createdInFx = await prisma.student.count({ where: { schoolId: f.school.id, matricule: demoStudent.matricule } });
    check("élève créé dans l'école fixture uniquement", createdInFx === 1);
  } else note("isolation : pas d'élève démo disponible");

  // 10. Quota : hors périmètre fixture (aucune souscription = pas de plafond
  //     explicite testable sans fixture de plan).
  note("quotas : non rejoués (le budget abonnement est déjà couvert par analyze/enrollBudget)");

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
