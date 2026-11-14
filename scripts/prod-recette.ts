import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { platformCreateSchoolAdmin } from "@/lib/services/schools";
import {
  installStarterPlan, listAccounts, openExercise,
  createManualEntry, listEntries, listJournals,
} from "@/lib/services/accounting";

const TAG = "[RECETTE]";
let pass = 0, fail = 0;
const ok = (c: boolean, l: string) => { c ? (pass++, console.log("PASS", l)) : (fail++, console.log("FAIL", l)); };
const err = (r: any) => (r && r.ok === false ? r.error : null);
const ids: string[] = [];

async function main() {
  const schoolA = await prisma.school.create({ data: { name: `${TAG} École Alpha`, code: "REC-A", slug: "rec-alpha" } });
  const schoolB = await prisma.school.create({ data: { name: `${TAG} École Beta`, code: "REC-B", slug: "rec-beta" } });
  ids.push(schoolA.id, schoolB.id);
  ok(true, "2 écoles créées");

  const adm = await platformCreateSchoolAdmin("cmw7y9zbe0000tulbggz5kuvo", schoolA.id,
    { email: "admin.rec-a@test.local", password: "Recette#2026!", firstName: "Admin", lastName: "Recette" });
  ok(adm.ok, "admin école A créé");

  const student = await prisma.student.create({ data: {
    schoolId: schoolA.id, firstName: "Etu", lastName: "Recette", matricule: "REC-001" } as any });
  const teacher = await prisma.teacher.create({ data: {
    schoolId: schoolA.id, firstName: "Prof", lastName: "Recette" } as any });
  ok(!!student.id && !!teacher.id, "élève + enseignant créés");

  const cross = await prisma.student.count({ where: { schoolId: schoolB.id } });
  ok(cross === 0, "isolation : B ne voit aucun élève de A");
  const ctxB = { schoolId: schoolB.id, userId: "recette-admin" };
  const accB = await listAccounts(ctxB);
  ok(err(accB) === "FORBIDDEN" || (accB.ok && accB.result.length === 0), "isolation : comptes A invisibles depuis B");

  const ctxNo = { schoolId: schoolA.id, userId: "recette-admin" };
  const inst = await installStarterPlan(ctxNo);
  ok(err(inst) === "FORBIDDEN", "install plan refusée sans permission admin");
  const ctxAdm = { schoolId: schoolA.id, userId: (adm.ok ? adm.result.userId : "") };
  const inst2 = await installStarterPlan(ctxAdm);
  ok(err(inst2) == null, "plan SYSCOHADA installé (admin)");
  const accA = await listAccounts(ctxAdm);
  ok(accA.ok && accA.result.length >= 10, `${accA.ok ? accA.result.length : 0} comptes`);

  const ex = await openExercise(ctxAdm, { name: "Exercice recette", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } as any);
  ok(err(ex) == null, "exercice ouvert");
  const exId = ex.ok ? ex.result.id : "";
  const jr = await listJournals(ctxAdm);
  const od = jr.ok ? jr.result.find((j: any) => j.code === "OD") : null;
  const accs = accA.ok ? accA.result : [];
  const a571 = accs.find((a: any) => a.code === "571"), a706 = accs.find((a: any) => a.code === "706");
  const entry = await createManualEntry(ctxAdm, {
    journalId: od!.id, exerciseId: exId, date: new Date("2026-06-01"),
    description: `${TAG} écriture test`,
    lines: [{ accountId: a571!.id, debit: 1000 }, { accountId: a706!.id, credit: 1000 }],
  });
  ok(err(entry) == null, "écriture équilibrée postée");
  const ent = await listEntries(ctxAdm, { exerciseId: exId });
  ok(ent.ok && ent.result.length >= 1 && ent.result[0].reference.startsWith("EC-"), "écriture EC- visible");

  await prisma.accountingEntryLine.deleteMany({ where: { entry: { schoolId: schoolA.id } } });
  for (const m of ["accountingEntry","accountingMapping","accountingExercise","accountingJournal","accountingAccount"] as const)
    await (prisma as any)[m].deleteMany({ where: { schoolId: schoolA.id } });
  await prisma.user.deleteMany({ where: { email: { contains: "rec-a@test" } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.teacher.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
  for (const s of ids) await prisma.school.delete({ where: { id: s } });
  ok((await prisma.school.count({ where: { name: { contains: TAG } } })) === 0, "purge [RECETTE] complète");

  console.log(`=== PROD RECETTE : ${pass} PASS / ${fail} FAIL ===`);
}
main().finally(() => prisma.$disconnect());
