/** Recette RH-3 — moteur de paie sur base ISOLÉE. Aucun taux réglementaire réel. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { upsertComponent, createRun, computeRun, validateRun, getRun, evalFormula, listComponents, cancelRun } from "@/lib/services/hr/payroll";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function member(userId: string, schoolId: string, keys: string[], tag: string) {
  const role = await prisma.role.create({ data: { name: `RH3_${tag}_${userId.slice(-4)}`, scope: "SCHOOL", schoolId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId, schoolId, roleId: role.id } });
}

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH3 A", code: `RH3A${ts}`, slug: `rh3a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `rh3-${ts}@t.l`, passwordHash: "x" } });
  const hr = await prisma.user.create({ data: { email: `rh3hr-${ts}@t.l`, passwordHash: "x" } });
  await member(u.id, A.id, ["hr.read", "hr.manage", "payroll.read", "payroll.manage"], "adm");
  await member(hr.id, A.id, ["hr.read", "hr.manage"], "hr"); // RH sans payroll.* (séparation)
  const ctx = { userId: u.id, schoolId: A.id }, ctxHR = { userId: hr.id, schoolId: A.id };

  console.log("== Grammaire de formules ==");
  const bases = new Map([["base_salary", 100000], ["gross", 130000]]);
  check("fixed", evalFormula({ type: "fixed", amount: 20000 }, bases) === 20000);
  check("percent(gross)", evalFormula({ type: "percent", rate: 0.05, base: "gross" }, bases) === 6500);
  check("rate_x_qty", evalFormula({ type: "rate_x_qty", rate: 3000, qty: 4 }, bases) === 12000);
  check("table progressive", evalFormula({ type: "table", base: "base_salary", brackets: [{ upTo: 30000, rate: 0 }, { upTo: 80000, rate: 0.1 }, { upTo: 1e9, rate: 0.2 }] }, bases) === 0 * 30000 + 50000 * 0.1 + 20000 * 0.2);

  console.log("== Composants ==");
  const cB = await upsertComponent(ctx, { code: "PRIME", label: "Prime", kind: "EARNING", formula: { type: "percent", rate: 0.1, base: "base_salary" }, order: 1, activeFrom: new Date("2020-01-01") });
  check("composant prime v1", cB.ok === true && cB.result.version === 1);
  await upsertComponent(ctx, { code: "LOG", label: "Logement", kind: "EARNING", formula: { type: "fixed", amount: 20000 }, order: 2, activeFrom: new Date("2020-01-01") });
  await upsertComponent(ctx, { code: "RET", label: "Retenue", kind: "DEDUCTION", formula: { type: "percent", rate: 0.05, base: "gross" }, order: 3, activeFrom: new Date("2020-01-01") });
  await upsertComponent(ctx, { code: "PAT", label: "Charge patronale", kind: "EMPLOYER_CHARGE", formula: { type: "percent", rate: 0.08, base: "gross" }, order: 4, activeFrom: new Date("2020-01-01") });
  await upsertComponent(ctx, { code: "CNSS", label: "CNSS (à valider)", kind: "DEDUCTION", formula: { type: "percent", rate: 0.055, base: "gross" }, order: 5, activeFrom: new Date("2020-01-01"), isRegulatory: true });
  const bad = await upsertComponent(ctx, { code: "X", label: "X", kind: "EARNING", formula: { type: "eval", code: "gross*2" }, activeFrom: new Date() });
  check("formule arbitraire refusée", !bad.ok && bad.error === "INVALID_FORMULA");
  const denied = await upsertComponent(ctxHR, { code: "Y", label: "Y", kind: "EARNING", formula: { type: "fixed", amount: 1 }, activeFrom: new Date() });
  check("HR sans payroll.manage refusé", !denied.ok && denied.error === "FORBIDDEN");

  console.log("== Campagne & calcul ==");
  const e1 = await createEmployee(ctx, { matricule: "P1", firstName: "K", lastName: "O", category: "TEACHING" });
  const emp = e1.ok ? e1.result.id : "";
  await createContract(ctx, emp, { type: "CDI", position: "Prof", startDate: new Date("2025-09-01"), baseSalary: 100000, activate: true });
  const e2 = await createEmployee(ctx, { matricule: "P2", firstName: "N", lastName: "S", category: "NON_TEACHING" });
  const emp2 = e2.ok ? e2.result.id : "";
  await createContract(ctx, emp2, { type: "CDI", position: "Secrétaire", startDate: new Date("2025-09-01"), baseSalary: 80000, activate: true });

  const run = await createRun(ctx, { periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  check("run créé", run.ok === true);
  const runId = run.ok ? run.result.id : "";
  const overlap = await createRun(ctx, { periodStart: new Date("2026-01-15"), periodEnd: new Date("2026-02-15") });
  check("chevauchement refusé", !overlap.ok && overlap.error === "RUN_OVERLAP");
  const valEarly = await validateRun(ctx, runId);
  check("validation sans bulletin refusée", !valEarly.ok && valEarly.error === "NO_PAYSLIPS");

  const comp = await computeRun(ctx, runId);
  check("calcul : 2 bulletins", comp.ok === true && comp.result.payslips === 2);
  const det = await getRun(ctx, runId);
  const slip = det.ok ? det.result.payslips.find((p) => p.employeeId === emp) : undefined;
  // base 100k + prime 10% (10k) + logement 20k = brut 130k ; retenue 5% de 130k = 6.5k ; net 123.5k ; patronal 8% de 130k = 10.4k
  check("brut = 130000", slip?.gross === 130000);
  check("retenue = 6500", slip?.deductions === 6500);
  check("net = 123500", slip?.net === 123500);
  check("coût patronal = 10400", slip?.employerCost === 10400);
  check("CNSS réglementaire ignorée", slip !== undefined && !(slip.lines as { code: string }[]).some((l) => l.code === "CNSS"));
  check("formulaSnapshot figé", Array.isArray(slip?.formulaSnapshot) && (slip!.formulaSnapshot as unknown[]).length === 4);

  const comp2 = await computeRun(ctx, runId);
  check("recalcul DRAFT idempotent", comp2.ok === true && comp2.result.payslips === 2);
  const val = await validateRun(ctx, runId);
  check("validation OK", val.ok === true);
  const comp3 = await computeRun(ctx, runId);
  check("recalcul après validation refusé", !comp3.ok);
  const cancel = await cancelRun(ctx, runId);
  check("annulation run validé refusée", !cancel.ok);

  console.log("== Isolation & séparation ==");
  const B = await prisma.school.create({ data: { name: "RH3 B", code: `RH3B${ts}`, slug: `rh3b-${ts}` } });
  const detB = await getRun({ userId: u.id, schoolId: B.id }, runId);
  check("run A invisible depuis B", !detB.ok && (detB.error === "FORBIDDEN" || detB.error === "NOT_FOUND"));
  const compsHR = await listComponents(ctxHR);
  check("HR sans payroll.read : liste refusée", !compsHR.ok && compsHR.error === "FORBIDDEN");

  console.log(`\n=== RH-3 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
