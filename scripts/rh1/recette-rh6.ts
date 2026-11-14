/** Recette RH-6 — rectification de paie : contre-passation, run rectificatif, immuabilité. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, trialBalance } from "@/lib/services/accounting";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { createRun, computeRun, validateRun } from "@/lib/services/hr/payroll";
import { postPayrollToAccounting, rectifyRun } from "@/lib/services/hr/payrollPosting";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH6 A", code: `RH6A${ts}`, slug: `rh6a-${ts}` } });
  const B = await prisma.school.create({ data: { name: "RH6 B", code: `RH6B${ts}`, slug: `rh6b-${ts}` } });
  const u = await prisma.user.create({ data: { email: `rh6-${ts}@t.l`, passwordHash: "x" } });
  const u2 = await prisma.user.create({ data: { email: `rh6b-${ts}@t.l`, passwordHash: "x" } });
  const mk = async (userId: string, schoolId: string, keys: string[]) => {
    const role = await prisma.role.create({ data: { name: `R${ts}_${userId.slice(-4)}`, scope: "SCHOOL", schoolId } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId, schoolId, roleId: role.id } });
  };
  await mk(u.id, A.id, ["hr.manage", "payroll.manage", "payroll.read", "accounting.manage", "accounting.read"]);
  await mk(u2.id, B.id, ["payroll.manage"]);
  const ctx = { userId: u.id, schoolId: A.id };
  const ctxB = { userId: u2.id, schoolId: B.id };

  await installStarterPlan(ctx);
  const ex = await openExercise(ctx, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  if (!ex.ok) throw new Error(ex.error);
  const e = await createEmployee(ctx, { matricule: "S1", firstName: "P", lastName: "D", category: "TEACHING" });
  const emp = e.ok ? e.result.id : "";
  const c = await createContract(ctx, emp, { type: "CDI", position: "Prof", startDate: new Date("2025-09-01"), baseSalary: 100000, activate: true });
  const contractId = c.ok ? c.result.id : "";

  const run = await createRun(ctx, { periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") });
  const runId = run.ok ? run.result.id : "";
  await computeRun(ctx, runId);
  await validateRun(ctx, runId);

  console.log("== Rectification ==");
  const rectEarly = await rectifyRun(ctx, runId);
  check("VALIDATED non posté → rectif sans compta OK", rectEarly.ok === true);
  const newRunId = rectEarly.ok ? rectEarly.result.newRunId : "";
  const oldAfter = await prisma.payrollRun.findUnique({ where: { id: runId } });
  check("ancien run RECTIFIED", oldAfter?.status === "RECTIFIED");
  const newRun = await prisma.payrollRun.findUnique({ where: { id: newRunId } });
  check("nouveau run DRAFT + rectifiesRunId", newRun?.status === "DRAFT" && newRun.rectifiesRunId === runId);
  check("aucune contre-passation (pas d'OD)", (await prisma.accountingEntry.count({ where: { schoolId: A.id, sourceType: "PAYROLL_RECTIF" } })) === 0);

  // Cycle complet sur le run rectificatif → POSTED, puis rectification avec contre-passation.
  await computeRun(ctx, newRunId);
  await validateRun(ctx, newRunId);
  await postPayrollToAccounting(ctx, newRunId);
  const payslipBefore = await prisma.payslip.findFirstOrThrow({ where: { runId: newRunId }, select: { net: true, gross: true } });
  const rect2 = await rectifyRun(ctx, newRunId);
  check("POSTED → rectification OK", rect2.ok === true);
  const rectifEntry = await prisma.accountingEntry.findFirst({
    where: { schoolId: A.id, sourceType: "PAYROLL_RECTIF", sourceId: newRunId }, include: { lines: true },
  });
  check("contre-passation créée", !!rectifEntry);
  check("contre-passation équilibrée", !!rectifEntry && rectifEntry!.lines.reduce((s, l) => s + l.debit, 0) === rectifEntry!.lines.reduce((s, l) => s + l.credit, 0));
  check("contre-passation = C422/D66 (inversée)", rectifEntry?.lines.some((l) => l.debit === 100000) === true);
  const tb = await trialBalance(ctx, ex.result.id);
  check("effet net compte 66 = 0 (OD + contre-OD)", tb.ok === true &&
    (() => { const row = tb.result.balance.find((r: { code: string; debit: number; credit: number }) => r.code === "66"); return row !== undefined && row.debit - row.credit === 0; })());
  const run2After = await prisma.payrollRun.findUnique({ where: { id: newRunId } });
  check("run POSTED passé RECTIFIED", run2After?.status === "RECTIFIED");
  const replay = await rectifyRun(ctx, newRunId);
  check("rejeu refusé (RECTIFIED ≠ VALIDATED/POSTED)", !replay.ok && replay.error === "INVALID_STATE");
  const payslipAfter = await prisma.payslip.findFirstOrThrow({ where: { runId: newRunId }, select: { net: true } });
  check("bulletin historique inchangé", payslipAfter.net === payslipBefore.net);

  console.log("== Sécurité ==");
  const noPerm = await prisma.user.create({ data: { email: `rh6n-${ts}@t.l`, passwordHash: "x" } });
  await mk(noPerm.id, A.id, ["hr.manage"]);
  const denied = await rectifyRun({ userId: noPerm.id, schoolId: A.id }, newRunId);
  check("sans payroll.manage → FORBIDDEN", !denied.ok && denied.error === "FORBIDDEN");
  const cross = await rectifyRun(ctxB, newRunId);
  check("isolation : run école A invisible depuis B", !cross.ok && cross.error === "NOT_FOUND");
  const rectified = await prisma.payrollRun.findFirst({ where: { id: newRunId } });
  check("contractId intact (données conservées)", (await prisma.employeeContract.count({ where: { id: contractId } })) === 1 && rectified !== null);

  console.log(`\n=== RH-6 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
