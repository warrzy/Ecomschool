/** Recette RH-4 — avances ≤ 30 % du net, FIFO, idempotence sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { createRun, computeRun, getRun, grantAdvance, listAdvances, cancelAdvance } from "@/lib/services/hr/payroll";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH4 A", code: `RH4A${ts}`, slug: `rh4a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `rh4-${ts}@t.l`, passwordHash: "x" } });
  const v = await prisma.user.create({ data: { email: `rh4r-${ts}@t.l`, passwordHash: "x" } });
  const mk = async (userId: string, keys: string[], tag: string) => {
    const role = await prisma.role.create({ data: { name: `RH4_${tag}${userId.slice(-4)}`, scope: "SCHOOL", schoolId: A.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId, schoolId: A.id, roleId: role.id } });
  };
  await mk(u.id, ["hr.manage", "payroll.manage", "payroll.read"], "a");
  await mk(v.id, ["payroll.read"], "r");
  const ctx = { userId: u.id, schoolId: A.id }, ctxR = { userId: v.id, schoolId: A.id };

  const e = await createEmployee(ctx, { matricule: "A1", firstName: "S", lastName: "N", category: "NON_TEACHING" });
  const emp = e.ok ? e.result.id : "";
  await createContract(ctx, emp, { type: "CDI", position: "Comptable", startDate: new Date("2025-09-01"), baseSalary: 100000, activate: true });

  console.log("== Avances ==");
  const a1 = await grantAdvance(ctx, emp, { amount: 50000, date: new Date("2026-01-10"), reason: "frais" });
  check("avance 50k octroyée", a1.ok === true);
  const a2 = await grantAdvance(ctx, emp, { amount: 20000, date: new Date("2026-01-15") });
  check("2e avance 20k", a2.ok === true);
  const denied = await grantAdvance(ctxR, emp, { amount: 1, date: new Date() });
  check("octroi refusé en lecture seule", !denied.ok && denied.error === "FORBIDDEN");

  const run = await createRun(ctx, { periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  const runId = run.ok ? run.result.id : "";
  await computeRun(ctx, runId);
  const det = await getRun(ctx, runId);
  const slip = det.ok ? det.result.payslips[0] : undefined;
  // net avant avances 100000 → cap 30% = 30000 → recouvre 30k de la 1re avance (FIFO)
  check("retenue avance = 30000 (cap 30%)", slip?.deductions === 30000);
  check("net = 70000 (jamais < 70%)", slip?.net === 70000);
  const lines = slip?.lines as { code: string; amount: number }[];
  check("ligne AVANCE présente", lines?.some((l) => l.code === "AVANCE" && l.amount === 30000) === true);
  const ad1 = await prisma.advance.findUnique({ where: { id: a1.ok ? a1.result.id : "" } });
  check("restant 1re avance = 20000", ad1?.remaining === 20000 && ad1?.status === "RECOVERING");
  const ad2 = await prisma.advance.findUnique({ where: { id: a2.ok ? a2.result.id : "" } });
  check("2e avance intacte (FIFO)", ad2?.remaining === 20000);

  const cx = await cancelAdvance(ctx, a1.ok ? a1.result.id : "");
  check("annulation avance recouvrée refusée", !cx.ok && cx.error === "NOT_FOUND_OR_LOCKED");

  console.log("== Mois 2 : fin de recouvrement ==");
  const run2 = await createRun(ctx, { periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") });
  await computeRun(ctx, run2.ok ? run2.result.id : "");
  const det2 = await getRun(ctx, run2.ok ? run2.result.id : "");
  const slip2 = det2.ok ? det2.result.payslips[0] : undefined;
  // cap 30000 → prend 20000 (fin a1) + 10000 (a2)
  check("retenue mois 2 = 30000 (20k+10k)", slip2?.deductions === 30000);
  const ad1b = await prisma.advance.findUnique({ where: { id: a1.ok ? a1.result.id : "" } });
  check("1re avance soldée", ad1b?.remaining === 0 && ad1b?.status === "RECOVERED");
  const recs = await prisma.advanceRecovery.count({ where: { advance: { employeeId: emp } } });
  check("3 recouvrements total (30k=1 puis 20k+10k)", recs === 3);

  const comp2 = await computeRun(ctx, run2.ok ? run2.result.id : "");
  check("recalcul sans double recouvrement", comp2.ok === true);
  const recs2 = await prisma.advanceRecovery.count({ where: { advance: { employeeId: emp } } });
  check("recouvrements inchangés après recalcul", recs2 === 3);
  const det2b = await getRun(ctx, run2.ok ? run2.result.id : "");
  check("net mois 2 stable après recalcul", det2b.ok === true && det2b.result.payslips[0].net === slip2?.net);

  const list = await listAdvances(ctx);
  check("liste 2 avances", list.ok === true && list.result.length === 2);
  const listB = await listAdvances({ userId: u.id, schoolId: (await prisma.school.create({ data: { name: "B", code: `RH4B${ts}`, slug: `rh4b-${ts}` } })).id });
  check("isolation B", !listB.ok && listB.error === "FORBIDDEN");

  console.log(`\n=== RH-4 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
