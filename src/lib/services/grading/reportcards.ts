import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type ReportCardsError =
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "FORBIDDEN"
  | "CREATE_FAILED";

export type ReportCardsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ReportCardsError };

type SchoolCtx = { userId: string; schoolId: string };

/** Charge le snapshot complet d'un bulletin (stocké dans ReportCardVersion.payload). */
export async function buildReportCardPayload(
  ctx: SchoolCtx,
  studentId: string,
  academicPeriodId: string,
) {
  const result = await prisma.studentPeriodResult.findFirst({
    where: { schoolId: ctx.schoolId, studentId, academicPeriodId },
    include: {
      student: {
        select: {
          id: true, matricule: true, firstName: true, lastName: true, birthDate: true, sex: true,
        },
      },
      classroom: { select: { id: true, name: true, level: { select: { name: true, id: true } } } },
      academicPeriod: {
        select: {
          name: true, number: true, startDate: true, endDate: true,
          academicYear: { select: { name: true, id: true } },
        },
      },
    },
  });
  if (!result) return null;

  const [subjects, school, classSize, attendance] = await Promise.all([
    prisma.subjectPeriodResult.findMany({
      where: { schoolId: ctx.schoolId, studentId, academicPeriodId },
      include: { subject: { select: { name: true, code: true } } },
      orderBy: { subject: { name: "asc" } },
    }),
    prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { name: true, logoUrl: true, address: true, city: true, phone: true, email: true },
    }),
    prisma.enrollment.count({
      where: {
        schoolId: ctx.schoolId,
        classroomId: result.classroomId,
        status: "ENROLLED",
      },
    }),
    prisma.attendanceRecord.groupBy({
      by: ["status"],
      where: {
        schoolId: ctx.schoolId,
        studentId,
        date: {
          gte: result.academicPeriod.startDate,
          lte: result.academicPeriod.endDate,
        },
      },
      _count: true,
    }),
  ]);

  const absences = attendance.find((a) => a.status === "ABSENT")?._count ?? 0;
  const lates = attendance.find((a) => a.status === "LATE")?._count ?? 0;

  return {
    school,
    student: result.student,
    classroom: result.classroom,
    period: result.academicPeriod,
    classSize,
    generalAverage: result.generalAverage,
    rank: result.rank,
    mention: result.mention,
    status: result.status,
    absences,
    lates,
    subjects: subjects.map((s) => ({
      name: s.subject.name,
      average: s.average,
      coefficient: s.coefficient,
      weightedPoints: s.weightedPoints,
      rank: s.rank,
      appreciation: s.appreciation,
    })),
  };
}

/**
 * Génère (ou régénère en nouvelle version) le bulletin d'un élève.
 * Les résultats doivent être au moins CALCULATED.
 */
export async function generateReportCard(
  ctx: SchoolCtx,
  input: { studentId: string; academicPeriodId: string; reason?: string },
): Promise<ReportCardsResult<{ id: string; version: number }>> {
  const payload = await buildReportCardPayload(ctx, input.studentId, input.academicPeriodId);
  if (!payload) return { ok: false, error: "NOT_FOUND" };
  if (["DRAFT"].includes(payload.status)) {
    return { ok: false, error: "INVALID_STATUS" };
  }

  try {
    const card = await prisma.$transaction(async (tx) => {
      const existing = await tx.reportCard.findUnique({
        where: {
          academicPeriodId_studentId: {
            academicPeriodId: input.academicPeriodId,
            studentId: input.studentId,
          },
        },
      });
      const version = (existing?.currentVersion ?? 0) + 1;
      const seq = await tx.reportCard.count({ where: { schoolId: ctx.schoolId } });
      const card = existing
        ? await tx.reportCard.update({
            where: { id: existing.id },
            data: {
              currentVersion: version,
              status: existing.status === "PUBLISHED" ? "RECTIFIED" : existing.status,
              generatedById: ctx.userId,
            },
          })
        : await tx.reportCard.create({
            data: {
              schoolId: ctx.schoolId,
              academicPeriodId: input.academicPeriodId,
              classroomId: payload.classroom.id,
              studentId: input.studentId,
              identifier: `BUL-${payload.period.academicYear.name}-${payload.period.number}-${String(seq + 1).padStart(4, "0")}`,
              status: "CALCULATED",
              currentVersion: version,
              generatedById: ctx.userId,
            },
          });
      await tx.reportCardVersion.create({
        data: {
          reportCardId: card.id,
          version,
          payload: payload as object,
          reason: input.reason ?? null,
          createdById: ctx.userId,
        },
      });
      return card;
    });
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "reportcard.generate",
      entity: "ReportCard",
      entityId: card.id,
      metadata: { version: card.currentVersion },
    });
    return { ok: true, result: { id: card.id, version: card.currentVersion } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/** Génération collective pour une classe (boucle séquentielle, sans bloquer une requête unique énorme). */
export async function generateClassReportCards(
  ctx: SchoolCtx,
  input: { classroomId: string; academicPeriodId: string },
): Promise<ReportCardsResult<{ generated: number; failed: number }>> {
  const results = await prisma.studentPeriodResult.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId: input.classroomId,
      academicPeriodId: input.academicPeriodId,
      status: { not: "DRAFT" },
    },
    select: { studentId: true },
  });
  let generated = 0;
  let failed = 0;
  for (const r of results) {
    const res = await generateReportCard(ctx, {
      studentId: r.studentId,
      academicPeriodId: input.academicPeriodId,
    });
    if (res.ok) generated++;
    else failed++;
  }
  return { ok: true, result: { generated, failed } };
}

export async function listReportCards(
  ctx: SchoolCtx,
  filters: { classroomId?: string; academicPeriodId?: string; studentId?: string } = {},
) {
  return prisma.reportCard.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
      ...(filters.academicPeriodId ? { academicPeriodId: filters.academicPeriodId } : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
    },
    include: {
      student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
      classroom: { select: { name: true } },
      academicPeriod: { select: { name: true } },
    },
    orderBy: [{ academicPeriodId: "desc" }, { student: { lastName: "asc" } }],
  });
}

export async function getReportCard(ctx: SchoolCtx, id: string) {
  const card = await prisma.reportCard.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
      classroom: { select: { name: true } },
      academicPeriod: { select: { name: true, number: true } },
      versions: { orderBy: { version: "desc" } },
    },
  });
  return card;
}

/** Rectification : nouvelle version historisée — jamais de modification silencieuse. */
export async function rectifyReportCard(
  ctx: SchoolCtx,
  id: string,
  reason: string,
): Promise<ReportCardsResult<{ id: string; version: number }>> {
  const card = await prisma.reportCard.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { studentId: true, academicPeriodId: true },
  });
  if (!card) return { ok: false, error: "NOT_FOUND" };
  const res = await generateReportCard(ctx, {
    studentId: card.studentId,
    academicPeriodId: card.academicPeriodId,
    reason,
  });
  if (res.ok) {
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "reportcard.rectify",
      entity: "ReportCard",
      entityId: id,
      metadata: { reason },
    });
  }
  return res;
}

// ---------- Modèles de bulletins ----------

export const BUILTIN_TEMPLATES = [
  { key: "primary", name: "Primaire" },
  { key: "college", name: "Collège" },
  { key: "lycee", name: "Lycée" },
] as const;

export async function ensureDefaultTemplates(ctx: SchoolCtx) {
  await prisma.reportCardTemplate.createMany({
    data: [
      ...BUILTIN_TEMPLATES.map((t) => ({
        schoolId: ctx.schoolId,
        key: t.key,
        name: t.name,
      })),
      { schoolId: ctx.schoolId, key: "standard", name: "Standard", isDefault: true },
    ],
    skipDuplicates: true,
  });
  return prisma.reportCardTemplate.findMany({
    where: { schoolId: ctx.schoolId },
    include: { level: { select: { name: true } } },
  });
}

/** Choisit le modèle applicable : niveau > défaut > "standard". */
export async function templateFor(
  ctx: SchoolCtx,
  levelId?: string | null,
): Promise<string> {
  if (levelId) {
    const t = await prisma.reportCardTemplate.findFirst({
      where: { schoolId: ctx.schoolId, levelId },
      select: { key: true },
    });
    if (t) return t.key;
  }
  const def = await prisma.reportCardTemplate.findFirst({
    where: { schoolId: ctx.schoolId, isDefault: true },
    select: { key: true },
  });
  return def?.key ?? "standard";
}
