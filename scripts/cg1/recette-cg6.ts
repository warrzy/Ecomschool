/** Recette CG-6 — à-nouveaux + bascule ACCRUAL sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, closeExercise, createManualEntry, trialBalance } from "@/lib/services/accounting";
import { carryForward, migrateToAccrual } from "@/lib/services/accounting/closing";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "CG6 A", code: `CG6A${ts}`, slug: `cg6a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `cg6-${ts}@test.local`, passwordHash: "x" } });
  const role = await prisma.role.create({ data: { name: `CG6_${ts}`, scope: "SCHOOL", schoolId: A.id } });
  const perms = await prisma.permission.findMany({ where: { key: { in: ["accounting.read", "accounting.manage"] } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: A.id, roleId: role.id } });
  const ctx = { userId: u.id, schoolId: A.id };

  await installStarterPlan(ctx);
  const acc = async (code: string) => (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code } })).id;
  const od = (await prisma.accountingJournal.findFirstOrThrow({ where: { schoolId: A.id, code: "OD" } })).id;
  check("compte 12 dans le starter", !!(await prisma.accountingAccount.findFirst({ where: { schoolId: A.id, code: "12" } })));

  const ex1 = await openExercise(ctx, { name: "2025", startDate: new Date("2024-09-01"), endDate: new Date("2025-08-31") });
  if (!ex1.ok) throw new Error(ex1.error);
  const [a571, a411, a706, a605, a201, a281] = await Promise.all([acc("571"), acc("411"), acc("706"), acc("605"), acc("201"), acc("281")]);
  // Bilan non trivial : 571 +70k, 411 +50k, 201 +80k, 281 −20k, résultat +120k
  await createManualEntry(ctx, { journalId: od, exerciseId: ex1.result.id, date: new Date("2024-10-01"), description: "e1", lines: [{ accountId: a571, debit: 100000 }, { accountId: a706, credit: 100000 }] });
  await createManualEntry(ctx, { journalId: od, exerciseId: ex1.result.id, date: new Date("2024-10-02"), description: "e2", lines: [{ accountId: a605, debit: 30000 }, { accountId: a571, credit: 30000 }] });
  await createManualEntry(ctx, { journalId: od, exerciseId: ex1.result.id, date: new Date("2024-10-03"), description: "e3", lines: [{ accountId: a411, debit: 50000 }, { accountId: a706, credit: 50000 }] });
  await createManualEntry(ctx, { journalId: od, exerciseId: ex1.result.id, date: new Date("2024-10-04"), description: "immo", lines: [{ accountId: a201, debit: 80000 }, { accountId: a571, credit: 80000 }] });
  await createManualEntry(ctx, { journalId: od, exerciseId: ex1.result.id, date: new Date("2024-10-05"), description: "amort", lines: [{ accountId: a605, debit: 20000 }, { accountId: a281, credit: 20000 }] });

  console.log("== Clôture + à-nouveaux ==");
  const refused = await carryForward(ctx, ex1.result.id, { name: "x", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  check("à-nouveaux sur ex. ouvert refusé", !refused.ok && refused.error === "EXERCISE_NOT_CLOSED");
  await closeExercise(ctx, ex1.result.id);
  const cf = await carryForward(ctx, ex1.result.id, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  check("à-nouveaux OK", cf.ok === true);
  const ex2id = cf.ok ? cf.result.exerciseId : "";
  const op = await prisma.accountingEntry.findFirst({ where: { schoolId: A.id, sourceType: "OPENING" }, include: { lines: true } });
  const d = op?.lines.reduce((s, l) => s + l.debit, 0) ?? -1;
  const c = op?.lines.reduce((s, l) => s + l.credit, 0) ?? -2;
  const a12 = await acc("12");
  check("OPENING équilibrée", d === c && d > 0);
  check("OPENING porte 12 (résultat 100k)", op?.lines.some((l) => l.accountId === a12 && l.credit === 100000));
  check("OPENING reprend 281 créditeur", op?.lines.some((l) => l.accountId === a281 && l.credit === 20000));
  check("OPENING reprend 571 découvert", op?.lines.some((l) => l.accountId === a571 && l.credit === 10000));
  check("OPENING reprend 201 débiteur", op?.lines.some((l) => l.accountId === a201 && l.debit === 80000));
  const cf2 = await carryForward(ctx, ex1.result.id, { name: "2026b", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") });
  check("rejeu à-nouveaux → idempotent", !cf2.ok && cf2.error === "ALREADY_CARRIED");
  const tb2 = await trialBalance(ctx, ex2id);
  check("nouvel exercice : balance équilibrée", tb2.ok === true && tb2.result.totalDebit === tb2.result.totalCredit);

  console.log("== Bascule CASH → ACCRUAL ==");
  const exC = await openExercise(ctx, { name: "CASH", startDate: new Date("2026-09-01"), endDate: new Date("2027-08-31") });
  if (!exC.ok) throw new Error(exC.error);
  const year = await prisma.academicYear.create({ data: { schoolId: A.id, name: "Y6", startDate: new Date("2026-09-01"), endDate: new Date("2027-08-31"), isCurrent: false } });
  const st = await prisma.student.create({ data: { schoolId: A.id, matricule: "CG6-1", firstName: "A", lastName: "B", sex: "MALE" } });
  const cat = await prisma.feeCategory.create({ data: { schoolId: A.id, code: "SC", label: "Sco" } });
  const ch = await prisma.studentFeeCharge.create({ data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, categoryId: cat.id, amount: 50000 } });
  const inst = await prisma.feeInstallment.create({ data: { schoolId: A.id, chargeId: ch.id, studentId: st.id, academicYearId: year.id, dueDate: new Date("2026-10-01"), amount: 50000 } });
  const pay = await prisma.payment.create({ data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, amount: 20000, method: "CASH", paidAt: new Date(), status: "VALIDATED", receiptNumber: "CG6-1" } });
  await prisma.paymentAllocation.create({ data: { paymentId: pay.id, installmentId: inst.id, amount: 20000 } });

  const mig = await migrateToAccrual(ctx, exC.result.id);
  check("bascule OK : 30000 repris", mig.ok === true && mig.result.receivables === 30000 && mig.result.count === 1);
  const migE = await prisma.accountingEntry.findFirst({ where: { schoolId: A.id, sourceType: "MIGRATION_ACCRUAL" }, include: { lines: true } });
  check("OD D411/C12", migE?.lines.some((l) => l.accountId === a411 && l.debit === 30000 && l.thirdPartyId) === true
    && migE?.lines.some((l) => l.credit === 30000) === true);
  const exAfter = await prisma.accountingExercise.findUnique({ where: { id: exC.result.id } });
  check("mode = ACCRUAL", exAfter?.mode === "ACCRUAL");
  const mig2 = await migrateToAccrual(ctx, exC.result.id);
  check("rejeu bascule refusé", !mig2.ok && mig2.error === "ALREADY_ACCRUAL");
  const nMig = await prisma.accountingEntry.count({ where: { schoolId: A.id, sourceType: "MIGRATION_ACCRUAL" } });
  check("1 seule OD de bascule", nMig === 1);
  const closed = await closeExercise(ctx, exC.result.id);
  check("clôture OK (pas de paie → pas de garde)", closed.ok === true);

  console.log(`\n=== CG-6 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
