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
  // Montants négatifs multi-devises
  check("fmtMoney EUR négatif", fmtMoney(-1234.56, { currency: "EUR" }) === `${(-1234.56).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  check("fmtMoney GHS négatif", fmtMoney(-50, { currency: "GHS", locale: "en-GH" }) === `${(-50).toLocaleString("en-GH", { minimumFractionDigits: 2 })} GH₵`);
  check("compact négatif", fmtMoney(-1_500_000, { compact: true }) === `${(-1.5).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M FCFA`);
  // Arrondis : XOF 0 décimale, GHS 2 décimales
  check("arrondi XOF 999.9 → 1 000", fmtMoney(999.9) === `${(999.9).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} FCFA`);
  check("arrondi GHS 2 décimales", fmtMoney(1234.567, { currency: "GHS" }) === `${(1234.567).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GH₵`);
  check("devise inconnue → code ISO", fmtMoney(10, { currency: "ZZZ" }) === `${(10).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ZZZ`);

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
  check("incohérence NG+GHS → CURRENCY_MISMATCH", (() => { const r = checkCountryCoherence({ country: "NG", currency: "GHS" }); return !r.ok && (r as { error: string }).error === "CURRENCY_MISMATCH"; })());
  check("cohérence FR+EUR ok", checkCountryCoherence({ country: "FR", currency: "EUR" }).ok);
  check("pays inconnu → COUNTRY_UNKNOWN", (() => { const r = checkCountryCoherence({ country: "ZZ", currency: "XOF" }); return !r.ok && (r as { error: string }).error === "COUNTRY_UNKNOWN"; })());
  check("≥8 pays disponibles", availableCountries().length >= 8);

  // ========== Fixtures : école + plan + exercice ==========
  const mk = async (tag: string, keys: string[], schoolData: Record<string, unknown> = {}) => {
    const s = await prisma.school.create({ data: { name: `I18N ${tag}`, code: `I8${tag}${ts}`, slug: `i8-${tag.toLowerCase()}-${ts}`, ...schoolData } });
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
  check("surcharge invalide → repli OHADA (référentiel OHADA)", bs3.ok && bs3.result.actif[0].label === "Actif immobilisé");

  // ========== C3b : résolution sécurisée — unitaire ==========
  console.log("== C3b : repli OHADA conditionnel ==");
  const rBf = statementMappingFor({ country: "BF" });
  check("BF absent → OHADA", rBf.ok && rBf.mapping.framework === "SYSCOHADA");
  const rGh = statementMappingFor({ country: "GH" });
  check("GH absent → STATEMENT_MAPPING_MISSING", !rGh.ok && rGh.error === "STATEMENT_MAPPING_MISSING");
  const rFr = statementMappingFor({ country: "FR" });
  check("FR absent → STATEMENT_MAPPING_MISSING", !rFr.ok && rFr.error === "STATEMENT_MAPPING_MISSING");
  const rGhInv = statementMappingFor({ country: "GH", settings: { statementMapping: { invalid: true } } });
  check("GH invalide → STATEMENT_MAPPING_INVALID", !rGhInv.ok && rGhInv.error === "STATEMENT_MAPPING_INVALID");
  const rGhDecl = statementMappingFor({ country: "GH", settings: { accountingFramework: "OHADA_SYSCOHADA" } });
  check("GH + framework OHADA déclaré → OHADA", rGhDecl.ok && rGhDecl.mapping.framework === "SYSCOHADA");
  const rGhDeclInv = statementMappingFor({ country: "GH", settings: { accountingFramework: "OHADA_SYSCOHADA", statementMapping: { bad: 1 } } });
  check("GH déclaré OHADA + mapping invalide → repli OHADA", rGhDeclInv.ok);
  const rCustom = statementMappingFor({ country: "GH", settings: { statementMapping: OHADA_STATEMENT_MAPPING } });
  check("GH + mapping valide → utilisé", rCustom.ok);
  const rUndef = statementMappingFor({});
  check("pays inconnu, settings absents → MISSING", !rUndef.ok && rUndef.error === "STATEMENT_MAPPING_MISSING");

  // ========== C3c : écoles multi-pays — états refusés proprement ==========
  console.log("== C3c : écoles multi-pays ==");
  const ctxGH = await mk("GH", ["accounting.read", "accounting.manage"], { country: "GH", currency: "GHS", locale: "en-GH", timezone: "Africa/Accra" });
  await installStarterPlan(ctxGH);
  const exGH = await openExercise(ctxGH, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  if (!exGH.ok) throw new Error("openExercise GH");
  const isGH = await incomeStatement(ctxGH, exGH.result.id);
  check("école GH : compte de résultat refusé (MISSING)", !isGH.ok && isGH.error === "STATEMENT_MAPPING_MISSING");
  const bsGH = await balanceSheet(ctxGH, exGH.result.id);
  check("école GH : bilan refusé (MISSING)", !bsGH.ok && bsGH.error === "STATEMENT_MAPPING_MISSING");
  // Déclaration explicite du référentiel OHADA → états autorisés.
  await prisma.school.update({ where: { id: ctxGH.schoolId }, data: { settings: { accountingFramework: "OHADA_SYSCOHADA" } } });
  const isGH2 = await incomeStatement(ctxGH, exGH.result.id);
  check("école GH + OHADA déclaré → états générés", isGH2.ok);
  // Mapping invalide sur école non-OHADA → erreur explicite.
  await prisma.school.update({ where: { id: ctxGH.schoolId }, data: { settings: { statementMapping: { bogus: true } } } });
  const isGH3 = await incomeStatement(ctxGH, exGH.result.id);
  check("école GH + mapping invalide → INVALID", !isGH3.ok && isGH3.error === "STATEMENT_MAPPING_INVALID");

  // ========== C3d : compat données existantes (défauts Prisma BF) ==========
  console.log("== C3d : compat écoles existantes ==");
  const ctxOld = await mk("OLD", ["accounting.read", "accounting.manage"]); // country/currency = défauts schéma BF/XOF
  const old = await prisma.school.findUnique({ where: { id: ctxOld.schoolId }, select: { country: true, currency: true } });
  check("école sans champs explicites → BF/XOF (défauts)", old?.country === "BF" && old?.currency === "XOF");
  await installStarterPlan(ctxOld);
  const exOld = await openExercise(ctxOld, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  if (!exOld.ok) throw new Error("openExercise OLD");
  const isOld = await incomeStatement(ctxOld, exOld.result.id);
  check("école legacy (settings null) → états OHADA", isOld.ok);
  const bsOld = await balanceSheet(ctxOld, exOld.result.id);
  check("école legacy : bilan équilibré", bsOld.ok && bsOld.result.totalActif === bsOld.result.totalPassif);

  // ========== C3e : délégués Prisma du script de purge prod-recette ==========
  console.log("== C3e : délégués purge prod-recette ==");
  // Couvre la correction accountingMapping → accountingAccountMap :
  // les noms utilisés par la boucle deleteMany de prod-recette.ts doivent
  // exister comme délégués — une renommée future de modèle doit échouer ici.
  for (const m of ["accountingEntry", "accountingAccountMap", "accountingExercise", "accountingJournal", "accountingAccount"] as const)
    check(`délégué prisma.${m} existe`, typeof (prisma[m] as unknown as { deleteMany?: unknown }).deleteMany === "function");
  // Vérifie réellement que deleteMany par schoolId fonctionne sur le delegate
  // corrigé (comportement exact du script de purge).
  await prisma.accountingAccountMap.deleteMany({ where: { schoolId: ctxOld.schoolId } });
  const mapsAfter = await prisma.accountingAccountMap.count({ where: { schoolId: ctxOld.schoolId } });
  check("accountingAccountMap.deleteMany(schoolId) purge OK", mapsAfter === 0);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
