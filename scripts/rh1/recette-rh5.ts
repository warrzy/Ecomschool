/** Recette RH-5 — OD de paie → compta, garde clôture, M-5 sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, closeExercise, trialBalance, generateEntries } from "@/lib/services/accounting";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { createRun, computeRun, validateRun } from "@/lib/services/hr/payroll";
import { postPayrollToAccounting, linkExpenseToRun } from "@/lib/services/hr/payrollPosting";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH5 A", code: `RH5A${ts}`, slug: `rh5a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `rh5-${ts}@t.l`, passwordHash: "x" } });
  const role = await prisma.role.create({ data: { name: `RH5_${ts}`, scope: "SCHOOL", schoolId: A.id } });
  const perms = await prisma.permission.findMany({ where: { key: { in: ["hr.manage", "payroll.manage", "payroll.read", "accounting.manage", "accounting.read"] } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: A.id, roleId: role.id } });
  const ctx = { userId: u.id, schoolId: A.id };

  await installStarterPlan(ctx); // 66/422/431 présents ?
  check("comptes 422/431 dans le starter", !!(await prisma.accountingAccount.findFirst({ where: { schoolId: A.id, code: "422" } })) && !!(await prisma.accountingAccount.findFirst({ where: { schoolId: A.id, code: "431" } })));
  const ex = await openExercise(ctx, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  if (!ex.ok) throw new Error(ex.error);

  const e = await createEmployee(ctx, { matricule: "S1", firstName: "P", lastName: "D", category: "TEACHING" });
  const emp = e.ok ? e.result.id : "";
  await createContract(ctx, emp, { type: "CDI", position: "Prof", startDate: new Date("2025-09-01"), baseSalary: 100000, activate: true });
  const run = await createRun(ctx, { periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  const runId = run.ok ? run.result.id : "";
  await computeRun(ctx, runId);

  console.log("== Garde clôture (PAYROLL_UNPOSTED) ==");
  const early = await postPayrollToAccounting(ctx, runId);
  check("post avant validation refusé", !early.ok && early.error === "INVALID_STATE");
  await validateRun(ctx, runId);
  const closeBlocked = await closeExercise(ctx, ex.result.id);
  check("clôture bloquée : paie validée non comptabilisée", !closeBlocked.ok && closeBlocked.error === "PAYROLL_UNPOSTED");

  console.log("== OD de paie ==");
  const post = await postPayrollToAccounting(ctx, runId);
  check("OD postée", post.ok === true);
  const entry = await prisma.accountingEntry.findFirst({ where: { schoolId: A.id, sourceType: "PAYROLL", sourceId: runId }, include: { lines: true } });
  const a66 = (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "66" } })).id;
  const a422 = (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "422" } })).id;
  const a431 = (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "431" } })).id;
  check("D66 = brut 100000", entry?.lines.some((l) => l.accountId === a66 && l.debit === 100000) === true);
  check("C422 = net 100000", entry?.lines.some((l) => l.accountId === a422 && l.credit === 100000) === true);
  check("OD équilibrée", entry !== undefined && entry!.lines.reduce((s, l) => s + l.debit, 0) === entry!.lines.reduce((s, l) => s + l.credit, 0));
  const runAfter = await prisma.payrollRun.findUnique({ where: { id: runId } });
  check("run POSTED + postedEntryId", runAfter?.status === "POSTED" && runAfter.postedEntryId === entry?.id);
  const repost = await postPayrollToAccounting(ctx, runId);
  check("rejeu refusé (idempotent)", !repost.ok && repost.error === "INVALID_STATE");
  check("1 seule OD PAYROLL", (await prisma.accountingEntry.count({ where: { schoolId: A.id, sourceType: "PAYROLL" } })) === 1);
  const close2 = await closeExercise(ctx, ex.result.id);
  check("clôture débloquée après comptabilisation", close2.ok === true);

  console.log("== M-5 : dépense salariale liée ==");
  const ex2 = await openExercise(ctx, { name: "2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-08-31") });
  if (!ex2.ok) throw new Error(ex2.error);
  const cat = await prisma.expenseCategory.create({ data: { schoolId: A.id, code: "SAL", label: "Salaires" } });
  const dep = await prisma.expense.create({
    data: { schoolId: A.id, categoryId: cat.id, label: "Salaires janvier", amount: 100000, beneficiary: "Equipe",
      expenseAt: new Date("2026-10-05"), paidAt: new Date("2026-10-05"), method: "CASH", status: "PAID" },
  });
  await linkExpenseToRun(ctx, dep.id, runId);
  const gen = await generateEntries(ctx);
  check("dépense liée non comptabilisée", gen.ok === true && gen.result.expenses === 0);
  check("aucune écriture EXPENSE pour cette dépense", (await prisma.accountingEntry.count({ where: { schoolId: A.id, sourceType: "EXPENSE", sourceId: dep.id } })) === 0);
  const tb = await trialBalance(ctx, ex2.result.id);
  check("balance nouvelle ex vide (rien d'inventé)", tb.ok === true && tb.result.totalDebit === 0);

  console.log(`\n=== RH-5 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
