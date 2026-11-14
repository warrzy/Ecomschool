/**
 * Jeu de données DÉMO — école « ÉCOLE DÉMO VALIDATION » (préprod uniquement).
 * Employés fictifs + run de paie CALCULÉ mais non validé — paramètres fictifs,
 * aucune retenue réglementaire. Idempotent (matricules DEMO-*).
 * Utilise les comptes cloisonnés : RH_DEMO (employés), PAIE_DEMO (paie),
 * COMPTABLE_DEMO (plan/exercice) — séparation des fonctions.
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { upsertComponent, createRun, computeRun } from "@/lib/services/hr/payroll";
import { installStarterPlan, openExercise } from "@/lib/services/accounting";

const SLUG = "demo-validation";
const ctxFor = async (roleName: string, schoolId: string) => {
  const m = await prisma.schoolMembership.findFirstOrThrow({
    where: { schoolId, role: { name: roleName } }, select: { userId: true },
  });
  return { userId: m.userId, schoolId };
};

async function main() {
  const school = await prisma.school.findUniqueOrThrow({ where: { slug: SLUG } });
  const rh = await ctxFor("RH_DEMO", school.id);
  const paie = await ctxFor("PAIE_DEMO", school.id);
  const compta = await ctxFor("COMPTABLE_DEMO", school.id);

  const plan = await installStarterPlan(compta);
  const now = new Date();
  let ex = await prisma.accountingExercise.findFirst({ where: { schoolId: school.id, status: "OPEN" } });
  if (!ex) {
    const r = await openExercise(compta, {
      name: `${now.getFullYear()}`,
      startDate: new Date(now.getFullYear(), 0, 1), endDate: new Date(now.getFullYear(), 11, 31),
    });
    if (r.ok) ex = await prisma.accountingExercise.findFirstOrThrow({ where: { schoolId: school.id, status: "OPEN" } });
  }
  console.log("Compta :", plan.ok ? "plan OK" : plan.error, "| exercice :", ex?.name ?? "—");

  const staff = [
    { matricule: "DEMO-E1", firstName: "Awa", lastName: "Fictive", category: "TEACHING" as const, salary: 150000, position: "Institutrice (démo)" },
    { matricule: "DEMO-E2", firstName: "Karim", lastName: "Fictif", category: "NON_TEACHING" as const, salary: 90000, position: "Comptable (démo)" },
  ];
  for (const s of staff) {
    let emp = await prisma.employee.findFirst({ where: { schoolId: school.id, matricule: s.matricule } });
    if (!emp) {
      const r = await createEmployee(rh, { matricule: s.matricule, firstName: s.firstName, lastName: s.lastName, category: s.category, hireDate: new Date(now.getFullYear(), 0, 15) });
      if (r.ok) emp = await prisma.employee.findFirstOrThrow({ where: { id: r.result.id } });
      else console.warn("  employé", s.matricule, ":", r.error);
    }
    if (emp && !(await prisma.employeeContract.count({ where: { employeeId: emp.id, status: "ACTIVE" } }))) {
      const c = await createContract(rh, emp.id, { type: "CDI", position: s.position, startDate: new Date(now.getFullYear(), 0, 15), baseSalary: s.salary, activate: true });
      if (!c.ok) console.warn("  contrat", s.matricule, ":", c.error);
    }
  }
  console.log("Employés démo :", await prisma.employee.count({ where: { schoolId: school.id } }));

  const comp = await upsertComponent(paie, {
    code: "PRIME_DEMO", label: "Prime de démonstration (fictive)", kind: "EARNING",
    formula: { type: "percent", base: "base_salary", rate: 10 }, order: 10, activeFrom: new Date("2020-01-01"),
  });
  if (!comp.ok) console.warn("  composant :", comp.error);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  let run = await prisma.payrollRun.findFirst({ where: { schoolId: school.id, periodStart: month } });
  if (!run) {
    const r = await createRun(paie, { periodStart: month, periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0) });
    if (r.ok) run = await prisma.payrollRun.findFirstOrThrow({ where: { id: r.result.id } });
    else console.warn("  run :", r.error);
  }
  if (run && run.status === "DRAFT") {
    const c = await computeRun(paie, run.id);
    console.log("Run paie démo :", c.ok ? `${c.result.payslips} bulletin(s) — statut DRAFT (non validé, fictif)` : c.error);
  } else {
    console.log("Run paie démo déjà présent :", run?.status);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
