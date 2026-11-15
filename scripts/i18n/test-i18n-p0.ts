import "../lib/recette-guard";
/**
 * NON-RÉGRESSION I18N-P0 — formatage monétaire, clés sémantiques paie,
 * mapping d'états externalisé, registre pays.
 * Base isolée requise (ALLOW_RECETTE=1, DATABASE_URL ≠ prod).
 * Exécution : DATABASE_URL=...schema=i18np0 ALLOW_RECETTE=1 npx tsx scripts/i18n/test-i18n-p0.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { fmtMoney, fmtMoneyCompactM, moneyFormatter } from "@/lib/format/money";
import { countryDefaults, checkCountryCoherence, availableCountries } from "@/lib/config/countries";
import { installStarterPlan, openExercise, createManualEntry } from "@/lib/services/accounting";
import { incomeStatement, balanceSheet } from "@/lib/services/accounting/statements";
import { OHADA_STATEMENT_MAPPING, statementMappingFor } from "@/lib/services/accounting/statementMaps";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { createRun, computeRun } from "@/lib/services/hr/payroll";
import { postPayrollToAccounting } from "@/lib/services/hr/payrollPosting";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

const oldFmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

async function main() {
  const ts = Date.now() % 1e7;

  // ========== C1 : fmtMoney — rendu identique BF, multi-devises ==========
  console.log("== C1 : formatage monétaire ==");
  for (const n of [0, 1, 999, 1500, 75000, 1234567, -45000])
    check(`fmtMoney(${n}) === ancien littéral`, fmtMoney(n) === oldFmt(n));
  check("fmtMoney GHS", fmtMoney(12345, { currency: "GHS" }) === `${(12345).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} GH₵`);
  check("fmtMoney EUR (2 décimales)", fmtMoney(1000, { currency: "EUR" }) === `${(1000).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`);
  check("fmtMoney NGN", fmtMoney(500, { currency: "NGN" }) === `500,00 ₦`);
  check("fmtMoneyCompactM", fmtMoneyCompactM(1.2345) === "1,2 M");
  check("moneyFormatter école GHS", moneyFormatter({ currency: "GHS", locale: "en-GH" })(999) === `${(999).toLocaleString("en-GH", { minimumFractionDigits: 2 })} GH₵`);
  check("moneyFormatter défaut école", moneyFormatter({})(5000) === oldFmt(5000));

  // ========== C5 : registre pays + cohérence ==========
  console.log("== C5 : registre pays ==");
  const gh = countryDefaults("GH");
  check("GH → GHS/en-GH/Accra", gh?.currency === "GHS" && gh?.locale === "en-GH" && gh?.timezone === "Africa/Accra" && gh?.accountingFramework === "IFRS_STYLE");
  const bf = countryDefaults("BF");
  check("BF → XOF/OHADA", bf?.currency === "XOF" && bf?.accountingFramework === "OHADA_SYSCOHADA");
  check("pays inconnu → undefined", countryDefaults("ZZ") === undefined);
  check("cohérence GH+GHS ok", checkCountryCoherence({ country: "GH", currency: "GHS" }).ok);
  const mis = checkCountryCoherence({ country: "GH", currency: "XOF" });
  check("incohérence GH+XOF → CURRENCY_MISMATCH", !mis.ok && !("ok" in mis && mis.ok) && (mis as { error: string }).error === "CURRENCY_MISMATCH");
  check("≥8 pays disponibles", availableCountries().length >= 8);

  // ========== Fixtures : école + plan + exercice ==========
  const mk = async (tag: string, keys: string[]) => {
    const s = await prisma.school.create({ data: { name: `I18N ${tag}`, code: `I8${tag}${ts}`, slug: `i8-${tag.toLowerCase()}-${ts}` } });
    const u = await prisma.user.create({ data: { email: `i8${tag}-${ts}@t.l`, passwordHash: "x" } });
    const role = await prisma.role.create({ data: { name: `I8_${tag}`, scope: "SCHOOL", schoolId: s.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: s.id, roleId: role.id } });
    return { userId: u.id, schoolId: s.id };
  };

  // ========== C2 : clés sémantiques PAYROLL:* ==========
  console.log("== C2 : écritures de paie par clés sémantiques ==");
  const ctxP = await mk("P", ["hr.read", "hr.manage", "payroll.read", "payroll.manage", "accounting.read", "accounting.manage"]);
  await installStarterPlan(ctxP);
  const mapsP = await prisma.accountingAccountMap.findMany({ where: { schoolId: ctxP.schoolId, key: { startsWith: "PAYROLL:" } } });
  check("4 clés PAYROLL:* installées par le starter", mapsP.length === 4);
  const mapAcc = new Map(mapsP.map((m) => [m.key, m.accountId]));
  const codeIn = (sid: string) => async (c: string) => (await prisma.accountingAccount.findFirst({ where: { schoolId: sid, code: c } }))?.id;
  const code = codeIn(ctxP.schoolId);
  check("PAYROLL:EXPENSE → 66", mapAcc.get("PAYROLL:EXPENSE") === (await code("66")));
  check("PAYROLL:PAYABLE → 422", mapAcc.get("PAYROLL:PAYABLE") === (await code("422")));
  check("PAYROLL:SOCIAL → 431", mapAcc.get("PAYROLL:SOCIAL") === (await code("431")));
  check("PAYROLL:ADVANCES → 421", mapAcc.get("PAYROLL:ADVANCES") === (await code("421")));

  const exP = await openExercise(ctxP, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  if (!exP.ok) throw new Error("openExercise " + exP.error);
  const empRes = await createEmployee(ctxP, { matricule: "E1", firstName: "K", lastName: "D", category: "NON_TEACHING" });
  if (!empRes.ok) throw new Error("createEmployee " + empRes.error);
  const ctRes = await createContract(ctxP, empRes.result.id, { type: "CDI", position: "Comptable", baseSalary: 100000, startDate: new Date("2026-01-01"), activate: true });
  if (!ctRes.ok) throw new Error("createContract " + ctRes.error);
  const runRes = await createRun(ctxP, { periodStart: new Date("2026-11-01"), periodEnd: new Date("2026-11-30") });
  if (!runRes.ok) throw new Error("createRun " + runRes.error);
  const compRes = await computeRun(ctxP, runRes.result.id);
  check("computeRun ok", compRes.ok);
  const validateRes = await prisma.payrollRun.update({ where: { id: runRes.result.id }, data: { status: "VALIDATED" } });
  const postRes = await postPayrollToAccounting(ctxP, validateRes.id);
  check("posting via clés sémantiques OK", postRes.ok);
  if (postRes.ok) {
    const entry = await prisma.accountingEntry.findFirst({ where: { id: postRes.result.entryId }, include: { lines: true } });
    const usedIds = new Set(entry?.lines.map((l) => l.accountId));
    check("écriture utilise 66", usedIds.has(mapAcc.get("PAYROLL:EXPENSE")!));
    check("écriture utilise 422", usedIds.has(mapAcc.get("PAYROLL:PAYABLE")!));
    check("écriture équilibrée", (entry?.lines.reduce((s, l) => s + l.debit, 0) ?? -1) === (entry?.lines.reduce((s, l) => s + l.credit, 0) ?? -2));
  }

  // Repli hérité : plan sans clés PAYROLL:* → codes OHADA historiques.
  const ctxL = await mk("L", ["hr.manage", "payroll.manage", "accounting.manage"]);
  await installStarterPlan(ctxL);
  await prisma.accountingAccountMap.deleteMany({ where: { schoolId: ctxL.schoolId, key: { startsWith: "PAYROLL:" } } });
  await openExercise(ctxL, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  const empL = await createEmployee(ctxL, { matricule: "E1", firstName: "A", lastName: "B", category: "NON_TEACHING" });
  if (!empL.ok) throw new Error("empL " + empL.error);
  await createContract(ctxL, empL.result.id, { type: "CDI", position: "Agent", baseSalary: 80000, startDate: new Date("2026-01-01"), activate: true });
  const runL = await createRun(ctxL, { periodStart: new Date("2026-11-01"), periodEnd: new Date("2026-11-30") });
  if (!runL.ok) throw new Error("runL " + runL.error);
  await computeRun(ctxL, runL.result.id);
  await prisma.payrollRun.update({ where: { id: runL.result.id }, data: { status: "VALIDATED" } });
  const postL = await postPayrollToAccounting(ctxL, runL.result.id);
  check("repli codes hérités (plan sans clés) OK", postL.ok);

  // ========== C3 : mapping d'états externalisé ==========
  console.log("== C3 : états financiers via mapping externe ==");
  const ctxS = await mk("S", ["accounting.read", "accounting.manage"]);
  await installStarterPlan(ctxS);
  const exS = await openExercise(ctxS, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  if (!exS.ok) throw new Error("openExercise S");
  const jour = await prisma.accountingJournal.findFirst({ where: { schoolId: ctxS.schoolId, code: "OD" } });
  const codeS = codeIn(ctxS.schoolId);
  const a411 = await codeS("411"), a706 = await codeS("706");
  const m1 = await createManualEntry(ctxS, {
    journalId: jour!.id, exerciseId: exS.result.id, date: new Date("2026-06-01"),
    description: "Produit test", lines: [
      { accountId: a411!, debit: 10000, label: "Créance" },
      { accountId: a706!, credit: 10000, label: "Produit" },
    ],
  });
  check("écriture manuelle ok", m1.ok);
  const is = await incomeStatement(ctxS, exS.result.id);
  check("compte de résultat : produits 10 000", is.ok && is.result.produits.total === 10000 && is.result.resultat === 10000);
  const bs = await balanceSheet(ctxS, exS.result.id);
  check("bilan : actif=passif", bs.ok && bs.result.totalActif === bs.result.totalPassif);
  check("bilan : sections OHADA (actif immobilisé, stocks, tiers, trésorerie)",
    bs.ok && bs.result.actif.map((s) => s.label).join("|") === "Actif immobilisé|Stocks|Tiers débiteurs|Trésorerie actif");
  // Surcharge par settings : renommer une section doit se refléter.
  const custom = JSON.parse(JSON.stringify(OHADA_STATEMENT_MAPPING));
  custom.balanceSheet.actif[0].label = "Immobilisations (surcharge)";
  await prisma.school.update({ where: { id: ctxS.schoolId }, data: { settings: { statementMapping: custom } } });
  const bs2 = await balanceSheet(ctxS, exS.result.id);
  check("surcharge settings prise en compte", bs2.ok && bs2.result.actif[0].label === "Immobilisations (surcharge)");
  await prisma.school.update({ where: { id: ctxS.schoolId }, data: { settings: { statementMapping: { invalid: true } } } });
  const bs3 = await balanceSheet(ctxS, exS.result.id);
  check("surcharge invalide → repli OHADA", bs3.ok && bs3.result.actif[0].label === "Actif immobilisé");
  check("statementMappingFor(null) → OHADA", statementMappingFor(null).framework === "SYSCOHADA");

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
