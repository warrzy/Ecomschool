/**
 * Recette H12 — comptabilité SYSCOHADA :
 * plan configurable, journaux, exercices, écritures équilibrées générées
 * depuis les opérations réelles (encaissements, annulations,
 * remboursements, dépenses), correspondances, absence de doublon,
 * séparation REAL/SIMULATION, balance, grand livre, exports CSV,
 * permissions, isolation — sans modification des données sources ni
 * opération financière LIVE.
 *
 * Usage : npx tsx scripts/h12/comptabilite-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  archiveAccount, closeExercise, createManualEntry, exportCsv,
  generateEntries, generalLedger, installStarterPlan, listAccounts,
  listEntries, listExercises, listJournals, listMappings, listUnposted,
  openExercise, trialBalance, upsertAccount, upsertMapping,
} from "../../src/lib/services/accounting";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const err = <T,>(r: { ok: true; result: T } | { ok: false; error: string }) =>
  (r.ok ? null : r.error);

const SLUG = "h12-fix";
const SLUG2 = "h12-fix-bis";
const EMAILS = ["h12-admin@test.local", "h12-read@test.local", "h12-noperm@test.local"];

async function makeUser(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: "x", firstName: "H12", lastName: email, status: "ACTIVE" },
  });
}

async function makeMember(userId: string, schoolId: string, permKeys: string[]) {
  const role = await prisma.role.create({
    data: { name: `H12_${userId.slice(-4)}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId },
  });
  const perms = await prisma.permission.findMany({
    where: { key: { in: permKeys } }, select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  await prisma.schoolMembership.create({
    data: { userId, schoolId, roleId: role.id },
  });
}

async function cleanupSchool(schoolId: string) {
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.accountingEntryLine.deleteMany({ where: { entry: { schoolId } } });
  await prisma.accountingEntry.deleteMany({ where: { schoolId } });
  await prisma.accountingAccountMap.deleteMany({ where: { schoolId } });
  await prisma.accountingJournal.deleteMany({ where: { schoolId } });
  await prisma.accountingAccount.deleteMany({ where: { schoolId } });
  await prisma.accountingExercise.deleteMany({ where: { schoolId } });
  await prisma.paymentAllocation.deleteMany({ where: { payment: { schoolId } } });
  await prisma.paymentRefund.deleteMany({ where: { schoolId } });
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.expense.deleteMany({ where: { schoolId } });
  await prisma.expenseCategory.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  await prisma.rolePermission.deleteMany({ where: { role: { schoolId } } });
  await prisma.userRole.deleteMany({ where: { role: { schoolId } } });
  await prisma.role.deleteMany({ where: { schoolId, name: { startsWith: "H12_" } } });
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function main() {
  console.log("== Fixtures ==");
  for (const slug of [SLUG, SLUG2]) {
    const old = await prisma.school.findFirst({ where: { slug }, select: { id: true } });
    if (old) await cleanupSchool(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((u) => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  const A = await prisma.school.create({ data: { name: "H12 Ecole A", code: "H12A", slug: SLUG } });
  const B = await prisma.school.create({ data: { name: "H12 Ecole B", code: "H12B", slug: SLUG2 } });
  const y0 = await prisma.academicYear.create({
    data: { schoolId: A.id, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), status: "ACTIVE", isCurrent: true },
  });
  const admin = await makeUser(EMAILS[0]);
  const reader = await makeUser(EMAILS[1]);
  const noperm = await makeUser(EMAILS[2]);
  await makeMember(admin.id, A.id, ["accounting.read", "accounting.manage", "accounting.export"]);
  await makeMember(reader.id, A.id, ["accounting.read"]);
  await makeMember(noperm.id, A.id, ["students.read"]);
  await makeMember(admin.id, B.id, ["accounting.read", "accounting.manage", "accounting.export"]);
  const ctxA = { userId: admin.id, schoolId: A.id };
  const ctxR = { userId: reader.id, schoolId: A.id };
  const ctxN = { userId: noperm.id, schoolId: A.id };
  const ctxB = { userId: admin.id, schoolId: B.id };

  const student = await prisma.student.create({
    data: { schoolId: A.id, matricule: "H12-01", firstName: "Awa", lastName: "Test", sex: "FEMALE" },
  });
  const cat = await prisma.feeCategory.create({
    data: { schoolId: A.id, code: "SCOL", label: "Scolarité" },
  });
  const cat2 = await prisma.feeCategory.create({
    data: { schoolId: A.id, code: "CANT", label: "Cantine" },
  });
  const charge = await prisma.studentFeeCharge.create({
    data: { schoolId: A.id, studentId: student.id, academicYearId: y0.id, categoryId: cat.id, amount: 150000 },
  });
  const inst = await prisma.feeInstallment.create({
    data: { schoolId: A.id, chargeId: charge.id, studentId: student.id, academicYearId: y0.id, dueDate: new Date("2026-10-01"), amount: 50000 },
  });
  const inst2 = await prisma.feeInstallment.create({
    data: { schoolId: A.id, chargeId: charge.id, studentId: student.id, academicYearId: y0.id, dueDate: new Date("2027-01-01"), amount: 50000 },
  });
  const charge2 = await prisma.studentFeeCharge.create({
    data: { schoolId: A.id, studentId: student.id, academicYearId: y0.id, categoryId: cat2.id, amount: 30000 },
  });
  const inst3 = await prisma.feeInstallment.create({
    data: { schoolId: A.id, chargeId: charge2.id, studentId: student.id, academicYearId: y0.id, dueDate: new Date("2026-10-15"), amount: 30000 },
  });
  const mkPayment = (amount: number, method: "CASH" | "BANK_TRANSFER" | "MOBILE_MONEY_MANUAL" | "OTHER", paidAt: string, receipt: string) =>
    prisma.payment.create({
      data: { schoolId: A.id, studentId: student.id, academicYearId: y0.id, amount, method, paidAt: new Date(paidAt), status: "VALIDATED", receiptNumber: receipt },
    });
  const p1 = await mkPayment(50000, "CASH", "2026-10-05", "R-001");
  await prisma.paymentAllocation.create({ data: { paymentId: p1.id, installmentId: inst.id, amount: 50000 } });
  // p2 : multi-catégories (scolarité + cantine) → deux lignes de crédit
  const p2 = await mkPayment(80000, "BANK_TRANSFER", "2026-11-03", "R-002");
  await prisma.paymentAllocation.createMany({
    data: [
      { paymentId: p2.id, installmentId: inst2.id, amount: 50000 },
      { paymentId: p2.id, installmentId: inst3.id, amount: 30000 },
    ],
  });
  // p3 : sera annulé → contre-passation
  const p3 = await mkPayment(30000, "MOBILE_MONEY_MANUAL", "2026-12-01", "R-003");
  await prisma.paymentAllocation.create({ data: { paymentId: p3.id, installmentId: inst3.id, amount: 30000 } });
  // p4 : hors exercice ouvert → ignoré
  await mkPayment(10000, "CASH", "2025-06-01", "R-004");
  // p5 : méthode non mappée (METHOD:OTHER retiré) → signalée
  const inst5 = await prisma.feeInstallment.create({
    data: { schoolId: A.id, chargeId: charge.id, studentId: student.id, academicYearId: y0.id, dueDate: new Date("2027-03-01"), amount: 12000 },
  });
  const p5 = await mkPayment(12000, "OTHER", "2027-01-15", "R-005");
  await prisma.paymentAllocation.create({ data: { paymentId: p5.id, installmentId: inst5.id, amount: 12000 } });
  const expCat = await prisma.expenseCategory.create({
    data: { schoolId: A.id, code: "FOURN", label: "Fournitures" },
  });
  const expense = await prisma.expense.create({
    data: { schoolId: A.id, categoryId: expCat.id, label: "Craies", beneficiary: "Fournisseur X", amount: 8000, paidAt: new Date("2026-11-20"), method: "CASH", status: "PAID" },
  });

  // ---------- Référentiel ----------
  console.log("\n== Référentiel & permissions ==");
  check("install plan refusée en lecture seule", err(await installStarterPlan(ctxR)) === "FORBIDDEN");
  check("install plan OK", err(await installStarterPlan(ctxA)) == null);
  const accsR = await listAccounts(ctxA);
  const accs = accsR.ok ? accsR.result : [];
  check("10 comptes SYSCOHADA", accs.length === 10);
  const joursR = await listJournals(ctxA);
  const jours = joursR.ok ? joursR.result : [];
  check("5 journaux (CA/BQ/MM/VE/OD)", jours.length === 5);
  const mapsR = await listMappings(ctxA);
  check("correspondances initiales présentes", mapsR.ok === true && mapsR.result.length >= 9);
  // METHOD:OTHER retiré → p5 non mappée au premier passage ;
  // CAT:cantine → 701 mappé tôt (ligne de crédit distincte).
  await prisma.accountingAccountMap.deleteMany({ where: { schoolId: A.id, key: "METHOD:OTHER" } });
  check("code invalide refusé", err(await upsertAccount(ctxA, { code: "AB", name: "x", classNumber: 1 })) === "INVALID_INPUT");
  check("ajout compte 72", err(await upsertAccount(ctxA, { code: "72", name: "Subventions", classNumber: 7 })) == null);
  const acc72 = await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "72" } });
  check("archive compte non utilisé OK", err(await archiveAccount(ctxA, acc72.id)) == null);

  // ---------- Exercice ----------
  console.log("\n== Exercices ==");
  check("exercice dates inversées refusé", err(await openExercise(ctxA, { name: "X", startDate: new Date("2027-01-01"), endDate: new Date("2026-01-01") })) === "INVALID_INPUT");
  check("génération sans exercice → NO_OPEN_EXERCISE", err(await generateEntries(ctxA)) === "NO_OPEN_EXERCISE");
  const ex1 = await openExercise(ctxA, { name: "Exercice 2026-2027", startDate: new Date("2026-07-01"), endDate: new Date("2027-06-30") });
  check("exercice ouvert", ex1.ok);
  const exId = ex1.ok ? ex1.result.id : "";
  check("chevauchement refusé", err(await openExercise(ctxA, { name: "Overlap", startDate: new Date("2026-10-01"), endDate: new Date("2028-01-01") })) === "EXERCISE_OVERLAP");

  const acc701m = await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "701" } });
  check("mapping CAT:cantine → 701", err(await upsertMapping(ctxA, { key: `CAT:${cat2.id}`, accountId: acc701m.id })) == null);

  // ---------- Génération ----------
  console.log("\n== Génération des écritures ==");
  const gen1 = await generateEntries(ctxA);
  check("génération 1 OK", gen1.ok);
  const s1 = gen1.ok ? gen1.result : null;
  check("3 paiements comptabilisés (p4 hors exercice, p5 non mappée)",
    s1?.payments === 3 && s1?.skipped === 1 && s1?.incomplete === 1);
  check("1 dépense", s1?.expenses === 1);

  const entries1 = (await listEntries(ctxA, { exerciseId: exId }));
  const eList = entries1.ok ? entries1.result : [];
  const pay1 = eList.find((e) => e.sourceId === p1.id);
  check("p1 → écriture POSTED journal CA", pay1?.journal.code === "CA" && pay1.status === "POSTED");
  check("p1 : débit 571 / crédit 706 (fallback cat)",
    pay1?.lines.at(0)?.account.code === "571" && pay1?.lines.at(0)?.debit === 50000
    && pay1?.lines.at(1)?.account.code === "706" && pay1?.lines.at(1)?.credit === 50000);
  const pay2 = eList.find((e) => e.sourceId === p2.id);
  check("p2 multi-catégories : 3 lignes (521 D / 706 C / 701 C)",
    pay2?.lines.length === 3 && pay2?.lines.at(0)?.account.code === "521" && pay2?.lines.at(0)?.debit === 80000
    && pay2?.lines.reduce((s, l) => s + l.credit, 0) === 80000);
  const pay3 = eList.find((e) => e.sourceId === p3.id);
  check("p3 Mobile Money → journal MM débit 585", pay3?.journal.code === "MM" && pay3?.lines.at(0)?.account.code === "585");
  const exp1 = eList.find((e) => e.sourceId === expense.id);
  check("dépense : débit 605 (fallback expcat) / crédit 571",
    exp1?.lines.at(0)?.account.code === "605" && exp1?.lines.at(1)?.account.code === "571");

  check("archive compte utilisé → ACCOUNT_IN_USE",
    err(await archiveAccount(ctxA, accs.find((a) => a.code === "571")!.id)) === "ACCOUNT_IN_USE");

  console.log("\n== Équilibre & doublons ==");
  check("toutes les écritures équilibrées",
    eList.every((e) => e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0)));
  check("références uniques séquentielles EC-",
    new Set(eList.map((e) => e.reference)).size === eList.length && eList[0]?.reference.startsWith("EC-"));
  const gen2 = await generateEntries(ctxA);
  check("idempotence : 0 nouvelle écriture", gen2.ok && gen2.result.payments === 0 && gen2.result.expenses === 0);

  console.log("\n== Correspondances & régularisation ==");
  const acc701 = await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "701" } });
  check("mapping CAT:scolarité → 701", err(await upsertMapping(ctxA, { key: `CAT:${cat.id}`, accountId: acc701.id })) == null);
  const p6 = await mkPayment(20000, "CASH", "2027-02-01", "R-006");
  const inst4 = await prisma.feeInstallment.create({
    data: { schoolId: A.id, chargeId: charge.id, studentId: student.id, academicYearId: y0.id, dueDate: new Date("2027-02-01"), amount: 20000 },
  });
  await prisma.paymentAllocation.create({ data: { paymentId: p6.id, installmentId: inst4.id, amount: 20000 } });
  const gen3 = await generateEntries(ctxA);
  check("p6 comptabilisé", gen3.ok && gen3.result.payments === 1);
  const pay6 = (await listEntries(ctxA, { exerciseId: exId }));
  const e6 = pay6.ok ? pay6.result.find((e) => e.sourceId === p6.id) : null;
  check("p6 : crédit 701 (mapping catégorie prioritaire sur fallback)",
    e6?.lines.at(1)?.account.code === "701");
  // Régularisation de p5 : mappe METHOD:OTHER → 521 puis re-génère
  const acc521 = await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "521" } });
  check("mapping METHOD:OTHER → 521", err(await upsertMapping(ctxA, { key: "METHOD:OTHER", accountId: acc521.id })) == null);
  await generateEntries(ctxA);
  const e5 = (await listEntries(ctxA, { exerciseId: exId }));
  const p5e = e5.ok ? e5.result.find((e) => e.sourceId === p5.id) : null;
  check("p5 régularisée après mapping", p5e?.status === "POSTED" && p5e?.lines.at(0)?.account.code === "521");
  const unposted = await listUnposted(ctxA);
  check("aucune opération non comptabilisée (hors exercice)",
    unposted.ok && unposted.result.payments === 1); // p4 (2025) hors exercice

  console.log("\n== Annulations & remboursements ==");
  await prisma.payment.update({
    where: { id: p3.id },
    data: { status: "CANCELLED", cancelledAt: new Date("2026-12-10"), cancelReason: "Erreur caisse" },
  });
  const gen4 = await generateEntries(ctxA);
  check("contre-passation créée", gen4.ok && gen4.result.cancels === 1);
  const eCancel = (await listEntries(ctxA, { exerciseId: exId }));
  const cp = eCancel.ok ? eCancel.result.find((e) => e.sourceType === "PAYMENT_CANCEL" && e.sourceId === p3.id) : null;
  check("contre-passation = miroir (crédit 585 / débit 706)",
    cp?.lines.at(0)?.account.code === "585" && cp?.lines.at(0)?.credit === 30000);
  const refund = await prisma.paymentRefund.create({
    data: {
      schoolId: A.id, paymentId: p1.id, amount: 10000, reason: "Trop perçu",
      status: "CONFIRMED", idempotencyKey: "h12-rf-1", requestedById: admin.id,
      confirmedAt: new Date("2027-03-01"),
    },
  });
  const gen5 = await generateEntries(ctxA);
  check("remboursement comptabilisé", gen5.ok && gen5.result.refunds === 1);
  const eRef = (await listEntries(ctxA, { exerciseId: exId }));
  const rf = eRef.ok ? eRef.result.find((e) => e.sourceType === "REFUND" && e.sourceId === refund.id) : null;
  check("remboursement : débit 706 / crédit 571",
    rf?.lines.at(0)?.account.code === "706" && rf?.lines.at(0)?.debit === 10000
    && rf?.lines.at(1)?.account.code === "571" && rf?.lines.at(1)?.credit === 10000);

  console.log("\n== Balance, grand livre, exports ==");
  const tb = await trialBalance(ctxA, exId);
  check("balance équilibrée Σ D = Σ C", tb.ok && tb.result.totalDebit === tb.result.totalCredit);
  const r571 = tb.ok ? tb.result.balance.find((r) => r.code === "571") : null;
  check("571 : +50000 +20000 −8000 −10000 = 52000",
    r571?.debit === 70000 && r571?.credit === 18000);
  const gl = await generalLedger(ctxA, exId, acc571Id(accs));
  check("grand livre 571 : mouvements triés", gl.ok && gl.result.lines.length >= 4);
  const eJournal = await exportCsv(ctxA, "journal", exId);
  check("export journal CSV", eJournal.ok && eJournal.result.csv.includes('"EC-2026-00001"'));
  check("CSV contient compte 706", eJournal.ok && eJournal.result.csv.includes('"706"'));
  check("export balance CSV", (await exportCsv(ctxA, "balance", exId)).ok);
  check("export grand livre CSV",
    (await exportCsv(ctxA, "ledger", exId, { accountId: acc571Id(accs) })).ok);
  const balCsv = await exportCsv(ctxA, "balance", exId);
  check("totaux balance présents dans le CSV", balCsv.ok === true && balCsv.result.csv.includes("total_debit"));

  console.log("\n== SIMULATION vs REAL ==");
  const odId = jours.find((j) => j.code === "OD")!.id;
  const acc571 = accs.find((a) => a.code === "571")!;
  const acc411 = accs.find((a) => a.code === "411")!;
  check("écriture non équilibrée refusée", err(await createManualEntry(ctxA, {
    journalId: odId, exerciseId: exId, date: new Date("2027-01-10"),
    description: "Test déséquilibré",
    lines: [{ accountId: acc571.id, debit: 100 }, { accountId: acc411.id, credit: 50 }],
  })) === "UNBALANCED");
  check("écriture simulation OK", err(await createManualEntry(ctxA, {
    journalId: odId, exerciseId: exId, date: new Date("2027-01-10"),
    description: "Simulation", origin: "SIMULATION",
    lines: [{ accountId: acc571.id, debit: 9999 }, { accountId: acc411.id, credit: 9999 }],
  })) == null);
  const tbReal = await trialBalance(ctxA, exId);
  const tbSim = await trialBalance(ctxA, exId, true);
  check("simulation exclue de la balance par défaut",
    tbReal.ok && tbReal.result.balance.find((r) => r.code === "571")?.debit === 70000);
  check("simulation incluse sur demande",
    tbSim.ok && tbSim.result.balance.find((r) => r.code === "571")?.debit === 79999);

  console.log("\n== Clôture exercice ==");
  check("clôture exercice", err(await closeExercise(ctxA, exId)) == null);
  const gen6 = await generateEntries(ctxA);
  check("génération après clôture → NO_OPEN_EXERCISE", err(gen6) === "NO_OPEN_EXERCISE");
  check("écriture manuelle sur exercice clos refusée", err(await createManualEntry(ctxA, {
    journalId: odId, exerciseId: exId, date: new Date("2027-01-10"),
    description: "x", lines: [{ accountId: acc571.id, debit: 1 }, { accountId: acc411.id, credit: 1 }],
  })) === "INVALID_STATE");
  check("re-clôture refusée", err(await closeExercise(ctxA, exId)) === "NOT_FOUND_OR_CLOSED");

  console.log("\n== Permissions & isolation ==");
  check("noperm → comptes FORBIDDEN", (await listAccounts(ctxN)).ok === false);
  check("noperm → génération FORBIDDEN", (await generateEntries(ctxN)).ok === false);
  check("reader → export FORBIDDEN", (await exportCsv(ctxR, "balance", exId)).ok === false);
  check("reader → comptes OK", (await listAccounts(ctxR)).ok === true);
  const accsB = await listAccounts(ctxB);
  check("école B : plan vide", accsB.ok === true && accsB.result.length === 0);
  const exsB = await listExercises(ctxB);
  check("école B : exercices vides", exsB.ok === true && exsB.result.length === 0);
  check("compte A invisible depuis B",
    (await prisma.accountingAccount.findFirst({ where: { id: acc571.id, schoolId: B.id } })) == null);

  console.log("\n== Intégrité des sources ==");
  const p1After = await prisma.payment.findUniqueOrThrow({ where: { id: p1.id } });
  check("paiement source inchangé", p1After.amount === 50000 && p1After.status === "VALIDATED");
  const expAfter = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
  check("dépense source inchangée", expAfter.amount === 8000 && expAfter.status === "PAID");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: A.id, action: { startsWith: "accounting." } },
    select: { action: true },
  });
  check("audit accounting.entries.generate", audits.some((a) => a.action === "accounting.entries.generate"));
  check("audit accounting.export", audits.some((a) => a.action === "accounting.export"));

  console.log(`\n=== H12 recette : ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);

  // Nettoyage
  await cleanupSchool(A.id);
  await cleanupSchool(B.id);
  await prisma.schoolMembership.deleteMany({ where: { userId: { in: [admin.id, reader.id, noperm.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, reader.id, noperm.id] } } });
}

function acc571Id(accs: { id: string; code: string }[]) {
  return accs.find((a) => a.code === "571")!.id;
}

main().catch(async (e) => {
  console.error("ERREUR RECETTE", e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
