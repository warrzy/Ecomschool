import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { AcademicPeriodType } from "@prisma/client";

type ServiceError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "IS_CURRENT"
  | "YEAR_CLOSED"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type AcademicResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ServiceError };

type SchoolCtx = { userId: string; schoolId: string };

function periodTemplates(type: AcademicPeriodType) {
  return type === "SEMESTER"
    ? [
        { name: "Semestre 1", number: 1 },
        { name: "Semestre 2", number: 2 },
      ]
    : [
        { name: "Trimestre 1", number: 1 },
        { name: "Trimestre 2", number: 2 },
        { name: "Trimestre 3", number: 3 },
      ];
}

export async function listYears(ctx: SchoolCtx) {
  return prisma.academicYear.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      isCurrent: true,
      status: true,
      _count: { select: { periods: true } },
    },
  });
}

export async function createYear(
  ctx: SchoolCtx,
  input: {
    name: string;
    startDate: string;
    endDate: string;
    periodType: AcademicPeriodType;
    isCurrent: boolean;
  },
): Promise<AcademicResult<{ id: string }>> {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    const year = await prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({
          where: { schoolId: ctx.schoolId, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      const created = await tx.academicYear.create({
        data: {
          schoolId: ctx.schoolId,
          name: input.name,
          startDate,
          endDate,
          isCurrent: input.isCurrent,
          status: input.isCurrent ? "ACTIVE" : "DRAFT",
        },
        select: { id: true },
      });

      await tx.academicPeriod.createMany({
        data: periodTemplates(input.periodType).map((p) => ({
          academicYearId: created.id,
          schoolId: ctx.schoolId,
          name: p.name,
          number: p.number,
          startDate,
          endDate,
          type: input.periodType,
        })),
      });

      return created;
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "academicYear.create",
      entity: "AcademicYear",
      entityId: year.id,
      metadata: { name: input.name, isCurrent: input.isCurrent },
    });

    return { ok: true, result: { id: year.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function setCurrentYear(
  ctx: SchoolCtx,
  yearId: string,
): Promise<AcademicResult> {
  const year = await prisma.academicYear.findFirst({
    where: { id: yearId, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!year) return { ok: false, error: "NOT_FOUND" };
  if (year.status === "CLOSED") return { ok: false, error: "YEAR_CLOSED" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.academicYear.updateMany({
        where: { schoolId: ctx.schoolId, isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.academicYear.update({
        where: { id: yearId },
        data: { isCurrent: true, status: "ACTIVE" },
        select: { id: true },
      });
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "academicYear.setCurrent",
      entity: "AcademicYear",
      entityId: yearId,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function closeYear(
  ctx: SchoolCtx,
  yearId: string,
): Promise<AcademicResult> {
  const year = await prisma.academicYear.findFirst({
    where: { id: yearId, schoolId: ctx.schoolId },
    select: { id: true, isCurrent: true },
  });
  if (!year) return { ok: false, error: "NOT_FOUND" };
  if (year.isCurrent) return { ok: false, error: "IS_CURRENT" };

  try {
    await prisma.academicYear.update({
      where: { id: yearId },
      data: { status: "CLOSED" },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "academicYear.close",
      entity: "AcademicYear",
      entityId: yearId,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function updatePeriod(
  ctx: SchoolCtx,
  periodId: string,
  input: {
    name?: string;
    startDate?: string;
    endDate?: string;
    isLocked?: boolean;
  },
): Promise<AcademicResult> {
  const period = await prisma.academicPeriod.findFirst({
    where: { id: periodId, academicYear: { schoolId: ctx.schoolId } },
    select: { id: true, academicYear: { select: { status: true } } },
  });
  if (!period) return { ok: false, error: "NOT_FOUND" };
  if (period.academicYear.status === "CLOSED") {
    return { ok: false, error: "YEAR_CLOSED" };
  }

  const startDate = input.startDate ? new Date(input.startDate) : undefined;
  const endDate = input.endDate ? new Date(input.endDate) : undefined;
  if (
    (startDate && Number.isNaN(startDate.getTime())) ||
    (endDate && Number.isNaN(endDate.getTime()))
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    await prisma.academicPeriod.update({
      where: { id: periodId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(input.isLocked !== undefined ? { isLocked: input.isLocked } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "academicPeriod.update",
      entity: "AcademicPeriod",
      entityId: periodId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
