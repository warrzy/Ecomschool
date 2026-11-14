/**
 * TEST RH-9 — dotations de congés assistées + plafond avances configurable (préprod).
 * npx tsx scripts/preprod/test-rh9.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { upsertLeaveRule, provisionLeaveBalances, requestLeave, decideLeave, setEntitlement } from "@/lib/services/hr/leaves";
import { setAdvanceCap, getPayrollConfig } from "@/lib/services/hr/payroll";

async function main() {
  const school = await prisma.school.findFirstOrThrow({ where: { name: { contains: "ÉCOLE DÉMO VALIDATION" } } });
  const sid = school.id;
  const mkUser = async (email: string) => {
    const u = await prisma.user.findFirstOrThrow({ where: { email } });
    return { userId: u.id, schoolId: sid };
  };
  const rh = await mkUser("demo-rh@demo.ecomschool.test");
  const paie = await mkUser("demo-paie@demo.ecomschool.test");
  const year = new Date().getFullYear();
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(c ? "  PASS" : "  FAIL", n); };

  check("règle ANNUAL 30j", (await upsertLeaveRule(rh, "ANNUAL", 30)).ok === true);
  check("règle SICK 10j", (await upsertLeaveRule(rh, "SICK", 10)).ok === true);

  const prov = await provisionLeaveBalances(rh, year);
  check("provisionnement employés actifs", prov.ok === true);

  const emp = await prisma.employee.findFirstOrThrow({ where: { schoolId: sid, status: "ACTIVE" } });
  await setEntitlement(rh, emp.id, year, "ANNUAL", 45);
  await provisionLeaveBalances(rh, year);
  const bal = await prisma.leaveBalance.findFirst({ where: { employeeId: emp.id, year, type: "ANNUAL" } });
  check("correction RH (45j) préservée après re-provisionnement", bal?.entitled === 45);

  const req = await requestLeave(rh, emp.id, { type: "SICK", startDate: new Date(year, 11, 24), endDate: new Date(year, 11, 26), reason: "test RH-9" });
  check("demande SICK créée", req.ok === true);
  if (req.ok) {
    const dec = await decideLeave(rh, req.result.id, true);
    check("approbation via règle SICK provisionnée", dec.ok === true);
  }

  const cfg0 = await getPayrollConfig(paie);
  check("cap par défaut 3000 pb", cfg0.ok === true && cfg0.result.advanceCapBp === 3000);
  check("cap modifié à 25 %", (await setAdvanceCap(paie, 2500)).ok === true);
  const cfg1 = await getPayrollConfig(paie);
  check("cap lu = 2500 pb", cfg1.ok === true && cfg1.result.advanceCapBp === 2500);
  check("cap > 100 % refusé", (await setAdvanceCap(paie, 15000)).ok === false);
  check("cap non-entier refusé", (await setAdvanceCap(paie, 12.5)).ok === false);
  await setAdvanceCap(paie, 3000);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
