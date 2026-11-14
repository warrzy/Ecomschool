/**
 * RH-2 — Congés, soldes, présences du personnel.
 * Circuit : PENDING → APPROVED (décompte solde, transactionnel) / REJECTED ;
 * CANCELLED restaure le solde. Distinct de l'assiduité élèves.
 * Les jours sont calendaires (simple) ; UNPAID ne consomme pas de solde.
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });
type LeaveType = "ANNUAL" | "SICK" | "MATERNITY" | "UNPAID" | "OTHER";
type AttStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

const day = 86400000;
const days = (a: Date, b: Date) => Math.max(1, Math.round((+b - +a) / day) + 1);

export async function requestLeave(ctx: Ctx, employeeId: string, input: {
  type: LeaveType; startDate: Date; endDate: Date; reason?: string;
}): Promise<Res<{ id: string; days: number }>> {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId, status: "ACTIVE" } });
  if (!emp || input.endDate < input.startDate) return err("INVALID_INPUT");
  const r = await prisma.leaveRequest.create({
    data: { schoolId: ctx.schoolId, employeeId, days: days(input.startDate, input.endDate), ...input },
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "hr.leave.request", entity: "LeaveRequest", entityId: r.id });
  return ok({ id: r.id, days: r.days });
}

/** Décision hiérarchique : APPROVED débite le solde dans la même transaction. */
export async function decideLeave(ctx: Ctx, requestId: string, approve: boolean, note?: string) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const req = await prisma.leaveRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId, status: "PENDING" },
  });
  if (!req) return err("NOT_FOUND_OR_DECIDED");
  try {
    await prisma.$transaction(async (tx) => {
      if (approve && req.type !== "UNPAID") {
        const year = req.startDate.getFullYear();
        const bal = await tx.leaveBalance.upsert({
          where: { employeeId_year_type: { employeeId: req.employeeId, year, type: req.type } },
          create: { employeeId: req.employeeId, year, type: req.type, entitled: 0, used: 0 },
          update: {},
        });
        if (bal.used + req.days > bal.entitled) throw new Error("INSUFFICIENT_BALANCE");
        await tx.leaveBalance.update({ where: { id: bal.id }, data: { used: { increment: req.days } } });
      }
      await tx.leaveRequest.update({
        where: { id: req.id },
        data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null },
      });
    });
  } catch (e) { return err(e instanceof Error ? e.message : "INVALID_STATE"); }
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: `hr.leave.${approve ? "approve" : "reject"}`, entity: "LeaveRequest", entityId: requestId });
  return ok({ id: requestId });
}

/** Annulation : restaure le solde si le congé était approuvé. */
export async function cancelLeave(ctx: Ctx, requestId: string) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const req = await prisma.leaveRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId, status: { in: ["PENDING", "APPROVED"] } },
  });
  if (!req) return err("NOT_FOUND_OR_LOCKED");
  await prisma.$transaction(async (tx) => {
    if (req.status === "APPROVED" && req.type !== "UNPAID") {
      await tx.leaveBalance.updateMany({
        where: { employeeId: req.employeeId, year: req.startDate.getFullYear(), type: req.type },
        data: { used: { decrement: req.days } },
      });
    }
    await tx.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED" } });
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "hr.leave.cancel", entity: "LeaveRequest", entityId: requestId });
  return ok({ id: requestId });
}

export async function setEntitlement(ctx: Ctx, employeeId: string, year: number, type: LeaveType, entitledDays: number) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId }, select: { id: true } });
  if (!emp || entitledDays < 0) return err("INVALID_INPUT");
  await prisma.leaveBalance.upsert({
    where: { employeeId_year_type: { employeeId, year, type } },
    create: { employeeId, year, type, entitled: entitledDays },
    update: { entitled: entitledDays },
  });
  return ok({ id: employeeId });
}

export async function listLeaves(ctx: Ctx, filter?: { employeeId?: string; status?: string; from?: Date; to?: Date }) {
  if (!(await has(ctx, "hr.read"))) return err("FORBIDDEN");
  return ok(await prisma.leaveRequest.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filter?.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter?.status ? { status: filter.status as never } : {}),
      ...(filter?.from || filter?.to ? { startDate: { gte: filter.from ?? new Date(0), lte: filter.to ?? new Date("2999") } } : {}),
    },
    include: { employee: { select: { matricule: true, firstName: true, lastName: true } } },
    orderBy: { startDate: "desc" },
  }));
}

export async function balancesFor(ctx: Ctx, employeeId: string, year: number) {
  if (!(await has(ctx, "hr.read"))) return err("FORBIDDEN");
  return ok(await prisma.leaveBalance.findMany({ where: { employeeId, year, employee: { schoolId: ctx.schoolId } } }));
}

export async function markAttendance(ctx: Ctx, employeeId: string, date: Date, status: AttStatus, note?: string) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId }, select: { id: true } });
  if (!emp) return err("NOT_FOUND");
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  await prisma.staffAttendance.upsert({
    where: { employeeId_date: { employeeId, date: d } },
    create: { schoolId: ctx.schoolId, employeeId, date: d, status, note: note ?? null },
    update: { status, note: note ?? null },
  });
  return ok({ id: employeeId });
}

/** Synthèse présences par employé sur la période. */
export async function attendanceReport(ctx: Ctx, from: Date, to: Date) {
  if (!(await has(ctx, "hr.read"))) return err("FORBIDDEN");
  const rows = await prisma.staffAttendance.groupBy({
    by: ["employeeId", "status"],
    where: { schoolId: ctx.schoolId, date: { gte: from, lte: to } },
    _count: true,
  });
  const emps = await prisma.employee.findMany({
    where: { id: { in: [...new Set<string>(rows.map((r) => r.employeeId as string))] } },
    select: { id: true, matricule: true, firstName: true, lastName: true },
  });
  const byEmp = new Map(emps.map((e) => [e.id, { ...e, PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 } as typeof e & Record<AttStatus | "UNMARKED", number>]));
  for (const r of rows) byEmp.get(r.employeeId)![r.status as AttStatus] = r._count;
  return ok([...byEmp.values()]);
}
