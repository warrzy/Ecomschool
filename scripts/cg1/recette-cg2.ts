/** Recette CG-2 — tiers + balance âgée sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { listThirdParties, studentAging, agingCsv, upsertThirdParty } from "@/lib/services/accounting/thirdparty";
import { installStarterPlan } from "@/lib/services/accounting";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function member(userId: string, schoolId: string, keys: string[]) {
  const role = await prisma.role.create({ data: { name: `CG2_${userId.slice(-4)}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId, schoolId, roleId: role.id } });
}

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "CG2 A", code: `CG2A${ts}`, slug: `cg2a-${ts}` } });
  const B = await prisma.school.create({ data: { name: "CG2 B", code: `CG2B${ts}`, slug: `cg2b-${ts}` } });
  const u = await prisma.user.create({ data: { email: `cg2-${ts}@test.local`, passwordHash: "x" } });
  const v = await prisma.user.create({ data: { email: `cg2r-${ts}@test.local`, passwordHash: "x" } });
  await member(u.id, A.id, ["accounting.read", "accounting.manage", "accounting.export"]);
  await member(v.id, A.id, ["accounting.read"]);
  const ctxA = { userId: u.id, schoolId: A.id }, ctxR = { userId: v.id, schoolId: A.id }, ctxB = { userId: u.id, schoolId: B.id };

  await installStarterPlan(ctxA);
  const year = await prisma.academicYear.create({ data: { schoolId: A.id, name: "Y", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), isCurrent: true } });
  const st = await prisma.student.create({ data: { schoolId: A.id, matricule: "CG2-1", firstName: "S", lastName: "T", sex: "FEMALE" } });
  const cat = await prisma.feeCategory.create({ data: { schoolId: A.id, code: "S", label: "S" } });
  const charge = await prisma.studentFeeCharge.create({ data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, categoryId: cat.id, amount: 100 } });
  // 4 échéances : non échue (demain), 20j, 45j, 100j — la 45j partiellement payée
  const days = [-1, 20, 45, 100];
  const insts = [];
  for (const d of days) {
    insts.push(await prisma.feeInstallment.create({
      data: { schoolId: A.id, chargeId: charge.id, studentId: st.id, academicYearId: year.id,
        dueDate: new Date(Date.now() - d * 86400000), amount: 1000 },
    }));
  }
  const pay = await prisma.payment.create({ data: { schoolId: A.id, studentId: st.id, academicYearId: year.id, amount: 400, method: "CASH", paidAt: new Date(), status: "VALIDATED", receiptNumber: "CG2-1" } });
  await prisma.paymentAllocation.create({ data: { paymentId: pay.id, installmentId: insts[2].id, amount: 400 } });

  console.log("== Balance âgée ==");
  const aging = await studentAging(ctxA);
  check("aging OK", aging.ok === true);
  const row = aging.ok ? aging.result.find((x) => x.studentId === st.id) : undefined;
  check("non échu 1000", row?.current === 1000);
  check("1-30j = 1000", row?.d1_30 === 1000);
  check("31-60j = 1000−400 payé", row?.d31_60 === 600);
  check("+90j = 1000", row?.d90p === 1000);

  console.log("== Tiers & permissions ==");
  const tp = await upsertThirdParty(ctxA, { kind: "SUPPLIER", name: "FournX", collectiveAccountId: (await prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: A.id, code: "401" } })).id });
  check("création fournisseur", tp.ok === true);
  const denied = await upsertThirdParty(ctxR, { kind: "SUPPLIER", name: "Y", collectiveAccountId: "x" });
  check("manage refusé en lecture seule", !denied.ok && denied.error === "FORBIDDEN");
  const list = await listThirdParties(ctxA, { kind: "SUPPLIER" });
  check("liste filtrée SUPPLIER", list.ok === true && list.result.length === 1 && list.result[0].name === "FournX");
  const search = await listThirdParties(ctxA, { q: "fournx" });
  check("recherche insensible casse", search.ok === true && search.result.length === 1);
  const listB = await listThirdParties(ctxB, {});
  check("isolation B : accès refusé sans membership", !listB.ok && listB.error === "FORBIDDEN");
  const agingB = await studentAging(ctxB);
  check("aging B : accès refusé", !agingB.ok && agingB.error === "FORBIDDEN");
  const csv = await agingCsv(ctxA);
  check("CSV export avec ligne élève", csv.ok === true && csv.result.includes("non_echu") && csv.result.split("\n").length >= 2);
  const csvDenied = await agingCsv(ctxR);
  check("export refusé sans accounting.export", !csvDenied.ok && csvDenied.error === "FORBIDDEN");

  console.log(`\n=== CG-2 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
