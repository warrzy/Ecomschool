/** Recette CG-4 — immobilisations + dotations sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, trialBalance } from "@/lib/services/accounting";
import { createAsset, runDepreciation, listAssets, disposeAsset } from "@/lib/services/accounting/assets";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "CG4 A", code: `CG4A${ts}`, slug: `cg4a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `cg4-${ts}@test.local`, passwordHash: "x" } });
  const role = await prisma.role.create({ data: { name: `CG4_${ts}`, scope: "SCHOOL", schoolId: A.id } });
  const perms = await prisma.permission.findMany({ where: { key: { in: ["accounting.read", "accounting.manage"] } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: A.id, roleId: role.id } });
  const ctx = { userId: u.id, schoolId: A.id };

  await installStarterPlan(ctx); // inclut désormais 201 / 281 / 681
  const acc = async (code: string) => (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code } })).id;
  const ex = await openExercise(ctx, { name: "2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-08-31") });
  if (!ex.ok) throw new Error(ex.error);
  const exId = ex.result.id;

  console.log("== Création & dotations ==");
  const a = await createAsset(ctx, {
    label: "Bus scolaire", acquisitionDate: new Date("2025-10-01"),
    acquisitionCost: 120000, durationMonths: 12,
    accountAssetId: await acc("201"), accountDepreciationId: await acc("281"), accountChargeId: await acc("681"),
  });
  check("immobilisation créée", a.ok === true);
  check("plan starter étendu", !!(await prisma.accountingAccount.findFirst({ where: { schoolId: A.id, code: "281" } })));

  const r1 = await runDepreciation(ctx, 2025, 10);
  check("mois 10 : 1 dotation", r1.ok === true && r1.result.posted === 1);
  const e1 = await prisma.accountingEntry.findFirst({ where: { schoolId: A.id, sourceType: "ASSET_DEPR" }, include: { lines: true } });
  check("D681/C281 = 10000", e1?.lines.find((l) => l.debit === 10000)?.accountId === await acc("681")
    && e1?.lines.find((l) => l.credit === 10000)?.accountId === await acc("281"));

  const r1b = await runDepreciation(ctx, 2025, 10);
  check("rejeu mois 10 : 0 nouvelle", r1b.ok === true && r1b.result.posted === 0 && r1b.result.skipped === 1);
  const cnt1 = await prisma.accountingEntry.count({ where: { schoolId: A.id, sourceType: "ASSET_DEPR" } });
  check("exactement 1 écriture ASSET_DEPR", cnt1 === 1);
  const cntS = await prisma.assetSchedule.count({ where: { assetId: a.ok ? a.result.id : "" } });
  check("exactement 1 ligne de plan", cntS === 1);

  const r2 = await runDepreciation(ctx, 2025, 11);
  check("mois 11 : 1 dotation", r2.ok === true && r2.result.posted === 1);
  const assets = await listAssets(ctx);
  check("amorti cumulé = 20000", assets.ok === true && assets.result[0].amortized === 20000 && assets.result[0].remaining === 100000);

  const r3 = await runDepreciation(ctx, 2027, 1);
  check("hors exercice → NO_OPEN_EXERCISE explicite", !r3.ok && r3.error === "NO_OPEN_EXERCISE");

  console.log("== Sortie & balance ==");
  const d = await disposeAsset(ctx, a.ok ? a.result.id : "", "SCRAPPED");
  check("sortie SCRAPPED", d.ok === true);
  const r4 = await runDepreciation(ctx, 2025, 12);
  check("sortie → plus de dotation", r4.ok === true && r4.result.posted === 0);
  const tb = await trialBalance(ctx, exId);
  const c681 = tb.ok ? tb.result.balance.find((x) => x.code === "681") : undefined;
  const c281 = tb.ok ? tb.result.balance.find((x) => x.code === "281") : undefined;
  check("681 débit = 20000", c681?.debit === 20000);
  check("281 crédit = 20000", c281?.credit === 20000);
  check("balance équilibrée", tb.ok === true && tb.result.totalDebit === tb.result.totalCredit);

  console.log(`\n=== CG-4 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
