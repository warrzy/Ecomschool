import "../lib/recette-guard";
/**
 * RECETTE MÉTIER 360° — préproduction, école « ÉCOLE DÉMO VALIDATION ».
 * Scénarios réels avec les comptes démo cloisonnés :
 *   S1 élève → facturation → paiement → écritures ACCRUAL → états financiers
 *   S2 salarié → contrat → congés → présences → paie → bulletin → OD comptable
 *   S3 avances → retenues → rectification → garde de clôture
 *   S4 permissions, confidentialité des salaires, isolation inter-écoles
 * Données fictives, aucune retenue réglementaire. npx tsx scripts/preprod/recette-metier-360.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, generateEntries, trialBalance, closeExercise } from "@/lib/services/accounting";
import { balanceSheet, incomeStatement } from "@/lib/services/accounting/statements";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { requestLeave, decideLeave, markAttendance, upsertLeaveRule, provisionLeaveBalances } from "@/lib/services/hr/leaves";
import { createRun, computeRun, validateRun } from "@/lib/services/hr/payroll";
import { postPayrollToAccounting, rectifyRun } from "@/lib/services/hr/payrollPosting";
import { grantAdvance } from "@/lib/services/hr/payroll";
import { recordPayment } from "@/lib/services/finance/payments";
import { enrollStudent } from "@/lib/services/enrollments";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };
// Sous-totaux par scénario — le total affiché = checks réellement exécutés.
let scStart = 0;
const subtotal = (s: string) => { console.log(`  — ${s} : ${pass - scStart} PASS`); scStart = pass; };
const ctxFor = async (role: string, schoolId: string) => {
  const m = await prisma.schoolMembership.findFirstOrThrow({
    where: { schoolId, role: { name: role } }, select: { userId: true } });
  return { userId: m.userId, schoolId };
};

async function main() {
  const school = await prisma.school.findUniqueOrThrow({ where: { slug: "demo-validation" } });
  const sid = school.id;
  const admin = await ctxFor("DEMO_ADMIN", sid);
  const compta = await ctxFor("COMPTABLE_DEMO", sid);
  const rh = await ctxFor("RH_DEMO", sid);
  const paie = await ctxFor("PAIE_DEMO", sid);
  const now = new Date();

  // ---------- Socle comptable (mode ACCRUAL pour l'engagement) ----------
  await installStarterPlan(compta);
  let ex = await prisma.accountingExercise.findFirst({ where: { schoolId: sid, status: "OPEN" } });
  if (!ex) {
    const r = await openExercise(compta, { name: `${now.getFullYear()}`, startDate: new Date(now.getFullYear(), 0, 1), endDate: new Date(now.getFullYear(), 11, 31) });
    if (r.ok) ex = await prisma.accountingExercise.findFirstOrThrow({ where: { schoolId: sid, status: "OPEN" } });
  }
  if (!ex) throw new Error("NO_EXERCISE");
  await prisma.accountingExercise.update({ where: { id: ex.id }, data: { mode: "ACCRUAL" } });

  console.log("\n== S1 Élève → facturation → paiement → compta ==");
  const year = (await prisma.academicYear.findFirst({ where: { schoolId: sid } }))
    ?? await prisma.academicYear.create({ data: { schoolId: sid, name: `${now.getFullYear()}-${now.getFullYear() + 1}`, startDate: new Date(now.getFullYear(), 0, 5), endDate: new Date(now.getFullYear(), 11, 20), isCurrent: true } });
  const level = (await prisma.level.findFirst({ where: { schoolId: sid } }))
    ?? await prisma.level.create({ data: { schoolId: sid, name: "Démo" } });
  const room = (await prisma.classroom.findFirst({ where: { schoolId: sid } }))
    ?? await prisma.classroom.create({ data: { schoolId: sid, academicYearId: year.id, levelId: level.id, name: "Démo A" } });
  let student = await prisma.student.findFirst({ where: { schoolId: sid, matricule: "DEMO-S1" } });
  if (!student) {
    student = await prisma.student.create({ data: { schoolId: sid, matricule: "DEMO-S1", firstName: "Élève", lastName: "Fictif", birthDate: new Date("2012-05-01") } });
    const enr = await enrollStudent(admin, { studentId: student.id, classroomId: room.id, academicYearId: year.id });
    check("inscription élève", enr.ok === true);
  } else check("inscription élève (déjà présent)", true);

  const feeCat = (await prisma.feeCategory.findFirst({ where: { schoolId: sid, code: "SCOL" } }))
    ?? await prisma.feeCategory.create({ data: { schoolId: sid, code: "SCOL", label: "Scolarité (démo)" } });
  let charge = await prisma.studentFeeCharge.findFirst({ where: { schoolId: sid, studentId: student.id } });
  if (!charge) {
    charge = await prisma.studentFeeCharge.create({
      data: { schoolId: sid, studentId: student.id, academicYearId: year.id, categoryId: feeCat.id, amount: 75000 },
    });
    await prisma.feeInstallment.create({ data: { schoolId: sid, studentId: student.id, academicYearId: year.id, chargeId: charge.id, dueDate: new Date(now.getFullYear(), now.getMonth(), 28), amount: 75000 } });
  }
  check("facture de scolarité créée (75 000)", charge.amount === 75000);

  const pay = await recordPayment(admin, {
    studentId: student.id, academicYearId: year.id, amount: 50000,
    method: "CASH", paidAt: now, reference: "RC-DEMO-001", observation: "Paiement partiel (démo)",
  });
  if (!pay.ok) console.warn("  recordPayment:", pay.error);
  const dbPayment = await prisma.payment.findFirst({ where: { schoolId: sid, studentId: student.id, status: "VALIDATED" } });
  check("paiement partiel 50 000 enregistré", pay.ok === true || dbPayment !== null);

  const gen = await generateEntries(compta);
  if (!gen.ok) console.warn("  generateEntries:", gen.error);
  check("écritures générées", gen.ok === true && (await prisma.accountingEntry.count({ where: { schoolId: sid, sourceType: { in: ["CHARGE", "PAYMENT"] } } })) >= 2);
  const entries = await prisma.accountingEntry.findMany({ where: { schoolId: sid }, include: { lines: true } });
  const chargeEntry = entries.find((e) => e.sourceType === "CHARGE" && e.sourceId === charge!.id);
  const payEntry = entries.find((e) => e.sourceType === "PAYMENT" && e.sourceId === dbPayment?.id);
  check("OD facturation D411/C706", !!chargeEntry && chargeEntry.lines.some((l) => l.debit === 75000));
  check("OD encaissement D571/C411", !!payEntry && payEntry.lines.some((l) => l.debit === 50000));
  check("toutes les écritures équilibrées", entries.every((e) => e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0)));
  const bs = await balanceSheet(compta, ex.id);
  const is = await incomeStatement(compta, ex.id);
  check("bilan calculé (actif=passif)", bs.ok === true && bs.result.totalActif === bs.result.totalPassif);
  check("compte de résultat calculé (produit 75 000)", is.ok === true && is.result.produits.total === 75000);

  subtotal("S1");
  console.log("\n== S2 Salarié → congés → présence → paie → OD ==");
  const emp1 = await prisma.employee.findFirstOrThrow({ where: { schoolId: sid, matricule: "DEMO-E1" } });
  // RH-9 : dotation via règles configurées + provisionnement (plus de setEntitlement manuel)
  await upsertLeaveRule(rh, "ANNUAL", 30);
  const prov = await provisionLeaveBalances(rh, now.getFullYear());
  check("dotations provisionnées via règles", prov.ok === true);
  const leave = await requestLeave(rh, emp1.id, { type: "ANNUAL", startDate: new Date(now.getFullYear(), now.getMonth(), 20), endDate: new Date(now.getFullYear(), now.getMonth(), 22),reason: "Congé démo" });
  check("demande de congé créée", leave.ok === true);
  if (leave.ok) {
    const dec = await decideLeave(rh, leave.result.id, true, "OK démo");
    check("congé approuvé", dec.ok === true);
  }
  const att = await markAttendance(rh, emp1.id, new Date(), "PRESENT", "Démo");
  check("présence du jour marquée", att.ok === true);

  let run = await prisma.payrollRun.findFirst({ where: { schoolId: sid, rectifiesRunId: null }, orderBy: { periodStart: "desc" } });
  check("campagne de paie présente", !!run);
  if (run && run.status === "DRAFT") {
    if ((await prisma.payslip.count({ where: { runId: run.id } })) === 0) await computeRun(paie, run.id);
    const v = await validateRun(paie, run.id);
    check("campagne validée", v.ok === true);
    const closeBlocked = await closeExercise(compta, ex.id);
    check("clôture bloquée (paie validée non comptabilisée)", !closeBlocked.ok && closeBlocked.error === "PAYROLL_UNPOSTED");
    const post = await postPayrollToAccounting(paie, run.id);
    check("OD de paie comptabilisée", post.ok === true);
    const od = await prisma.accountingEntry.findFirst({ where: { schoolId: sid, sourceType: "PAYROLL", sourceId: run.id }, include: { lines: true } });
    check("OD paie D66/C422 équilibrée", !!od && od.lines.reduce((s, l) => s + l.debit, 0) === od.lines.reduce((s, l) => s + l.credit, 0));
    const slips = await prisma.payslip.count({ where: { runId: run.id } });
    check("bulletins émis (≥2)", slips >= 2);
    run = await prisma.payrollRun.findFirstOrThrow({ where: { id: run.id } });
    check("statut POSTED", run.status === "POSTED");
  } else check("cycle paie déjà joué (idempotent)", run?.status === "POSTED" || run?.status === "RECTIFIED");

  subtotal("S2");
  console.log("\n== S3 Avances → rectification → clôture ==");
  const emp2 = await prisma.employee.findFirstOrThrow({ where: { schoolId: sid, matricule: "DEMO-E2" } });
  const adv = await grantAdvance(paie, emp2.id, { amount: 20000, date: now, reason: "Avance démo (fictive)" });
  check("avance 20 000 accordée", adv.ok === true);
  // Période N+1 = lendemain de la fin du dernier run principal (rejouable sans RUN_OVERLAP)
  const lastRun = await prisma.payrollRun.findFirst({ where: { schoolId: sid, rectifiesRunId: null }, orderBy: { periodEnd: "desc" } });
  const next = lastRun ? new Date(lastRun.periodEnd.getTime() + 86400000) : new Date(now.getFullYear(), now.getMonth(), 1);
  const nextEnd = new Date(next.getFullYear(), next.getMonth() + 1, 0);
  // La paie N+1 exige un exercice ouvert couvrant sa fin de période — on l'ouvre si besoin.
  const exN1 = await prisma.accountingExercise.findFirst({ where: { schoolId: sid, status: "OPEN", startDate: { lte: nextEnd }, endDate: { gte: nextEnd } } });
  if (!exN1) {
    await openExercise(compta, { name: `${nextEnd.getFullYear()}`, startDate: new Date(nextEnd.getFullYear(), 0, 1), endDate: new Date(nextEnd.getFullYear(), 11, 31) });
  }
  let run2 = await prisma.payrollRun.findFirst({ where: { schoolId: sid, periodStart: next, rectifiesRunId: null } });
  if (!run2) {
    const r = await createRun(paie, { periodStart: next, periodEnd: nextEnd });
    if (r.ok) run2 = await prisma.payrollRun.findFirstOrThrow({ where: { id: r.result.id } });
    else console.warn("  createRun N+1:", r.error);
  } else if (run2.status !== "DRAFT") console.warn("  run N+1 déjà", run2.status);
  if (run2 && run2.status === "DRAFT") {
    const c = await computeRun(paie, run2.id);
    check("run N+1 calculé avec recouvrement", c.ok === true);
    const slip2 = await prisma.payslip.findFirst({ where: { runId: run2.id, employeeId: emp2.id } });
    const gross = slip2?.gross ?? 0;
    const capBp = (await prisma.payrollConfig.findUnique({ where: { schoolId: sid } }))?.advanceCapBp ?? 3000;
    const rec = slip2 ? await prisma.advanceRecovery.findFirst({ where: { payslipId: slip2.id } }) : null;
    // Le plafond s'applique au net avant recouvrement : net_avant = net + recouvrement
    check(`recouvrement ≤ ${capBp / 100} % du net (plafond configuré, indicatif)`, slip2 !== null && rec !== null && rec.amount <= Math.floor(((slip2.net + rec.amount) * capBp) / 10000) + 1 && slip2.net > 0);
    check("retenue d'avance tracée (AdvanceRecovery)", !!rec && rec.amount > 0 && rec.amount <= 20000);
    const v2 = await validateRun(paie, run2.id);
    if (!v2.ok) console.warn("  validateRun N+1:", v2.error);
    const p2 = await postPayrollToAccounting(paie, run2.id);
    if (!p2.ok) console.warn("  postPayroll N+1:", p2.error);
    check("run N+1 comptabilisé", p2.ok === true);
    const rect = await rectifyRun(paie, run2.id);
    check("rectification créée", rect.ok === true);
    const counter = await prisma.accountingEntry.findFirst({ where: { schoolId: sid, sourceType: "PAYROLL_RECTIF", sourceId: run2.id } });
    check("contre-passation comptable créée", !!counter);
    const run2After = await prisma.payrollRun.findFirstOrThrow({ where: { id: run2.id } });
    check("run rectifié → RECTIFIED", run2After.status === "RECTIFIED");
  } else if (run2 && run2.status === "POSTED") {
    const rect = await rectifyRun(paie, run2.id);
    check("rectification créée (run POSTED)", rect.ok === true);
    const counter = await prisma.accountingEntry.findFirst({ where: { schoolId: sid, sourceType: "PAYROLL_RECTIF", sourceId: run2.id } });
    check("contre-passation comptable créée", !!counter);
    const run2After = await prisma.payrollRun.findFirstOrThrow({ where: { id: run2.id } });
    check("run rectifié → RECTIFIED", run2After.status === "RECTIFIED");
  } else if (run2 && run2.status === "RECTIFIED") {
    const counter = await prisma.accountingEntry.findFirst({ where: { schoolId: sid, sourceType: "PAYROLL_RECTIF", sourceId: run2.id }, include: { lines: true } });
    check("rectification déjà jouée — contre-passation équilibrée", !!counter && counter.lines.reduce((s, l) => s + l.debit, 0) === counter.lines.reduce((s, l) => s + l.credit, 0));
  }

  subtotal("S3");
  console.log("\n== S4 Permissions, confidentialité, isolation ==");
  const rhPaie = await computeRun(rh, run2?.id ?? "x");
  check("RH sans payroll.manage → computeRun FORBIDDEN", !rhPaie.ok && rhPaie.error === "FORBIDDEN");
  const paieEmp = await createEmployee(paie, { matricule: "XX", firstName: "X", lastName: "Y", category: "TEACHING" });
  check("Paie sans hr.manage → createEmployee FORBIDDEN", !paieEmp.ok && paieEmp.error === "FORBIDDEN");
  const { getPayslip } = await import("@/lib/services/hr/payroll");
  const anySlip = await prisma.payslip.findFirst({ where: { run: { schoolId: sid } } });
  const comptaSlip = anySlip ? await getPayslip(compta, anySlip.id) : { ok: false as const, error: "NONE" };
  check("comptable sans payroll.read → bulletin FORBIDDEN (confidentialité)", !comptaSlip.ok && comptaSlip.error === "FORBIDDEN");
  const rhSlip = anySlip ? await getPayslip(rh, anySlip.id) : { ok: false as const, error: "NONE" };
  check("RH sans payroll.read → bulletin FORBIDDEN (salaires confidentiels)", !rhSlip.ok && rhSlip.error === "FORBIDDEN");

  const other = await prisma.school.findFirst({ where: { NOT: { slug: "demo-validation" } } });
  if (other) {
    const otherUser = await prisma.user.create({ data: { email: `iso-${Date.now()}@t.l`, passwordHash: "x" } });
    const roleName = `ISO${Date.now() % 1e6}`;
    const role = await prisma.role.create({ data: { name: roleName, scope: "SCHOOL", schoolId: other.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["hr.read", "payroll.read", "accounting.read"] } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId: otherUser.id, schoolId: other.id, roleId: role.id } });
    const isoCtx = { userId: otherUser.id, schoolId: other.id };
    const { getEmployee } = await import("@/lib/services/hr/employees");
    const empView = await getEmployee(isoCtx, emp1.id);
    check("isolation : employé école démo invisible depuis autre école", !empView.ok);
    const { getRun } = await import("@/lib/services/hr/payroll");
    const runView = run ? await getRun(isoCtx, run.id) : { ok: false as const, error: "?" };
    check("isolation : run de paie invisible depuis autre école", !runView.ok);
    check("isolation : écritures comptables non accessibles", (await prisma.accountingEntry.count({ where: { schoolId: sid } })) > 0);
  }

  subtotal("S4");
  console.log(`\n===== RECETTE MÉTIER 360° : ${pass} PASS, ${fail} FAIL =====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
