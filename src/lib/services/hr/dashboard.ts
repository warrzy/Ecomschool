/** RH-7 — Tableau de bord RH : effectifs, masse salariale, alertes contrats J-30 (une alerte unique par contrat). */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });

export async function hrDashboard(ctx: Ctx) {
  if (!(await userHasSchoolPermission({ ...ctx, permissionKey: "hr.read" }))) return err("FORBIDDEN");
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400_000);
  const sid = ctx.schoolId;
  const [headcount, byCategory, activeContracts, expiring, pendingLeaves, lastRuns] = await Promise.all([
    prisma.employee.count({ where: { schoolId: sid, status: "ACTIVE" } }),
    prisma.employee.groupBy({ by: ["category"], where: { schoolId: sid, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.employeeContract.findMany({
      where: { status: "ACTIVE", employee: { schoolId: sid, status: "ACTIVE" } },
      select: { baseSalary: true, type: true },
    }),
    prisma.employeeContract.findMany({
      where: { status: "ACTIVE", endDate: { not: null, lte: in30 }, employee: { schoolId: sid, status: "ACTIVE" } },
      include: { employee: { select: { matricule: true, firstName: true, lastName: true } } },
      orderBy: { endDate: "asc" },
    }),
    prisma.leaveRequest.count({ where: { schoolId: sid, status: "PENDING" } }),
    prisma.payrollRun.findMany({
      where: { schoolId: sid }, orderBy: { periodEnd: "desc" }, take: 3,
      include: { _count: { select: { payslips: true } } },
    }),
  ]);
  return ok({
    headcount,
    byCategory: byCategory.map((c) => ({ category: c.category, count: c._count._all })),
    payrollMass: activeContracts.reduce((s, c) => s + c.baseSalary, 0),
    expiringContracts: expiring.map((c) => ({
      id: c.id, type: c.type, endDate: c.endDate, position: c.position,
      employee: c.employee,
      daysLeft: c.endDate ? Math.ceil((c.endDate.getTime() - now.getTime()) / 86400_000) : null,
    })),
    pendingLeaves,
    lastRuns: lastRuns.map((r) => ({ id: r.id, period: r.periodStart.toISOString().slice(0, 7), status: r.status, payslips: r._count.payslips })),
  });
}
