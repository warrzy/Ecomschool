/** Recette RH-7 + RH-8 — tableau de bord, alertes J-30, sortie transactionnelle, vacations. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise } from "@/lib/services/accounting";
import { createEmployee, createContract, departEmployee } from "@/lib/services/hr/employees";
import { createRun, computeRun } from "@/lib/services/hr/payroll";
import { hrDashboard } from "@/lib/services/hr/dashboard";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH78 A", code: `R78A${ts}`, slug: `r78a-${ts}` } });
  const B = await prisma.school.create({ data: { name: "RH78 B", code: `R78B${ts}`, slug: `r78b-${ts}` } });
  const u = await prisma.user.create({ data: { email: `r78-${ts}@t.l`, passwordHash: "x" } });
  const uNo = await prisma.user.create({ data: { email: `r78n-${ts}@t.l`, passwordHash: "x" } });
  const mk = async (userId: string, schoolId: string, keys: string[], n: string) => {
    const role = await prisma.role.create({ data: { name: `${n}_${ts}`, scope: "SCHOOL", schoolId } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId, schoolId, roleId: role.id } });
  };
  await mk(u.id, A.id, ["hr.read", "hr.manage", "payroll.manage", "accounting.manage"], "R78");
  await mk(uNo.id, A.id, ["payroll.manage"], "R78N");
  const ctx = { userId: u.id, schoolId: A.id };
  await installStarterPlan(ctx);
  await openExercise(ctx, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });

  console.log("== RH-8 : sortie transactionnelle + révocation ==");
  const empUser = await prisma.user.create({ data: { email: `r78e-${ts}@t.l`, passwordHash: "x" } });
  await mk(empUser.id, A.id, ["hr.read"], "R78EMP");
  const e1 = await createEmployee(ctx, { matricule: "E1", firstName: "A", lastName: "B", category: "TEACHING" });
  const emp1 = e1.ok ? e1.result.id : "";
  await prisma.employee.update({ where: { id: emp1 }, data: { userId: empUser.id } });
  await createContract(ctx, emp1, { type: "CDI", position: "Prof", startDate: new Date("2025-09-01"), baseSalary: 80000, activate: true });
  const dep = await departEmployee(ctx, emp1, new Date("2026-01-15"));
  check("départ OK", dep.ok === true);
  const m = await prisma.schoolMembership.findFirst({ where: { userId: empUser.id, schoolId: A.id } });
  check("membership révoquée (INACTIVE)", m?.status === "INACTIVE");
  check("contrat ENDED à la date de sortie", (await prisma.employeeContract.count({ where: { employeeId: emp1, status: "ENDED", endDate: new Date("2026-01-15") } })) >= 1);
  const dep2 = await departEmployee(ctx, emp1, new Date("2026-01-16"));
  check("rejeu départ refusé (idempotent)", !dep2.ok);

  console.log("== RH-8 : vacations = séances DONE vérifiées ==");
  const teacher = await prisma.teacher.create({ data: { schoolId: A.id, firstName: "V", lastName: "Ac" } });
  const ay = await prisma.academicYear.create({ data: { schoolId: A.id, name: "2025-2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") } });
  const lvl = await prisma.level.create({ data: { schoolId: A.id, name: "Tle" } });
  const room = await prisma.classroom.create({ data: { schoolId: A.id, academicYearId: ay.id, levelId: lvl.id, name: "Tle A" } });
  const e2 = await createEmployee(ctx, { matricule: "E2", firstName: "Vac", lastName: "Ataire", category: "TEACHING" });
  const emp2 = e2.ok ? e2.result.id : "";
  await prisma.employee.update({ where: { id: emp2 }, data: { teacherId: teacher.id } });
  await createContract(ctx, emp2, { type: "VACATION", position: "Vacataire", startDate: new Date("2025-09-01"), baseSalary: 5000, activate: true });
  const sess = (d: string, status: "DONE" | "PLANNED" | "CANCELLED") =>
    prisma.courseSession.create({ data: { schoolId: A.id, academicYearId: ay.id, classroomId: room.id, teacherId: teacher.id, date: new Date(d), startMin: 480, endMin: 540, status } });
  await sess("2026-03-02", "DONE"); await sess("2026-03-09", "DONE"); await sess("2026-03-16", "DONE");
  await sess("2026-03-23", "PLANNED"); await sess("2026-03-05", "CANCELLED");
  const run = await createRun(ctx, { periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") });
  const runId = run.ok ? run.result.id : "";
  await computeRun(ctx, runId);
  const slip = await prisma.payslip.findFirst({ where: { runId, employeeId: emp2 } });
  check("vacations = 3 séances DONE × 5000 = 15000", slip?.baseSalary === 15000 && slip.gross === 15000);
  check("ligne SEANCES sur le bulletin", JSON.stringify(slip?.lines ?? []).includes("3 séance"));

  console.log("== RH-7 : tableau de bord ==");
  const e3 = await createEmployee(ctx, { matricule: "E3", firstName: "C", lastName: "DD", category: "NON_TEACHING" });
  const emp3 = e3.ok ? e3.result.id : "";
  const soon = new Date(Date.now() + 15 * 86400_000);
  await createContract(ctx, emp3, { type: "CDD", position: "Agent", startDate: new Date("2025-09-01"), endDate: soon, baseSalary: 60000, activate: true });
  const d = await hrDashboard(ctx);
  check("dashboard OK", d.ok === true);
  if (d.ok) {
    check("effectif actif = 2 (E1 parti)", d.result.headcount === 2);
    check("masse salariale = 5000 + 60000", d.result.payrollMass === 65000);
    const exp = d.result.expiringContracts.filter((c) => c.position === "Agent");
    check("alerte J-30 unique pour le CDD", exp.length === 1 && exp[0].daysLeft !== null && exp[0].daysLeft <= 30);
    check("dernier run visible", d.result.lastRuns.length === 1 && d.result.lastRuns[0].payslips >= 1);
  }
  const denied = await hrDashboard({ userId: uNo.id, schoolId: A.id });
  check("sans hr.read → FORBIDDEN", !denied.ok && denied.error === "FORBIDDEN");
  const dB = await hrDashboard({ userId: uNo.id, schoolId: B.id });
  check("isolation école B", !dB.ok || (dB.ok && dB.result.headcount === 0));

  console.log(`\n=== RH-7/8 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
