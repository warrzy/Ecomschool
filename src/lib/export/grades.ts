import { prisma } from "@/lib/db/prisma";
import { teacherIdForUser } from "@/lib/services/attendance";
import { inScope, teacherAllowedPairs } from "@/lib/export/scope";
import type { GradeStatus } from "@prisma/client";

/**
 * Export détaillé des notes — lecture seule, aucun calcul.
 * Chaque ligne = un élève inscrit à la date de l'évaluation, fusionné avec
 * sa note éventuelle. Les statuts distincts sont préservés : une note
 * manquante n'est jamais transformée en zéro.
 */

export type ExportError = "FORBIDDEN";
export type ExportResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ExportError };

type SchoolCtx = { userId: string; schoolId: string };

export const GRADE_STATUS_LABELS: Record<GradeStatus, string> = {
  ENTERED: "Saisie",
  MISSING: "Manquante",
  ABSENT: "Absent",
  EXEMPT: "Dispensé",
  CANCELLED: "Annulée",
};

export interface GradesExportFilters {
  academicYearId?: string;
  academicPeriodId?: string;
  classroomId?: string;
  subjectId?: string;
  teacherId?: string;
  assessmentId?: string;
}

/** Plafonds mémoire — l'export reste un job synchrone HTTP. */
const MAX_ASSESSMENTS = 200;
const MAX_ROWS = 50_000;

export const GRADES_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "matiere",
  "periode",
  "evaluation",
  "type",
  "date",
  "statut",
  "note",
  "bareme",
  "coef_evaluation",
  "coef_matiere",
  "observation",
] as const;

/** Paires classe|matière : voir src/lib/export/scope.ts (mutualisé P5a/P5b). */

/**
 * Construit les lignes de l'export notes. `asTeacher` restreint
 * strictement le périmètre aux affectations de l'utilisateur — le
 * paramètre `teacherId` de l'URL ne peut pas l'élargir.
 */
export async function buildGradesExport(
  ctx: SchoolCtx,
  filters: GradesExportFilters,
  opts: { asTeacher?: boolean } = {},
): Promise<
  ExportResult<{
    rows: (string | number | null)[][];
    truncated: boolean;
    assessments: number;
  }>
> {
  let pairs: Set<string> | null = null;
  const teacherId = filters.teacherId;
  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (!tid) return { ok: false, error: "FORBIDDEN" };
    pairs = await teacherAllowedPairs(ctx, tid);
    if (teacherId && teacherId !== tid) return { ok: false, error: "FORBIDDEN" };
    // Le périmètre est assuré par `pairs` (classe×matière) — pas par
    // assessment.teacherId, qui masquerait les violations de filtres.
  }

  const assessments = await prisma.assessment.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId
        ? { academicYearId: filters.academicYearId }
        : {}),
      ...(filters.academicPeriodId
        ? { academicPeriodId: filters.academicPeriodId }
        : {}),
      ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(filters.assessmentId ? { id: filters.assessmentId } : {}),
    },
    select: {
      id: true,
      title: true,
      date: true,
      maxScore: true,
      coefficient: true,
      classroomId: true,
      subjectId: true,
      classroom: { select: { name: true, levelId: true } },
      subject: { select: { name: true } },
      academicPeriod: { select: { name: true } },
      type: { select: { name: true } },
      teacher: { select: { lastName: true, firstName: true } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: MAX_ASSESSMENTS + 1,
  });

  const scoped = assessments
    .filter((a) => inScope(pairs, a.classroomId, a.subjectId))
    .slice(0, MAX_ASSESSMENTS);
  if (opts.asTeacher && assessments.length > 0 && scoped.length === 0) {
    // Les filtres désignent des données réelles de l'établissement mais
    // entièrement hors périmètre : refus explicite plutôt qu'un fichier vide.
    return { ok: false, error: "FORBIDDEN" };
  }
  if (scoped.length === 0) {
    return { ok: true, result: { rows: [], truncated: false, assessments: 0 } };
  }

  // Notes saisies pour toutes les évaluations retenues (une requête).
  const grades = await prisma.grade.findMany({
    where: {
      schoolId: ctx.schoolId,
      assessmentId: { in: scoped.map((a) => a.id) },
    },
    select: {
      assessmentId: true,
      studentId: true,
      value: true,
      status: true,
      observation: true,
    },
  });
  const gradeBy = new Map(
    grades.map((g) => [`${g.assessmentId}|${g.studentId}`, g]),
  );

  // Coefficients matière : ClassroomSubject puis LevelSubject (même
  // résolution que le moteur de calcul).
  const pairs2 = [...new Set(scoped.map((a) => `${a.classroomId}|${a.subjectId}`))];
  const csRows = await prisma.classroomSubject.findMany({
    where: {
      schoolId: ctx.schoolId,
      OR: pairs2.map((p) => {
        const [classroomId, subjectId] = p.split("|");
        return { classroomId, subjectId };
      }),
    },
    select: { classroomId: true, subjectId: true, coefficient: true },
  });
  const coefBy = new Map(
    csRows.map((c) => [`${c.classroomId}|${c.subjectId}`, c.coefficient]),
  );
  const missing = pairs2.filter((p) => !coefBy.has(p));
  if (missing.length) {
    const levelIds = [
      ...new Set(scoped.map((a) => a.classroom.levelId)),
    ];
    const lsRows = await prisma.levelSubject.findMany({
      where: { schoolId: ctx.schoolId, levelId: { in: levelIds } },
      select: { levelId: true, subjectId: true, coefficient: true },
    });
    const lsBy = new Map(
      lsRows.map((l) => [`${l.levelId}|${l.subjectId}`, l.coefficient]),
    );
    for (const a of scoped) {
      const key = `${a.classroomId}|${a.subjectId}`;
      if (!coefBy.has(key)) {
        coefBy.set(
          key,
          lsBy.get(`${a.classroom.levelId}|${a.subjectId}`) ?? 1,
        );
      }
    }
  }

  const rows: (string | number | null)[][] = [];
  let truncated = false;

  outer: for (const a of scoped) {
    // Élèves inscrits à la date de l'évaluation (même règle que la grille).
    const dayEnd = new Date(a.date.getTime() + 86399999);
    const enrollments = await prisma.enrollment.findMany({
      where: {
        schoolId: ctx.schoolId,
        classroomId: a.classroomId,
        status: "ENROLLED",
        enrolledAt: { lte: dayEnd },
        OR: [{ leftAt: null }, { leftAt: { gt: a.date } }],
      },
      select: {
        student: {
          select: {
            id: true,
            matricule: true,
            lastName: true,
            firstName: true,
          },
        },
      },
      orderBy: { student: { lastName: "asc" } },
    });

    for (const e of enrollments) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break outer;
      }
      const g = gradeBy.get(`${a.id}|${e.student.id}`);
      const status: GradeStatus = g?.status ?? "MISSING";
      rows.push([
        e.student.matricule,
        e.student.lastName,
        e.student.firstName,
        a.classroom.name,
        a.subject.name,
        a.academicPeriod?.name ?? "",
        a.title,
        a.type.name,
        a.date.toISOString().slice(0, 10),
        GRADE_STATUS_LABELS[status],
        status === "ENTERED" && g?.value != null ? g.value : "",
        a.maxScore,
        a.coefficient,
        coefBy.get(`${a.classroomId}|${a.subjectId}`) ?? 1,
        g?.observation ?? "",
      ]);
    }
  }

  return {
    ok: true,
    result: { rows, truncated, assessments: scoped.length },
  };
}
