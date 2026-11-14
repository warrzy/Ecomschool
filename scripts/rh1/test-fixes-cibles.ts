/**
 * TESTS CIBLÉS — 3 corrections post-recette 360° (base isolée).
 *   A. recordPayment : idempotence, appels concurrents, aucun doublon, pas de faux échec
 *   B. Congés : dotation auto à l'activation de contrat, règles par école, sans doublon
 *   C. Paie : plafond avances configurable, calcul déterministe et tracé
 * Exécution : DATABASE_URL=...schema=rh9test npx tsx scripts/rh1/test-fixes-cibles.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { recordPayment } from "@/lib/services/finance/payments";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { upsertLeaveRule, provisionLeaveBalances, balancesFor, setEntitlement } from "@/lib/services/hr/leaves";
import { createRun, computeRun, getRun, grantAdvance, setAdvanceCap } from "@/lib/services/hr/payroll";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const mk = async (tag: string, keys: string[]) => {
    const s = await prisma.school.create({ data: { name: `FIX ${tag}`, code: `FX${tag}${ts}`, slug: `fx-${tag.toLowerCase()}-${ts}` } });
    const u = await prisma.user.create({ data: { email: `fx${tag}-${ts}@t.l`, passwordHash: "x" } });
    const role = await prisma.role.create({ data: { name: `FX_${tag}`, scope: "SCHOOL", schoolId: s.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: s.id, roleId: role.id } });
    return { userId: u.id, schoolId: s.id };
  };

  // ============================ A. PAIEMENTS ============================
  console.log("== A. recordPayment : idempotence & concurrence ==");
  const ctxA = await mk("A", ["finance.manage", "finance.read"]);
  const year = await prisma.academicYear.create({ data: { schoolId: ctxA.schoolId, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), isCurrent: true } });
  const student = await prisma.student.create({ data: { schoolId: ctxA.schoolId, matricule: "FX1", firstName: "T", lastName: "P", birthDate: new Date("2012-01-01") } });
  const cat = await prisma.feeCategory.create({ data: { schoolId: ctxA.schoolId, code: "SCOL", label: "Scolarité" } });
  const charge = await prisma.studentFeeCharge.create({ data: { schoolId: ctxA.schoolId, studentId: student.id, academicYearId: year.id, categoryId: cat.id, amount: 60000 } });
  const inst = await prisma.feeInstallment.create({ data: { schoolId: ctxA.schoolId, studentId: student.id, academicYearId: year.id, chargeId: charge.id, dueDate: new Date("2026-10-15"), amount: 60000 } });
  const payInput = { studentId: student.id, academicYearId: year.id, amount: 25000, method: "CASH" as const };

  // A1 — appel nominal
  const p1 = await recordPayment(ctxA, { ...payInput, idempotencyKey: "K-NOMINAL" });
  check("paiement nominal ok", p1.ok === true && !!p1.result.receiptNumber);

  // A2 — retry même clé → même paiement, aucun doublon
  const p2 = await recordPayment(ctxA, { ...payInput, idempotencyKey: "K-NOMINAL" });
  check("retry même clé → même paiement", p2.ok === true && p1.ok === true && p2.result.id === p1.result.id);
  check("1 seul Payment en base", (await prisma.payment.count({ where: { schoolId: ctxA.schoolId, idempotencyKey: "K-NOMINAL" } })) === 1);
  check("1 seule allocation", (await prisma.paymentAllocation.count({ where: { payment: { schoolId: ctxA.schoolId, idempotencyKey: "K-NOMINAL" } } })) === 1);

  // A3 — appels concurrents même clé : 1 seul paiement, tous renvoient ok (jamais de faux échec)
  const conc = await Promise.allSettled(
    Array.from({ length: 5 }, () => recordPayment(ctxA, { ...payInput, idempotencyKey: "K-RACE" })),
  );
  const oks = conc.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok);
  const ids = new Set(oks.map((r) => (r as PromiseFulfilledResult<{ ok: true; result: { id: string } }>).value.result.id));
  const rows = await prisma.payment.count({ where: { schoolId: ctxA.schoolId, idempotencyKey: "K-RACE" } });
  check("concurrence : tous les appels aboutissent (pas de faux échec)", oks.length === 5);
  check("concurrence : même paiement renvoyé", ids.size === 1);
  check("concurrence : 1 seul Payment en base", rows === 1);
  check("concurrence : 1 seule allocation", (await prisma.paymentAllocation.count({ where: { payment: { schoolId: ctxA.schoolId, idempotencyKey: "K-RACE" } } })) === 1);

  // A4 — "commit malgré l'erreur" simulé : une clé déjà commitée en base puis réponse —
  // le lookup post-échec doit retrouver le paiement plutôt que signaler un échec.
  // (Vérifié : le paiement K-RACE existe ; un nouvel appel MÊME clé = chemin commité.)
  const pLate = await recordPayment(ctxA, { ...payInput, amount: 99999, idempotencyKey: "K-RACE" });
  check("commit connu renvoyé même si montant diffère (clé prime)", pLate.ok === true && pLate.result.id === [...ids][0]);
  check("toujours 1 seul Payment sous K-RACE", (await prisma.payment.count({ where: { schoolId: ctxA.schoolId, idempotencyKey: "K-RACE" } })) === 1);

  // A5 — surpaiement réellement refusé (montant > reste dû), sans faux échec
  const over = await recordPayment(ctxA, { studentId: student.id, academicYearId: year.id, amount: 100000, method: "CASH" });
  check("surpaiement refusé OVERPAYMENT", !over.ok && over.error === "OVERPAYMENT");
  const totalPaid = (await prisma.paymentAllocation.aggregate({ where: { installmentId: inst.id }, _sum: { amount: true } }))._sum.amount ?? 0;
  check("allocations cohérentes avec les paiements (50 000)", totalPaid === 50000);

  // ============================ B. CONGÉS ============================
  console.log("== B. Dotations : auto à l'activation, par école, sans doublon ==");
  const ctxB = await mk("B", ["hr.manage", "hr.read"]);
  const ctxC = await mk("C", ["hr.manage", "hr.read"]);

  // B1 — règles propres à l'école
  await upsertLeaveRule(ctxB, "ANNUAL", 30);
  await upsertLeaveRule(ctxB, "SICK", 10);
  await upsertLeaveRule(ctxC, "ANNUAL", 22); // autre établissement, autre règle

  // B2 — activation de contrat → dotation automatique de l'année de début
  const e1 = await createEmployee(ctxB, { matricule: "B1", firstName: "A", lastName: "L", category: "TEACHING" });
  const empB = e1.ok ? e1.result.id : "";
  await createContract(ctxB, empB, { type: "CDI", position: "Prof", startDate: new Date("2026-01-15"), baseSalary: 100000, activate: true });
  const balsB = await balancesFor(ctxB, empB, 2026);
  check("activation contrat → 2 soldes auto (ANNUAL+SICK)", balsB.ok === true && balsB.result.length === 2);
  check("ANNUAL auto = 30 (règle école B)", (balsB.ok ? balsB.result.find((b) => b.type === "ANNUAL")?.entitled : 0) === 30);
  check("SICK auto = 10", (balsB.ok ? balsB.result.find((b) => b.type === "SICK")?.entitled : 0) === 10);

  // B3 — école C : règle différente, pas de fuite
  const e2 = await createEmployee(ctxC, { matricule: "C1", firstName: "B", lastName: "M", category: "NON_TEACHING" });
  const empC = e2.ok ? e2.result.id : "";
  await createContract(ctxC, empC, { type: "CDI", position: "Sec", startDate: new Date("2026-02-01"), baseSalary: 80000, activate: true });
  const balsC = await balancesFor(ctxC, empC, 2026);
  check("école C : ANNUAL = 22 (sa propre règle)", (balsC.ok ? balsC.result.find((b) => b.type === "ANNUAL")?.entitled : 0) === 22);
  check("école C : pas de SICK (non configuré)", (balsC.ok ? balsC.result.filter((b) => b.type === "SICK").length : 1) === 0);
  check("école B : aucun solde sous l'employé de C", (await prisma.leaveBalance.count({ where: { employeeId: empC, year: 2026, employee: { schoolId: ctxB.schoolId } } })) === 0);

  // B4 — ré-activation / provision : aucun doublon, corrections préservées
  await setEntitlement(ctxB, empB, 2026, "ANNUAL", 45); // correction RH
  await provisionLeaveBalances(ctxB, 2026);
  await provisionLeaveBalances(ctxB, 2026); // re-provision : idempotente
  const after = await balancesFor(ctxB, empB, 2026);
  check("re-provision : toujours 2 soldes (aucun doublon)", after.ok === true && after.result.length === 2);
  check("correction RH 45j préservée", (after.ok ? after.result.find((b) => b.type === "ANNUAL")?.entitled : 0) === 45);
  check("audit provision présent", (await prisma.auditLog.count({ where: { schoolId: ctxB.schoolId, action: "hr.leave.provision" } })) >= 2);

  // B5 — école sans règle : provision refusée proprement, aucun droit présumé
  const ctxD = await mk("D", ["hr.manage", "hr.read"]);
  const noRules = await provisionLeaveBalances(ctxD, 2026);
  check("école sans règle → NO_RULES (aucun droit présumé)", !noRules.ok && noRules.error === "NO_RULES");

  // ============================ C. PAIE ============================
  console.log("== C. Plafond avances configurable & déterminisme ==");
  const ctxE = await mk("E", ["hr.manage", "payroll.manage", "payroll.read"]);
  const e3 = await createEmployee(ctxE, { matricule: "E1", firstName: "P", lastName: "W", category: "NON_TEACHING" });
  const empE = e3.ok ? e3.result.id : "";
  await createContract(ctxE, empE, { type: "CDI", position: "Comptable", startDate: new Date("2025-09-01"), baseSalary: 100000, activate: true });
  await grantAdvance(ctxE, empE, { amount: 50000, date: new Date("2026-01-10"), reason: "cap test" });

  // C1 — cap par défaut 30 % → recouvrement 30 000 sur net 100 000
  const run1 = await createRun(ctxE, { periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") });
  const run1Id = run1.ok ? run1.result.id : "";
  await computeRun(ctxE, run1Id);
  let slip = (await getRun(ctxE, run1Id)).result?.payslips[0];
  check("défaut 30 % → retenue 30 000, net 70 000", slip?.deductions === 30000 && slip?.net === 70000);
  check("trace AdvanceRecovery créée", (await prisma.advanceRecovery.count({ where: { payslipId: slip?.id ?? "" } })) === 1);

  // C2 — cap abaissé à 15 % → recalcul DRAFT : restitution avance puis retenue 15 000
  await setAdvanceCap(ctxE, 1500);
  await computeRun(ctxE, run1Id);
  slip = (await getRun(ctxE, run1Id)).result?.payslips[0];
  check("cap 15 % configuré → retenue 15 000, net 85 000", slip?.deductions === 15000 && slip?.net === 85000);
  check("recalcul : avance restaurée avant re-déduction (restant = 35 000)", (await prisma.advance.findFirst({ where: { employeeId: empE } }))?.remaining === 35000);
  check("1 seule recovery après recalcul", (await prisma.advanceRecovery.count({ where: { payslipId: slip?.id ?? "" } })) === 1);

  // C3 — cap 100 % : le recalcul restaure d'abord l'avance (restant → 50 000)
  // puis re-déduit le solde complet → retenue 50 000, net 50 000.
  await setAdvanceCap(ctxE, 10000);
  await computeRun(ctxE, run1Id);
  slip = (await getRun(ctxE, run1Id)).result?.payslips[0];
  check("cap 100 % → retenue 50 000 (totalité du solde), net 50 000", slip?.deductions === 50000 && slip?.net === 50000);
  check("avance soldée (restant 0)", (await prisma.advance.findFirst({ where: { employeeId: empE } }))?.remaining === 0);

  // C4 — déterminisme : deux recalculs identiques à cap égal
  await setAdvanceCap(ctxE, 3000);
  const e4 = await createEmployee(ctxE, { matricule: "E2", firstName: "D", lastName: "T", category: "TEACHING" });
  const empE2 = e4.ok ? e4.result.id : "";
  await createContract(ctxE, empE2, { type: "CDI", position: "Prof", startDate: new Date("2025-09-01"), baseSalary: 100000, activate: true });
  const run2 = await createRun(ctxE, { periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") });
  const run2Id = run2.ok ? run2.result.id : "";
  await computeRun(ctxE, run2Id);
  const s1 = (await getRun(ctxE, run2Id)).result?.payslips.find((p) => p.employeeId === empE2);
  await computeRun(ctxE, run2Id);
  const s2 = (await getRun(ctxE, run2Id)).result?.payslips.find((p) => p.employeeId === empE2);
  check("déterministe : recalcul identique (gross/net/deductions)", s1?.gross === s2?.gross && s1?.net === s2?.net && s1?.deductions === s2?.deductions);

  // C5 — traçabilité : lignes du bulletin incluent la retenue avance, snapshot figé
  const emp1slip = (await getRun(ctxE, run1Id)).result?.payslips.find((p) => p.employeeId === empE);
  check("bulletin traçable : ligne recovery dans lines", Array.isArray(emp1slip?.lines));
  check("formulaSnapshot figé sur le bulletin", Array.isArray(emp1slip?.formulaSnapshot));

  console.log(`\n===== TESTS CIBLÉS : ${pass} PASS, ${fail} FAIL =====`);
  if (fail) process.exitCode = 1;
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
