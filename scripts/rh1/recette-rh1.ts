/** Recette RH-1 — référentiel personnel sur base ISOLÉE. */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { listEmployees, getEmployee, createEmployee, createContract, activateContract, departEmployee, addDocument } from "@/lib/services/hr/employees";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function member(userId: string, schoolId: string, keys: string[]) {
  const role = await prisma.role.create({ data: { name: `RH1_${userId.slice(-4)}_${schoolId.slice(-3)}`, scope: "SCHOOL", schoolId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId, schoolId, roleId: role.id } });
}

async function main() {
  const ts = Date.now() % 1e7;
  const A = await prisma.school.create({ data: { name: "RH1 A", code: `RH1A${ts}`, slug: `rh1a-${ts}` } });
  const B = await prisma.school.create({ data: { name: "RH1 B", code: `RH1B${ts}`, slug: `rh1b-${ts}` } });
  const u = await prisma.user.create({ data: { email: `rh1-${ts}@test.local`, passwordHash: "x" } });
  const v = await prisma.user.create({ data: { email: `rh1r-${ts}@test.local`, passwordHash: "x" } });
  await member(u.id, A.id, ["hr.read", "hr.manage"]);
  await member(v.id, A.id, ["hr.read"]);
  const ctx = { userId: u.id, schoolId: A.id }, ctxR = { userId: v.id, schoolId: A.id }, ctxB = { userId: u.id, schoolId: B.id };

  console.log("== Employés ==");
  const teacher = await prisma.teacher.create({ data: { schoolId: A.id, firstName: "Marie", lastName: "Kaboré" } });
  const e1 = await createEmployee(ctx, { matricule: "EMP-001", firstName: "Marie", lastName: "Kaboré", category: "TEACHING", teacherId: teacher.id, hireDate: new Date("2025-09-01") });
  check("employé enseignant créé + lien Teacher", e1.ok === true);
  const e1id = e1.ok ? e1.result.id : "";
  const e2 = await createEmployee(ctx, { matricule: "EMP-002", firstName: "Issouf", lastName: "Sawadogo", category: "NON_TEACHING" });
  check("employé non enseignant créé", e2.ok === true);
  const dup = await createEmployee(ctx, { matricule: "EMP-001", firstName: "X", lastName: "Y", category: "NON_TEACHING" });
  check("matricule dupliqué refusé", !dup.ok);
  const denied = await createEmployee(ctxR, { matricule: "E", firstName: "R", lastName: "R", category: "NON_TEACHING" });
  check("manage refusé en lecture seule", !denied.ok && denied.error === "FORBIDDEN");

  console.log("== Contrats & avenants ==");
  const c1 = await createContract(ctx, e1id, { type: "CDD", position: "Enseignante SVT", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), baseSalary: 120000, activate: true });
  check("contrat actif créé", c1.ok === true);
  const c1id = c1.ok ? c1.result.id : "";
  const amend = await createContract(ctx, e1id, { type: "CDI", position: "Enseignante SVT titulaire", startDate: new Date("2026-01-01"), baseSalary: 150000, amendsContractId: c1id, activate: true });
  check("avenant créé", amend.ok === true);
  const contracts = await prisma.employeeContract.findMany({ where: { employeeId: e1id }, orderBy: { startDate: "asc" } });
  check("parent passé ENDED à la date d'avenant", contracts[0]?.status === "ENDED" && +contracts[0].endDate! === +new Date("2026-01-01"));
  check("avenant ACTIVE (1 seul actif)", contracts[1]?.status === "ACTIVE" && contracts.filter((x) => x.status === "ACTIVE").length === 1);
  check("amendsContractId chaîné", contracts[1]?.amendsContractId === c1id);
  const badAmend = await createContract(ctx, e1id, { type: "CDI", position: "X", startDate: new Date(), baseSalary: 1, amendsContractId: c1id });
  check("avenant sur contrat non actif refusé", !badAmend.ok && badAmend.error === "AMEND_TARGET_INVALID");
  const c2 = await createContract(ctx, e1id, { type: "VACATION", position: "Vacations", startDate: new Date("2026-02-01"), baseSalary: 5000 });
  const act = await activateContract(ctx, c2.ok ? c2.result.id : "");
  check("activation : ex-actif passe ENDED", act.ok === true);
  const actives = await prisma.employeeContract.count({ where: { employeeId: e1id, status: "ACTIVE" } });
  check("toujours 1 seul actif", actives === 1);

  console.log("== Documents, sortie, isolation ==");
  const doc = await addDocument(ctx, e1id, { kind: "CNIB", label: "Carte nationale" });
  check("document ajouté", doc.ok === true);
  const det = await getEmployee(ctx, e1id);
  check("fiche complète (contrats+docs)", det.ok === true && det.result.contracts.length === 3 && det.result.documents.length === 1);
  const list = await listEmployees(ctx, { q: "kaboré" });
  check("recherche insensible casse", list.ok === true && list.result.length === 1);
  const dep = await departEmployee(ctx, e1id, new Date("2026-03-31"));
  check("sortie enregistrée", dep.ok === true);
  const after = await getEmployee(ctx, e1id);
  check("statut DEPARTED + contrats terminés", after.ok === true && after.result.status === "DEPARTED"
    && after.result.contracts.every((x) => x.status === "ENDED"));
  const listB = await listEmployees(ctxB, {});
  check("isolation B : accès refusé sans membership", !listB.ok && listB.error === "FORBIDDEN");
  const detB = await getEmployee({ userId: u.id, schoolId: A.id }, e1id);
  check("fiche A jamais dans B", detB.ok === true);
  const listR = await listEmployees(ctxR, {});
  check("lecture autorisée pour reader", listR.ok === true && listR.result.length === 2);

  console.log(`\n=== RH-1 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
