/** Recette CG-3 — bilan + compte de résultat sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, createManualEntry } from "@/lib/services/accounting";
import { balanceSheet, incomeStatement, statementCsv } from "@/lib/services/accounting/statements";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "CG3 A", code: `CG3A${ts}`, slug: `cg3a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `cg3-${ts}@test.local`, passwordHash: "x" } });
  const v = await prisma.user.create({ data: { email: `cg3r-${ts}@test.local`, passwordHash: "x" } });
  const mkRole = async (userId: string, keys: string[]) => {
    const role = await prisma.role.create({ data: { name: `CG3_${userId.slice(-4)}`, scope: "SCHOOL", schoolId: A.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId, schoolId: A.id, roleId: role.id } });
  };
  await mkRole(u.id, ["accounting.read", "accounting.manage", "accounting.export"]);
  await mkRole(v.id, ["accounting.read"]);
  const ctx = { userId: u.id, schoolId: A.id }, ctxR = { userId: v.id, schoolId: A.id };

  await installStarterPlan(ctx);
  const ex = await openExercise(ctx, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  if (!ex.ok) throw new Error(ex.error);
  const exId = ex.result.id;
  const acc = async (code: string) => (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code } })).id;
  const od = (await prisma.accountingJournal.findFirstOrThrow({ where: { schoolId: A.id, code: "OD" } })).id;
  const [a571, a411, a706, a605] = await Promise.all([acc("571"), acc("411"), acc("706"), acc("605")]);

  // D571/C706 100k (produit encaissé) ; D605/C571 30k (charge) ; D411/C706 50k (créance)
  await createManualEntry(ctx, { journalId: od, exerciseId: exId, date: new Date("2025-10-01"), description: "e1", lines: [{ accountId: a571, debit: 100000 }, { accountId: a706, credit: 100000 }] });
  await createManualEntry(ctx, { journalId: od, exerciseId: exId, date: new Date("2025-10-02"), description: "e2", lines: [{ accountId: a605, debit: 30000 }, { accountId: a571, credit: 30000 }] });
  await createManualEntry(ctx, { journalId: od, exerciseId: exId, date: new Date("2025-10-03"), description: "e3", lines: [{ accountId: a411, debit: 50000 }, { accountId: a706, credit: 50000 }] });

  console.log("== Compte de résultat ==");
  const is = await incomeStatement(ctx, exId);
  check("CR OK", is.ok === true);
  check("produits = 150000", is.ok && is.result.produits.total === 150000);
  check("charges = 30000", is.ok && is.result.charges.total === 30000);
  check("résultat = +120000", is.ok && is.result.resultat === 120000);

  console.log("== Bilan ==");
  const bs = await balanceSheet(ctx, exId);
  check("bilan OK", bs.ok === true);
  check("actif = passif = 120000", bs.ok && bs.result.totalActif === 120000 && bs.result.totalPassif === 120000);
  const treso = bs.ok ? bs.result.actif.find((s) => s.label === "Trésorerie actif") : undefined;
  check("571 actif = 70000", treso?.lines.find((l) => l.code === "571")?.amount === 70000);
  const tiers = bs.ok ? bs.result.actif.find((s) => s.label === "Tiers débiteurs") : undefined;
  check("411 actif = 50000", tiers?.lines.find((l) => l.code === "411")?.amount === 50000);
  const cap = bs.ok ? bs.result.passif.find((s) => s.label === "Capitaux propres") : undefined;
  check("résultat au passif = 120000", cap?.lines.find((l) => l.code === "RÉS")?.amount === 120000);

  console.log("== Exports & permissions ==");
  const csvB = await statementCsv(ctx, "bilan", exId);
  check("CSV bilan TOTAL ACTIF=PASSIF", csvB.ok === true && csvB.result.csv.includes("TOTAL ACTIF") && csvB.result.csv.includes("TOTAL PASSIF"));
  const csvR = await statementCsv(ctx, "resultat", exId);
  check("CSV résultat", csvR.ok === true && csvR.result.csv.includes("RÉSULTAT"));
  const denied = await statementCsv(ctxR, "bilan", exId);
  check("export refusé en lecture seule", !denied.ok && denied.error === "FORBIDDEN");
  const read = await balanceSheet(ctxR, exId);
  check("lecture bilan autorisée reader", read.ok === true);

  // Perte : charge > produit → perte côté actif
  await createManualEntry(ctx, { journalId: od, exerciseId: exId, date: new Date("2025-10-04"), description: "perte", lines: [{ accountId: a605, debit: 200000 }, { accountId: a571, credit: 200000 }] });
  const bs2 = await balanceSheet(ctx, exId);
  check("perte : actif = passif toujours", bs2.ok === true && bs2.result.totalActif === bs2.result.totalPassif);
  check("résultat = -80000", bs2.ok && bs2.result.resultat === -80000);
  check("perte côté actif", bs2.ok === true && bs2.result.actif[0].lines.some((l) => l.code === "RÉS" && l.amount === 80000));

  console.log(`\n=== CG-3 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
