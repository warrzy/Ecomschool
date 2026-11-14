/**
 * Jeu de données DÉMO — école « ÉCOLE DÉMO VALIDATION » (préprod uniquement).
 * Employés fictifs + run de paie CALCULÉ mais non validé — paramètres fictifs,
 * aucune retenue réglementaire. Idempotent (matricules DEMO-*).
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { upsertComponent, createRun, computeRun } from "@/lib/services/hr/payroll";
import { installStarterPlan, openExercise } from "@/lib/services/accounting";

const SLUG = "demo-validation";

async function main() {
  const school = await prisma.school.findUniqueOrThrow({ where: { slug: SLUG } });
  const admin = await prisma.schoolMembership.findFirstOrThrow({
    where: { schoolId: school.id, role: { name: "PAIE_DEMO" } }, select: { userId: true },
  });
  const ctx = { userId: admin.userId, schoolId: school.id };

  await installStarterPlan(ctx);
  const now = new Date();
  const ex = await prisma.accountingExercise.findFirst({ where: { schoolId: school.id, isOpen: true } })
    ?? (await openExercise(ctx, {
      name: `${now.getFullYear()}`,
      startDate: new Date(now.getFullYear(), 0, 1), endDate: new Date(now.getFullYear(), 11, 31),
    })).then((r) => (r.ok ? prisma.accountingExercise.findFirstOrThrow({ where: { schoolId: school.id, isOpen: true } }) : null));
  console.log("Exercice comptable :", ex?.name ?? "—");

  const staff = [
    { matricule: "DEMO-E1", firstName: "Awa", lastName: "Fictive", category: "TEACHING" as const, salary: 150000, position: "Institutrice (démo)" },
    { matricule: "DEMO-E2", firstName: "Karim", lastName: "Fictif", category: "NON_TEACHING" as const, salary: 90000, position: "Comptable (démo)" },
  ];
  for (const s of staff) {
    let emp = await prisma.employee.findFirst({ where: { schoolId: school.id, matricule: s.matricule } });
    if (!emp) {
      const r = await createEmployee(ctx, { matricule: s.matricule, firstName: s.firstName, lastName: s.lastName, category: s.category, hireDate: new Date(now.getFullYear(), 0, 15) });
      emp = r.ok ? await prisma.employee.findFirstOrThrow({ where: { id: r.result.id } }) : null;
    }
    if (emp && !(await prisma.employeeContract.count({ where: { employeeId: emp.id, status: "ACTIVE" } }))) {
      await createContract(ctx, emp.id, { type: "CDI", position: s.position, startDate: new Date(now.getFullYear(), 0, 15), baseSalary: s.salary, activate: true });
    }
  }
  console.log("Employés démo : 2");

  await upsertComponent(ctx, {
    code: "PRIME_DEMO", label: "Prime de démonstration (fictive)", kind: "EARNING",
    formula: { type: "percent", base: "base_salary", rate: 10 }, order: 10, activeFrom: new Date("2020-01-01"),
  });
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  let run = await prisma.payrollRun.findFirst({ where: { schoolId: school.id, periodStart: month } });
  if (!run) {
    const r = await createRun(ctx, { periodStart: month, periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0) });
    if (r.ok) run = await prisma.payrollRun.findFirstOrThrow({ where: { id: r.result.id } });
  }
  if (run && run.status === "DRAFT") {
    const c = await computeRun(ctx, run.id);
    console.log("Run paie démo :", c.ok ? `${c.result.payslips} bulletin(s) calculés — statut ${run.status} (non validé, fictif)` : c.error);
  } else {
    console.log("Run paie démo déjà présent :", run?.status);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
