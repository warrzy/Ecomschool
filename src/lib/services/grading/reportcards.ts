import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { ResultStatus } from "@prisma/client";

export type ReportCardsError =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_STATUS"
  | "FORBIDDEN"
  | "PERIOD_LOCKED"
  | "YEAR_CLOSED"
  | "RECTIFICATION_REQUIRED"
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
      include: { subject: { select: { name: true, code: true, subjectGroup: true } } },
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
    headTeacherNote: result.headTeacherNote,
    generalAppreciation: result.generalAppreciation,
    councilDecision: result.councilDecision,
    directionNote: result.directionNote,
    directionSignedAt: result.directionSignedAt,
    subjects: subjects.map((s) => ({
      name: s.subject.name,
      group: s.subject.subjectGroup,
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
 * Sur période verrouillée ou année close, et pour tout bulletin déjà
 * PUBLISHED, la génération ordinaire est refusée : seule la voie de
 * rectification (motif obligatoire, nouvelle version historisée) reste
 * ouverte — `rectifyReportCard` passe `opts.rectification`.
 */
export async function generateReportCard(
  ctx: SchoolCtx,
  input: { studentId: string; academicPeriodId: string; reason?: string },
  opts: { rectification?: boolean } = {},
): Promise<ReportCardsResult<{ id: string; version: number }>> {
  const payload = await buildReportCardPayload(ctx, input.studentId, input.academicPeriodId);
  if (!payload) return { ok: false, error: "NOT_FOUND" };
  if (["DRAFT"].includes(payload.status)) {
    return { ok: false, error: "INVALID_STATUS" };
  }

  if (!opts.rectification) {
    const [period, existing] = await Promise.all([
      prisma.academicPeriod.findFirst({
        where: { id: input.academicPeriodId, schoolId: ctx.schoolId },
        select: { isLocked: true, academicYear: { select: { status: true } } },
      }),
      prisma.reportCard.findUnique({
        where: {
          academicPeriodId_studentId: {
            academicPeriodId: input.academicPeriodId,
            studentId: input.studentId,
          },
        },
        select: { status: true },
      }),
    ]);
    if (!period) return { ok: false, error: "NOT_FOUND" };
    if (period.academicYear.status === "CLOSED") {
      return { ok: false, error: "YEAR_CLOSED" };
    }
    if (period.isLocked) return { ok: false, error: "PERIOD_LOCKED" };
    if (existing?.status === "PUBLISHED") {
      return { ok: false, error: "RECTIFICATION_REQUIRED" };
    }
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
  const period = await prisma.academicPeriod.findFirst({
    where: { id: input.academicPeriodId, schoolId: ctx.schoolId },
    select: { isLocked: true, academicYear: { select: { status: true } } },
  });
  if (!period) return { ok: false, error: "NOT_FOUND" };
  if (period.academicYear.status === "CLOSED") {
    return { ok: false, error: "YEAR_CLOSED" };
  }
  if (period.isLocked) return { ok: false, error: "PERIOD_LOCKED" };

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
  filters: {
    classroomId?: string;
    academicPeriodId?: string;
    studentId?: string;
    status?: ResultStatus;
  } = {},
) {
  return prisma.reportCard.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
      ...(filters.academicPeriodId ? { academicPeriodId: filters.academicPeriodId } : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
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
  if (!reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const card = await prisma.reportCard.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { studentId: true, academicPeriodId: true },
  });
  if (!card) return { ok: false, error: "NOT_FOUND" };
  const res = await generateReportCard(
    ctx,
    {
      studentId: card.studentId,
      academicPeriodId: card.academicPeriodId,
      reason,
    },
    { rectification: true },
  );
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

// ---------- Appréciations et décisions ----------

/** Appréciation par matière (avant ou après publication — la régénération crée une nouvelle version). */
export async function updateSubjectAppreciation(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    academicPeriodId: string;
    subjectId: string;
    appreciation: string;
  },
): Promise<ReportCardsResult> {
  const row = await prisma.subjectPeriodResult.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      academicPeriodId: input.academicPeriodId,
      subjectId: input.subjectId,
    },
    select: { id: true },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

  await prisma.subjectPeriodResult.update({
    where: { id: row.id },
    data: { appreciation: input.appreciation.trim() || null },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reportcard.subject_appreciation",
    entity: "SubjectPeriodResult",
    entityId: row.id,
    metadata: { studentId: input.studentId, subjectId: input.subjectId },
  });
  return { ok: true, result: undefined };
}

/**
 * Appréciations générales + décision du conseil + observation/signature direction.
 * `sign` enregistre la validation de la direction (horodatée, non révocable en douce).
 */
export async function updateResultAnnotations(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    academicPeriodId: string;
    headTeacherNote?: string;
    generalAppreciation?: string;
    councilDecision?: string;
    directionNote?: string;
    sign?: boolean;
  },
): Promise<ReportCardsResult> {
  const row = await prisma.studentPeriodResult.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      academicPeriodId: input.academicPeriodId,
    },
    select: { id: true, status: true },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };
  if (row.status === "DRAFT") return { ok: false, error: "INVALID_STATUS" };

  await prisma.studentPeriodResult.update({
    where: { id: row.id },
    data: {
      ...(input.headTeacherNote !== undefined
        ? { headTeacherNote: input.headTeacherNote.trim() || null }
        : {}),
      ...(input.generalAppreciation !== undefined
        ? { generalAppreciation: input.generalAppreciation.trim() || null }
        : {}),
      ...(input.councilDecision !== undefined
        ? { councilDecision: input.councilDecision.trim() || null }
        : {}),
      ...(input.directionNote !== undefined
        ? { directionNote: input.directionNote.trim() || null }
        : {}),
      ...(input.sign
        ? { directionSignedById: ctx.userId, directionSignedAt: new Date() }
        : {}),
    },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: input.sign ? "reportcard.direction_sign" : "reportcard.annotations",
    entity: "StudentPeriodResult",
    entityId: row.id,
    metadata: { studentId: input.studentId, academicPeriodId: input.academicPeriodId },
  });
  return { ok: true, result: undefined };
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
