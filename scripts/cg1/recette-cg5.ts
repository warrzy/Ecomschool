/** Recette CG-5 — rapprochement bancaire sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, createManualEntry } from "@/lib/services/accounting";
import { importStatement, autoMatch, reconciliationReport } from "@/lib/services/accounting/reconciliation";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "CG5 A", code: `CG5A${ts}`, slug: `cg5a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `cg5-${ts}@test.local`, passwordHash: "x" } });
  const role = await prisma.role.create({ data: { name: `CG5_${ts}`, scope: "SCHOOL", schoolId: A.id } });
  const perms = await prisma.permission.findMany({ where: { key: { in: ["accounting.read", "accounting.manage"] } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: A.id, roleId: role.id } });
  const ctx = { userId: u.id, schoolId: A.id };

  await installStarterPlan(ctx);
  const ex = await openExercise(ctx, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  if (!ex.ok) throw new Error(ex.error);
  const exId = ex.result.id;
  const acc = async (code: string) => (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code } })).id;
  const bq = await prisma.accountingJournal.findFirstOrThrow({ where: { schoolId: A.id, code: "BQ" } });
  const [a521, a706, a605] = await Promise.all([acc("521"), acc("706"), acc("605")]);

  // Livre : +50k (05/10), +30k (12/10), −12k (20/10), +99k (25/10 jamais dans le relevé)
  await createManualEntry(ctx, { journalId: bq.id, exerciseId: exId, date: new Date("2025-10-05"), description: "enc1", lines: [{ accountId: a521, debit: 50000 }, { accountId: a706, credit: 50000 }] });
  await createManualEntry(ctx, { journalId: bq.id, exerciseId: exId, date: new Date("2025-10-12"), description: "enc2", lines: [{ accountId: a521, debit: 30000 }, { accountId: a706, credit: 30000 }] });
  await createManualEntry(ctx, { journalId: bq.id, exerciseId: exId, date: new Date("2025-10-20"), description: "achat", lines: [{ accountId: a605, debit: 12000 }, { accountId: a521, credit: 12000 }] });
  await createManualEntry(ctx, { journalId: bq.id, exerciseId: exId, date: new Date("2025-10-25"), description: "en transit", lines: [{ accountId: a521, debit: 99000 }, { accountId: a706, credit: 99000 }] });

  console.log("== Import & pointage ==");
  const st = await importStatement(ctx, {
    journalId: bq.id, periodStart: new Date("2025-10-01"), periodEnd: new Date("2025-10-31"),
    closingBalance: 68000,
    lines: [
      { date: new Date("2025-10-06"), label: "Virement scolarité", amount: 50000 },   // livre 05/10 ±1j
      { date: new Date("2025-10-10"), label: "Virement cantine", amount: 30000 },     // livre 12/10 ±2j
      { date: new Date("2025-10-21"), label: "Chèque fournitures", amount: -12000 },  // livre 20/10 ±1j
      { date: new Date("2025-10-28"), label: "Frais bancaires", amount: -1500 },      // pas en livre
    ],
  });
  check("import OK", st.ok === true);
  const stId = st.ok ? st.result.id : "";
  const m1 = await autoMatch(ctx, stId);
  check("3 lignes pointées", m1.ok === true && m1.result.matched === 3 && m1.result.unmatched === 1);
  const m2 = await autoMatch(ctx, stId);
  check("rejeu : 0 nouveau pointage", m2.ok === true && m2.result.matched === 0 && m2.result.unmatched === 1);

  console.log("== Rapport ==");
  const rep = await reconciliationReport(ctx, stId);
  check("rapport OK", rep.ok === true);
  check("1 ligne relevé non pointée (frais)", rep.ok === true && rep.result.unmatchedStatement.length === 1 && rep.result.unmatchedStatement[0].amount === -1500);
  check("1 écriture livre non pointée (99k)", rep.ok === true && rep.result.unmatchedBook.length === 1 && rep.result.unmatchedBook[0].debit === 99000);
  check("écarts identifiés", rep.ok === true && rep.result.ecart !== 0);
  check("livre net = 167000", rep.ok === true && rep.result.bookNet === 167000);

  console.log("== Isolation & permissions ==");
  const B = await prisma.school.create({ data: { name: "CG5 B", code: `CG5B${ts}`, slug: `cg5b-${ts}` } });
  const repB = await reconciliationReport({ userId: u.id, schoolId: B.id }, stId);
  check("relevé A invisible depuis B", !repB.ok && (repB.error === "FORBIDDEN" || repB.error === "NOT_FOUND"));
  const deny = await importStatement({ userId: u.id, schoolId: B.id }, { journalId: bq.id, periodStart: new Date(), periodEnd: new Date(), closingBalance: 0, lines: [{ date: new Date(), label: "x", amount: 1 }] });
  check("import B sans membership → refusé", !deny.ok);

  console.log(`\n=== CG-5 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
