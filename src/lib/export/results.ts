import { prisma } from "@/lib/db/prisma";
import { teacherIdForUser } from "@/lib/services/attendance";

/**
 * Export des moyennes et résultats — lit EXCLUSIVEMENT les résultats
 * enregistrés (SubjectPeriodResult, StudentPeriodResult,
 * StudentAnnualResult). Aucun recalcul : les lignes sans résultat
 * enregistré sont marquées « Non calculé » plutôt qu'inventées.
 */

export type ExportError = "FORBIDDEN";
export type ExportResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ExportError };

type SchoolCtx = { userId: string; schoolId: string };

export const RESULTS_SUMMARY_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "periode",
  "moyenne_generale",
  "rang",
  "mention",
  "statut_resultat",
] as const;

export const RESULTS_SUBJECT_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "periode",
  "matiere",
  "moyenne_matiere",
  "coef_matiere",
  "rang_matiere",
  "appreciation",
] as const;

export const ANNUAL_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "annee",
  "moyenne_annuelle",
  "rang",
  "mention",
  "decision",
  "statut_resultat",
] as const;

/** Classes dans lesquelles l'enseignant a au moins une affectation. */
async function teacherClassrooms(
  ctx: SchoolCtx,
  teacherId: string,
): Promise<Set<string>> {
  const [a, c] = await Promise.all([
    prisma.teachingAssignment.findMany({
      where: { schoolId: ctx.schoolId, teacherId },
      select: { classroomId: true },
    }),
    prisma.classroomSubject.findMany({
      where: { schoolId: ctx.schoolId, teacherId },
      select: { classroomId: true },
    }),
  ]);
  return new Set([...a, ...c].map((r) => r.classroomId));
}

async function teacherSubjects(
  ctx: SchoolCtx,
  teacherId: string,
): Promise<Set<string>> {
  const [a, c] = await Promise.all([
    prisma.teachingAssignment.findMany({
      where: { schoolId: ctx.schoolId, teacherId, subjectId: { not: null } },
      select: { classroomId: true, subjectId: true },
    }),
    prisma.classroomSubject.findMany({
      where: { schoolId: ctx.schoolId, teacherId },
      select: { classroomId: true, subjectId: true },
    }),
  ]);
  const wild = await prisma.teachingAssignment.findMany({
    where: { schoolId: ctx.schoolId, teacherId, subjectId: null },
    select: { classroomId: true },
  });
  const pairs = new Set([...a, ...c].map((r) => `${r.classroomId}|${r.subjectId}`));
  for (const w of wild) pairs.add(`${w.classroomId}|*`);
  return pairs;
}

export interface PeriodResultsExport {
  /** Une ligne par élève (synthèse). */
  summary: (string | number | null)[][];
  /** Une ligne par élève × matière. */
  subjects: (string | number | null)[][];
}

/**
 * Résultats d'une classe sur une période. Les élèves inscrits sans
 * résultat enregistré apparaissent explicitement « Non calculé ».
 */
export async function buildPeriodResultsExport(
  ctx: SchoolCtx,
  input: { academicPeriodId: string; classroomId: string },
  opts: { asTeacher?: boolean } = {},
): Promise<ExportResult<PeriodResultsExport>> {
  let allowedSubjects: Set<string> | null = null;
  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (!tid) return { ok: false, error: "FORBIDDEN" };
    const classrooms = await teacherClassrooms(ctx, tid);
    if (!classrooms.has(input.classroomId)) {
      return { ok: false, error: "FORBIDDEN" };
    }
    allowedSubjects = await teacherSubjects(ctx, tid);
  }

  const [period, classroom, enrolled, studentResults, subjectResults] =
    await Promise.all([
      prisma.academicPeriod.findFirst({
        where: { id: input.academicPeriodId, schoolId: ctx.schoolId },
        select: { name: true, academicYearId: true },
      }),
      prisma.classroom.findFirst({
        where: { id: input.classroomId, schoolId: ctx.schoolId },
        select: { name: true },
      }),
      prisma.enrollment.findMany({
        where: {
          schoolId: ctx.schoolId,
          classroomId: input.classroomId,
          status: "ENROLLED",
        },
        select: {
          student: {
            select: { id: true, matricule: true, lastName: true, firstName: true },
          },
        },
        orderBy: { student: { lastName: "asc" } },
      }),
      prisma.studentPeriodResult.findMany({
        where: {
          schoolId: ctx.schoolId,
          classroomId: input.classroomId,
          academicPeriodId: input.academicPeriodId,
        },
      }),
      prisma.subjectPeriodResult.findMany({
        where: {
          schoolId: ctx.schoolId,
          classroomId: input.classroomId,
          academicPeriodId: input.academicPeriodId,
        },
        include: { subject: { select: { name: true } } },
      }),
    ]);
  if (!period || !classroom) return { ok: false, error: "FORBIDDEN" };

  const resBy = new Map(studentResults.map((r) => [r.studentId, r]));
  const subjBy = new Map<string, typeof subjectResults>();
  for (const s of subjectResults) {
    const k = s.studentId;
    const list = subjBy.get(k) ?? [];
    list.push(s);
    subjBy.set(k, list);
  }

  const summary: (string | number | null)[][] = [];
  const subjects: (string | number | null)[][] = [];

  for (const e of enrolled) {
    const r = resBy.get(e.student.id);
    summary.push([
      e.student.matricule,
      e.student.lastName,
      e.student.firstName,
      classroom.name,
      period.name,
      r?.generalAverage ?? "",
      r?.rank ?? "",
      r?.mention ?? "",
      r ? r.status : "Non calculé",
    ]);
    const subs = (subjBy.get(e.student.id) ?? []).filter(
      (s) =>
        !allowedSubjects ||
        allowedSubjects.has(`${input.classroomId}|${s.subjectId}`) ||
        allowedSubjects.has(`${input.classroomId}|*`),
    );
    for (const s of subs) {
      subjects.push([
        e.student.matricule,
        e.student.lastName,
        e.student.firstName,
        classroom.name,
        period.name,
        s.subject.name,
        s.average ?? "",
        s.coefficient ?? "",
        s.rank ?? "",
        s.appreciation ?? "",
      ]);
    }
    if (subs.length === 0) {
      subjects.push([
        e.student.matricule,
        e.student.lastName,
        e.student.firstName,
        classroom.name,
        period.name,
        "(aucune matière calculée)",
        "",
        "",
        "",
        "",
      ]);
    }
  }
  return { ok: true, result: { summary, subjects } };
}

/** Résultats annuels — lecture StudentAnnualResult uniquement. */
export async function buildAnnualResultsExport(
  ctx: SchoolCtx,
  input: { academicYearId: string; classroomId?: string },
  opts: { asTeacher?: boolean } = {},
): Promise<ExportResult<(string | number | null)[][]>> {
  const classroomFilter = input.classroomId;
  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (!tid) return { ok: false, error: "FORBIDDEN" };
    const classrooms = await teacherClassrooms(ctx, tid);
    if (classroomFilter && !classrooms.has(classroomFilter)) {
      return { ok: false, error: "FORBIDDEN" };
    }
    if (!classroomFilter) {
      // Restreint aux classes affectées de l'enseignant.
      if (classrooms.size === 0) return { ok: false, error: "FORBIDDEN" };
    }
  }

  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { name: true },
  });
  if (!year) return { ok: false, error: "FORBIDDEN" };

  let allowedClassroomIds: string[] | undefined;
  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    const set = await teacherClassrooms(ctx, tid!);
    allowedClassroomIds = classroomFilter
      ? [classroomFilter]
      : [...set];
  }

  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      status: "ENROLLED",
      ...(classroomFilter ? { classroomId: classroomFilter } : {}),
      ...(allowedClassroomIds && !classroomFilter
        ? { classroomId: { in: allowedClassroomIds } }
        : {}),
    },
    select: {
      student: {
        select: { id: true, matricule: true, lastName: true, firstName: true },
      },
      classroom: { select: { name: true } },
    },
    orderBy: { student: { lastName: "asc" } },
  });

  const results = await prisma.studentAnnualResult.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: input.academicYearId },
  });
  const resBy = new Map(results.map((r) => [r.studentId, r]));

  const rows = enrollments.map((e) => {
    const r = resBy.get(e.student.id);
    return [
      e.student.matricule,
      e.student.lastName,
      e.student.firstName,
      e.classroom.name,
      year.name,
      r?.annualAverage ?? "",
      r?.rank ?? "",
      r?.mention ?? "",
      r?.decision ?? "",
      r ? r.status : "Non calculé",
    ];
  });
  return { ok: true, result: rows };
}
