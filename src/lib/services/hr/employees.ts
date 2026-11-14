/**
 * RH-1 — Référentiel du personnel : employés, contrats, avenants chaînés.
 * Employee ≠ Teacher (pédagogie) ≠ User (accès) — liens optionnels.
 * Avenant : nouveau contrat lié via amendsContractId ; le parent passe ENDED
 * dans la même transaction (jamais d'UPDATE sur l'historique).
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

export async function listEmployees(ctx: Ctx, filter?: { q?: string; status?: string; category?: string }) {
  if (!(await has(ctx, "hr.read"))) return err("FORBIDDEN");
  const rows = await prisma.employee.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filter?.status ? { status: filter.status as never } : {}),
      ...(filter?.category ? { category: filter.category as never } : {}),
      ...(filter?.q ? {
        OR: [
          { firstName: { contains: filter.q, mode: "insensitive" } },
          { lastName: { contains: filter.q, mode: "insensitive" } },
          { matricule: { contains: filter.q, mode: "insensitive" } },
        ],
      } : {}),
    },
    include: {
      teacher: { select: { id: true } },
      contracts: { where: { status: "ACTIVE" }, select: { position: true, type: true, baseSalary: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return ok(rows);
}

export async function getEmployee(ctx: Ctx, id: string) {
  if (!(await has(ctx, "hr.read"))) return err("FORBIDDEN");
  const e = await prisma.employee.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      teacher: { select: { id: true, firstName: true, lastName: true } },
      contracts: { orderBy: { startDate: "desc" } },
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
  return e ? ok(e) : err("NOT_FOUND");
}

export async function createEmployee(ctx: Ctx, input: {
  matricule: string; firstName: string; lastName: string;
  category: "TEACHING" | "NON_TEACHING";
  sex?: "MALE" | "FEMALE"; birthDate?: Date; phone?: string; email?: string;
  nationalId?: string; hireDate?: Date; teacherId?: string; userId?: string;
}): Promise<Res<{ id: string }>> {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  if (!input.matricule.trim() || !input.firstName.trim() || !input.lastName.trim())
    return err("INVALID_INPUT");
  if (input.teacherId) {
    const t = await prisma.teacher.findFirst({ where: { id: input.teacherId, schoolId: ctx.schoolId } });
    if (!t) return err("NOT_FOUND");
  }
  try {
    const e = await prisma.employee.create({ data: { schoolId: ctx.schoolId, ...input } });
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "hr.employee.create", entity: "Employee", entityId: e.id });
    return ok({ id: e.id });
  } catch { return err("MATRICULE_TAKEN"); }
}

export async function updateEmployee(ctx: Ctx, id: string, input: Partial<{
  firstName: string; lastName: string; phone: string; email: string;
  nationalId: string; hireDate: Date; teacherId: string; userId: string;
}>) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const r = await prisma.employee.updateMany({ where: { id, schoolId: ctx.schoolId }, data: input });
  return r.count ? ok({ id }) : err("NOT_FOUND");
}

/** Contrat ou avenant : si amendsContractId, le parent passe ENDED transactionnellement. */
export async function createContract(ctx: Ctx, employeeId: string, input: {
  type: "CDI" | "CDD" | "VACATION" | "INTERN"; position: string;
  startDate: Date; endDate?: Date; baseSalary: number;
  amendsContractId?: string; activate?: boolean;
}): Promise<Res<{ id: string }>> {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId } });
  if (!emp) return err("NOT_FOUND");
  if (!input.position.trim() || input.baseSalary < 0 || (input.endDate && input.endDate < input.startDate))
    return err("INVALID_INPUT");
  try {
    const c = await prisma.$transaction(async (tx) => {
      if (input.amendsContractId) {
        const parent = await tx.employeeContract.updateMany({
          where: { id: input.amendsContractId, employeeId, status: "ACTIVE" },
          data: { status: "ENDED", endDate: input.startDate },
        });
        if (parent.count === 0) throw new Error("AMEND_TARGET_INVALID");
      }
      const { activate, ...data } = input;
      return tx.employeeContract.create({
        data: { employeeId, ...data, status: activate ? "ACTIVE" : "DRAFT" },
      });
    });
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: input.amendsContractId ? "hr.contract.amend" : "hr.contract.create", entity: "EmployeeContract", entityId: c.id });
    return ok({ id: c.id });
  } catch (e) {
    return err(e instanceof Error && e.message === "AMEND_TARGET_INVALID" ? "AMEND_TARGET_INVALID" : "INVALID_STATE");
  }
}

export async function activateContract(ctx: Ctx, contractId: string) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const c = await prisma.employeeContract.findFirst({
    where: { id: contractId, employee: { schoolId: ctx.schoolId } },
  });
  if (!c) return err("NOT_FOUND");
  const r = await prisma.$transaction(async (tx) => {
    // Un seul contrat ACTIVE par employé.
    await tx.employeeContract.updateMany({
      where: { employeeId: c.employeeId, status: "ACTIVE" },
      data: { status: "ENDED", endDate: c.startDate },
    });
    return tx.employeeContract.update({ where: { id: contractId }, data: { status: "ACTIVE" } });
  });
  return ok({ id: r.id });
}

/** Sortie : statut DEPARTED + date + fin des contrats actifs — transactionnel (RH-D : la révocation des accès arrive en RH-8). */
export async function departEmployee(ctx: Ctx, id: string, departureDate: Date) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const r = await prisma.$transaction(async (tx) => {
    const u = await tx.employee.updateMany({
      where: { id, schoolId: ctx.schoolId, status: { not: "DEPARTED" } },
      data: { status: "DEPARTED", departureDate },
    });
    if (u.count === 0) throw new Error("NOT_FOUND");
    await tx.employeeContract.updateMany({
      where: { employeeId: id, status: { in: ["ACTIVE", "DRAFT"] } },
      data: { status: "ENDED", endDate: departureDate },
    });
    return u;
  }).catch(() => null);
  if (!r) return err("NOT_FOUND");
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "hr.employee.departure", entity: "Employee", entityId: id });
  return ok({ id });
}

export async function addDocument(ctx: Ctx, employeeId: string, input: { kind: string; label: string; fileUrl?: string }) {
  if (!(await has(ctx, "hr.manage"))) return err("FORBIDDEN");
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId }, select: { id: true } });
  if (!emp || !input.label.trim()) return err("INVALID_INPUT");
  const d = await prisma.employeeDocument.create({ data: { employeeId, ...input } });
  return ok({ id: d.id });
}
