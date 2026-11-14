/**
 * Recette CG-1 — comptabilité d'engagement (ACCRUAL) sur base ISOLÉE.
 * Vérifie : CHARGE D411/C706, règlement D57x/C411, lettrage partiel
 * (acompte + OVER_ALLOCATED), idempotence, isolation école B, créance
 * hors exercice signalée (skipped, jamais perdue silencieusement).
 * Exécution : DATABASE_URL=<isolee> npx tsx scripts/cg1/recette-cg1.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { installStarterPlan, openExercise, generateEntries, listEntries } from "@/lib/services/accounting";
import { allocate, thirdPartyBalance } from "@/lib/services/accounting/engagement";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

async function member(userId: string, schoolId: string, keys: string[]) {
  const role = await prisma.role.create({ data: { name: `CG1_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId, schoolId, roleId: role.id } });
}

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "CG1 École A", code: `CG1A${ts}`, slug: `cg1a-${ts}` } });
  const B = await prisma.school.create({ data: { name: "CG1 École B", code: `CG1B${ts}`, slug: `cg1b-${ts}` } });
  const u = await prisma.user.create({ data: { email: `cg1-${Date.now()}@test.local`, passwordHash: "x" } });
  await member(u.id, A.id, ["accounting.read", "accounting.manage", "accounting.export"]);
  await member(u.id, B.id, ["accounting.read", "accounting.manage"]);
  const ctxA = { userId: u.id, schoolId: A.id }, ctxB = { userId: u.id, schoolId: B.id };

  await installStarterPlan(ctxA);
  const exR = await openExercise(ctxA, { name: "EX-ACCRUAL", startDate: new Date("2026-07-01"), endDate: new Date("2027-06-30") });
  if (exR.ok) await prisma.accountingExercise.update({ where: { id: exR.result.id }, data: { mode: "ACCRUAL" } });

  const year = await prisma.academicYear.create({ data: { schoolId: A.id, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), isCurrent: true } });
  const st = await prisma.student.create({ data: { schoolId: A.id, matricule: "CG1-01", firstName: "K", lastName: "T", sex: "MALE" } });
  const cat = await prisma.feeCategory.create({ data: { schoolId: A.id, code: "SCOL", label: "Scolarité" } });
  const charge = await prisma.studentFeeCharge.create({
    data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, categoryId: cat.id, amount: 100000 },
  });
  const inst = await prisma.feeInstallment.create({
    data: { schoolId: A.id, chargeId: charge.id, studentId: st.id, academicYearId: year.id, dueDate: new Date("2026-10-01"), amount: 100000 },
  });
  const pay = await prisma.payment.create({
    data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, amount: 40000, method: "CASH", paidAt: new Date("2026-10-05"), status: "VALIDATED", receiptNumber: "CG1-R1" },
  });
  await prisma.paymentAllocation.create({ data: { paymentId: pay.id, installmentId: inst.id, amount: 40000 } });
  // Créance hors exercice → doit être signalée skipped, jamais perdue
  const catOld = await prisma.feeCategory.create({ data: { schoolId: A.id, code: "OLD", label: "Ancienne" } });
  await prisma.studentFeeCharge.create({
    data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, categoryId: catOld.id, amount: 5000, createdAt: new Date("2025-01-01") },
  });

  console.log("== Génération ACCRUAL ==");
  const g1 = await generateEntries(ctxA);
  check("generateEntries OK", g1.ok === true);
  if (g1.ok) {
    check("1 écriture CHARGE", g1.result.charges === 1);
    check("1 écriture PAYMENT", g1.result.payments === 1);
    check("créance hors exercice signalée (skipped)", g1.result.skipped >= 1);
  }
  const ents = await listEntries(ctxA, { exerciseId: exR.ok ? exR.result.id : "" });
  const list = ents.ok ? ents.result : [];
  const ce = list.find((e) => e.sourceType === "CHARGE");
  const pe = list.find((e) => e.sourceType === "PAYMENT");
  check("CHARGE D411/C706", !!ce && ce.lines.some((l) => l.account.code === "411" && l.debit === 100000)
    && ce.lines.some((l) => l.credit === 100000));
  check("PAYMENT D571/C411 (pas de 706)", !!pe && pe.lines.some((l) => l.account.code === "571" && l.debit === 40000)
    && pe.lines.some((l) => l.account.code === "411" && l.credit === 40000)
    && !pe.lines.some((l) => l.account.code === "706"));
  check("équilibre global", list.every((e) =>
    e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0)));

  console.log("== Lettrage partiel ==");
  const debit411 = ce?.lines.find((l) => l.account.code === "411" && l.debit > 0);
  const credit411 = pe?.lines.find((l) => l.account.code === "411" && l.credit > 0);
  // L'auxiliaire élève est auto-provisionné par la passe CHARGE.
  const tp = await prisma.accountingThirdParty.findFirstOrThrow({
    where: { schoolId: A.id, kind: "STUDENT", refId: st.id },
  });
  check("auxiliaire élève auto-provisionné", tp.name.includes("K"));
  const a1 = debit411 && credit411
    ? await allocate(ctxA, { chargeLineId: debit411.id, paymentLineId: credit411.id, amount: 40000, thirdPartyId: tp.id })
    : { ok: false as const, error: "MISSING" };
  check("acompte 40k accepté", a1.ok === true);
  const over = debit411 && credit411
    ? await allocate(ctxA, { chargeLineId: debit411.id, paymentLineId: credit411.id, amount: 99999 })
    : { ok: false as const, error: "x" };
  check("sur-lettrage refusé (OVER_ALLOCATED)", !over.ok && (over as { error?: string }).error === "OVER_ALLOCATED");
  const bal = await thirdPartyBalance(ctxA, tp.id);
  check("solde tiers = 100k − 40k", bal.ok && bal.result.balance === 60000);

  console.log("== Idempotence & isolation ==");
  const g2 = await generateEntries(ctxA);
  check("re-run : 0 nouvelle écriture", g2.ok === true && g2.result.charges === 0 && g2.result.payments === 0);
  const bEnts = await listEntries(ctxB, {});
  check("école B ne voit rien de A", bEnts.ok === true && bEnts.result.length === 0);
  const bCharge = await prisma.accountingEntry.count({ where: { schoolId: B.id, sourceType: "CHARGE" } });
  check("aucune écriture CHARGE en B", bCharge === 0);

  console.log(`\n=== CG-1 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR RECETTE", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
