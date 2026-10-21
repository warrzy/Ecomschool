import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { teacherIdForUser } from "@/lib/services/attendance";
import type { AssessmentStatus } from "@prisma/client";

export type AssessmentError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATUS"
  | "YEAR_CLOSED"
  | "PERIOD_LOCKED"
  | "CROSS_YEAR"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type AssessmentResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: AssessmentError };

type SchoolCtx = { userId: string; schoolId: string };

export const DEFAULT_ASSESSMENT_TYPES = [
  { code: "INTERROGATION", name: "Interrogation", defaultCoefficient: 1 },
  { code: "DEVOIR", name: "Devoir", defaultCoefficient: 1 },
  { code: "COMPOSITION", name: "Composition", defaultCoefficient: 2 },
  { code: "EXAMEN_BLANC", name: "Examen blanc", defaultCoefficient: 2 },
] as const;

export async function listAssessmentTypes(ctx: SchoolCtx) {
  return prisma.assessmentType.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { order: "asc" },
  });
}

/** Crée les types par défaut si l'école n'en a pas encore. */
export async function ensureDefaultAssessmentTypes(ctx: SchoolCtx) {
  await prisma.assessmentType.createMany({
    data: DEFAULT_ASSESSMENT_TYPES.map((t, i) => ({
      schoolId: ctx.schoolId,
      code: t.code,
      name: t.name,
      defaultCoefficient: t.defaultCoefficient,
      order: i,
    })),
    skipDuplicates: true,
  });
  return listAssessmentTypes(ctx);
}

export async function createAssessmentType(
  ctx: SchoolCtx,
  input: { code: string; name: string; defaultCoefficient?: number },
) {
  const code = input.code.trim().toUpperCase();
  if (!code || !input.name.trim()) return { ok: false as const, error: "INVALID_INPUT" as const };
  const exists = await prisma.assessmentType.findFirst({
    where: { schoolId: ctx.schoolId, code },
    select: { id: true },
  });
  if (exists) return { ok: false as const, error: "ALREADY_EXISTS" as const };
  const type = await prisma.assessmentType.create({
    data: {
      schoolId: ctx.schoolId,
      code,
      name: input.name.trim(),
      defaultCoefficient: input.defaultCoefficient ?? 1,
    },
  });
  return { ok: true as const, result: type };
}

/**
 * Vérifie qu'un enseignant (compte) est affecté au couple classe/matière.
 * Retourne true aussi pour les non-enseignants (admins) — à combiner avec
 * la vérification de permission côté action.
 */
export async function teacherAllowed(
  ctx: SchoolCtx,
  teacherId: string,
  classroomId: string,
  subjectId: string,
): Promise<boolean> {
  const n = await prisma.teachingAssignment.count({
    where: {
      schoolId: ctx.schoolId,
      teacherId,
      classroomId,
      OR: [{ subjectId }, { subjectId: null }],
    },
  });
  if (n > 0) return true;
  const cs = await prisma.classroomSubject.count({
    where: { schoolId: ctx.schoolId, classroomId, subjectId, teacherId },
  });
  return cs > 0;
}

export interface AssessmentInput {
  academicYearId: string;
  academicPeriodId?: string | null;
  classroomId: string;
  subjectId: string;
  teacherId?: string | null;
  typeId: string;
  title: string;
  date: Date;
  maxScore?: number;
  coefficient?: number;
  description?: string;
}

async function checkRefs(
  ctx: SchoolCtx,
  input: AssessmentInput,
): Promise<{ error: AssessmentError | null }> {
  const [year, classroom, subject, type, period] = await Promise.all([
    prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    }),
    prisma.classroom.findFirst({
      where: { id: input.classroomId, schoolId: ctx.schoolId },
      select: { id: true, academicYearId: true },
    }),
    prisma.subject.findFirst({ where: { id: input.subjectId, schoolId: ctx.schoolId }, select: { id: true } }),
    prisma.assessmentType.findFirst({ where: { id: input.typeId, schoolId: ctx.schoolId }, select: { id: true } }),
    input.academicPeriodId
      ? prisma.academicPeriod.findFirst({
          where: { id: input.academicPeriodId, schoolId: ctx.schoolId },
          select: { id: true, isLocked: true, academicYearId: true },
        })
      : Promise.resolve({ id: "", isLocked: false, academicYearId: "" }),
  ]);
  if (!year || !classroom || !subject || !type || !period) {
    return { error: "NOT_FOUND" };
  }
  if (year.status === "CLOSED") return { error: "YEAR_CLOSED" };
  if (classroom.academicYearId !== input.academicYearId) {
    return { error: "CROSS_YEAR" };
  }
  if (
    input.academicPeriodId &&
    (period.academicYearId !== input.academicYearId || period.isLocked)
  ) {
    return {
      error: period.academicYearId !== input.academicYearId
        ? "CROSS_YEAR"
        : "PERIOD_LOCKED",
    };
  }
  if (input.teacherId) {
    const t = await prisma.teacher.findFirst({
      where: { id: input.teacherId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!t) return { error: "NOT_FOUND" };
  }
  return { error: null };
}

export async function createAssessment(
  ctx: SchoolCtx,
  input: AssessmentInput,
  opts: { asTeacher?: boolean } = {},
): Promise<AssessmentResult<{ id: string }>> {
  if (!input.title.trim()) return { ok: false, error: "INVALID_INPUT" };
  const refs = await checkRefs(ctx, input);
  if (refs.error) return { ok: false, error: refs.error };

  // Enseignant connecté : limité à ses affectations.
  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (!tid) return { ok: false, error: "FORBIDDEN" };
    const allowed = await teacherAllowed(ctx, tid, input.classroomId, input.subjectId);
    if (!allowed) return { ok: false, error: "FORBIDDEN" };
    input.teacherId = tid;
  }

  try {
    const a = await prisma.assessment.create({
      data: {
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
        academicPeriodId: input.academicPeriodId ?? null,
        classroomId: input.classroomId,
        subjectId: input.subjectId,
        teacherId: input.teacherId ?? null,
        typeId: input.typeId,
        title: input.title.trim(),
        date: input.date,
        maxScore: input.maxScore ?? 20,
        coefficient: input.coefficient ?? 1,
        description: input.description ?? null,
        status: "OPEN",
        createdById: ctx.userId,
      },
    });
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "assessment.create", entity: "Assessment", entityId: a.id });
    return { ok: true, result: { id: a.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function listAssessments(
  ctx: SchoolCtx,
  filters: {
    academicYearId?: string;
    academicPeriodId?: string;
    classroomId?: string;
    subjectId?: string;
    teacherId?: string;
    status?: AssessmentStatus;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const where = {
    schoolId: ctx.schoolId,
    ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
    ...(filters.academicPeriodId ? { academicPeriodId: filters.academicPeriodId } : {}),
    ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.assessment.count({ where }),
    prisma.assessment.findMany({
      where,
      include: {
        classroom: { select: { name: true } },
        subject: { select: { name: true } },
        teacher: { select: { firstName: true, lastName: true } },
        type: { select: { name: true, code: true } },
        academicPeriod: { select: { name: true } },
        _count: { select: { grades: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, items, page, pageSize };
}

export async function getAssessment(ctx: SchoolCtx, id: string) {
  return prisma.assessment.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      classroom: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, firstName: true, lastName: true } },
      type: { select: { name: true, code: true } },
      academicPeriod: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true } },
    },
  });
}

const TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["VALIDATED", "OPEN"],
  VALIDATED: ["PUBLISHED", "OPEN"],
  PUBLISHED: [],
  CANCELLED: [],
};

export async function setAssessmentStatus(
  ctx: SchoolCtx,
  id: string,
  status: AssessmentStatus,
  opts: { asTeacher?: boolean } = {},
): Promise<AssessmentResult> {
  const a = await prisma.assessment.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: {
      id: true,
      status: true,
      teacherId: true,
      classroomId: true,
      subjectId: true,
      academicYear: { select: { status: true } },
      academicPeriod: { select: { isLocked: true } },
    },
  });
  if (!a) return { ok: false, error: "NOT_FOUND" };
  if (a.academicYear.status === "CLOSED") {
    return { ok: false, error: "YEAR_CLOSED" };
  }
  // Période verrouillée : seule VALIDATED→PUBLISHED reste permise
  // (diffusion administrative, sans impact sur les notes). Toute
  // transition vers OPEN (réouverture) ou CANCELLED (retrait d'une
  // évaluation des calculs ultérieurs) est refusée — sinon un recalcul
  // de la période divergerait des bulletins déjà émis.
  if (a.academicPeriod?.isLocked) {
    const allowed = a.status === "VALIDATED" && status === "PUBLISHED";
    if (!allowed) return { ok: false, error: "PERIOD_LOCKED" };
  }
  if (!TRANSITIONS[a.status].includes(status)) {
    return { ok: false, error: "INVALID_STATUS" };
  }
  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (!tid || !(await teacherAllowed(ctx, tid, a.classroomId, a.subjectId))) {
      return { ok: false, error: "FORBIDDEN" };
    }
  }
  await prisma.assessment.update({ where: { id: a.id }, data: { status } });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: `assessment.${status.toLowerCase()}`, entity: "Assessment", entityId: a.id });
  return { ok: true, result: undefined };
}
