/** Recette RH-2 — congés, soldes, présences sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { createEmployee } from "@/lib/services/hr/employees";
import { requestLeave, decideLeave, cancelLeave, setEntitlement, listLeaves, balancesFor, markAttendance, attendanceReport } from "@/lib/services/hr/leaves";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH2 A", code: `RH2A${ts}`, slug: `rh2a-${ts}` } });
  const u = await prisma.user.create({ data: { email: `rh2-${ts}@test.local`, passwordHash: "x" } });
  const v = await prisma.user.create({ data: { email: `rh2r-${ts}@test.local`, passwordHash: "x" } });
  const mk = async (userId: string, keys: string[]) => {
    const role = await prisma.role.create({ data: { name: `RH2_${userId.slice(-4)}`, scope: "SCHOOL", schoolId: A.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId, schoolId: A.id, roleId: role.id } });
  };
  await mk(u.id, ["hr.read", "hr.manage"]);
  await mk(v.id, ["hr.read"]);
  const ctx = { userId: u.id, schoolId: A.id }, ctxR = { userId: v.id, schoolId: A.id };

  const e = await createEmployee(ctx, { matricule: "L1", firstName: "Awa", lastName: "Traoré", category: "NON_TEACHING" });
  if (!e.ok) throw new Error("emp");
  const emp = e.result.id;
  const y = new Date().getFullYear();

  console.log("== Soldes & demandes ==");
  await setEntitlement(ctx, emp, y, "ANNUAL", 30);
  const bal0 = await balancesFor(ctx, emp, y);
  check("droit 30j posé", bal0.ok === true && bal0.result[0].entitled === 30 && bal0.result[0].used === 0);

  const r1 = await requestLeave(ctx, emp, { type: "ANNUAL", startDate: new Date(`${y}-03-02`), endDate: new Date(`${y}-03-11`) });
  check("demande 10j calendaires", r1.ok === true && r1.result.days === 10);
  const r1id = r1.ok ? r1.result.id : "";
  const deny = await requestLeave(ctxR, emp, { type: "ANNUAL", startDate: new Date(), endDate: new Date() });
  check("demande refusée sans manage", !deny.ok && deny.error === "FORBIDDEN");

  const ap = await decideLeave(ctx, r1id, true);
  check("approbation OK", ap.ok === true);
  const bal1 = await balancesFor(ctx, emp, y);
  check("solde débité 10/30 (reste 20)", bal1.ok === true && bal1.result[0].used === 10);

  const r2 = await requestLeave(ctx, emp, { type: "ANNUAL", startDate: new Date(`${y}-04-01`), endDate: new Date(`${y}-04-30`) });
  const ap2 = await decideLeave(ctx, r2.ok ? r2.result.id : "", true);
  check("30j > reste 20 → INSUFFICIENT_BALANCE", !ap2.ok && ap2.error === "INSUFFICIENT_BALANCE");
  const bal2 = await balancesFor(ctx, emp, y);
  check("solde inchangé après refus", bal2.ok === true && bal2.result[0].used === 10);
  const rej = await decideLeave(ctx, r2.ok ? r2.result.id : "", false, "planning");
  check("rejet OK", rej.ok === true);
  const ap3 = await decideLeave(ctx, r2.ok ? r2.result.id : "", true);
  check("re-décision refusée", !ap3.ok && ap3.error === "NOT_FOUND_OR_DECIDED");

  const rU = await requestLeave(ctx, emp, { type: "UNPAID", startDate: new Date(`${y}-05-04`), endDate: new Date(`${y}-05-08`) });
  await decideLeave(ctx, rU.ok ? rU.result.id : "", true);
  const bal3 = await balancesFor(ctx, emp, y);
  check("UNPAID sans consommer le solde", bal3.ok === true && bal3.result[0].used === 10);

  const cx = await cancelLeave(ctx, r1id);
  check("annulation restaure le solde", cx.ok === true && (await balancesFor(ctx, emp, y)).result![0].used === 0);
  const cx2 = await cancelLeave(ctx, r1id);
  check("re-annulation refusée", !cx2.ok);

  console.log("== Présences ==");
  await markAttendance(ctx, emp, new Date(`${y}-06-01`), "PRESENT");
  await markAttendance(ctx, emp, new Date(`${y}-06-02`), "LATE", "retard transport");
  await markAttendance(ctx, emp, new Date(`${y}-06-02`), "PRESENT"); // upsert même jour
  const rep = await attendanceReport(ctx, new Date(`${y}-06-01`), new Date(`${y}-06-30`));
  check("rapport : 2 présences (upsert, pas de doublon)", rep.ok === true && rep.result[0].PRESENT === 2 && rep.result[0].LATE === 0);
  const att = await prisma.staffAttendance.count({ where: { employeeId: emp } });
  check("1 ligne/jour (clé unique)", att === 2);

  console.log("== Isolation ==");
  const B = await prisma.school.create({ data: { name: "RH2 B", code: `RH2B${ts}`, slug: `rh2b-${ts}` } });
  const lB = await listLeaves({ userId: u.id, schoolId: B.id }, {});
  check("congés A invisibles depuis B", !lB.ok || lB.result.length === 0);
  const all = await listLeaves(ctx, {});
  check("3 demandes visibles", all.ok === true && all.result.length === 3);

  console.log(`\n=== RH-2 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
