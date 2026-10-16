import { prisma } from "@/lib/db/prisma";

/**
 * Export du registre des bulletins — lecture seule, snapshots intacts.
 * Registre : une ligne par bulletin (version courante).
 * Versions : historique des versions des bulletins exportés.
 * Enseignant (sans reportcards.publish) : bulletins limités aux classes
 * de ses affectations, ÉVALUÉES PAR ANNÉE (TeachingAssignment porte
 * academicYearId ; ClassroomSubject hérite l'année de sa classe) —
 * le périmètre historique est donc fiable.
 */

type SchoolCtx = { userId: string; schoolId: string };

export type ExportError = "FORBIDDEN";
export type ExportResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ExportError };

const MAX_ROWS = 50_000;

export const REGISTRY_HEADERS = [
  "identifiant",
  "annee",
  "periode",
  "classe",
  "matricule",
  "nom",
  "prenom",
  "statut",
  "version_courante",
  "gabarit",
  "date_publication",
] as const;

export const VERSIONS_HEADERS = [
  "identifiant",
  "version",
  "motif",
  "cree_par",
  "date_creation",
] as const;

const STATUS: Record<string, string> = {
  DRAFT: "Brouillon",
  CALCULATED: "Calculé",
  PENDING_VALIDATION: "En validation",
  VALIDATED: "Validé",
  PUBLISHED: "Publié",
  RECTIFIED: "Rectifié",
};

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";
const isoTime = (d: Date | null | undefined) =>
  d ? d.toISOString().replace("T", " ").slice(0, 16) : "";

export interface ReportCardsExportFilters {
  academicYearId?: string;
  academicPeriodId?: string;
  classroomId?: string;
  studentId?: string;
  status?: string;
}

export async function buildReportCardsExport(
  ctx: SchoolCtx,
  filters: ReportCardsExportFilters,
  opts: { asTeacher?: boolean } = {},
): Promise<
  ExportResult<{
    registry: (string | number | null)[][];
    versions: (string | number | null)[][];
    truncated: boolean;
  }>
> {
  // Périmètre enseignant : paires « année|classe » autorisées.
  let allowed: Set<string> | null = null;
  if (opts.asTeacher) {
    const tids = (
      await prisma.teacher.findMany({
        where: { schoolId: ctx.schoolId, userId: ctx.userId },
        select: { id: true },
      })
    ).map((t) => t.id);
    if (tids.length === 0) return { ok: false, error: "FORBIDDEN" };
    const [assignments, classSubjects] = await Promise.all([
      prisma.teachingAssignment.findMany({
        where: { schoolId: ctx.schoolId, teacherId: { in: tids } },
        select: { academicYearId: true, classroomId: true },
      }),
      prisma.classroomSubject.findMany({
        where: { schoolId: ctx.schoolId, teacherId: { in: tids } },
        select: {
          classroomId: true,
          classroom: { select: { academicYearId: true } },
        },
      }),
    ]);
    allowed = new Set<string>();
    for (const a of assignments)
      allowed.add(`${a.academicYearId}|${a.classroomId}`);
    for (const c of classSubjects)
      allowed.add(`${c.classroom.academicYearId}|${c.classroomId}`);

    // Filtre classe explicite : refus déterministe si la classe (ou son
    // année) est hors des affectations — indépendamment des bulletins.
    if (filters.classroomId) {
      const cl = await prisma.classroom.findFirst({
        where: { id: filters.classroomId, schoolId: ctx.schoolId },
        select: { academicYearId: true },
      });
      if (!cl || !allowed.has(`${cl.academicYearId}|${filters.classroomId}`)) {
        return { ok: false, error: "FORBIDDEN" };
      }
    }
    // Filtre année explicite : refus si aucune affectation cette année-là.
    if (filters.academicYearId) {
      const hasYear = [...allowed].some((k) => k.startsWith(`${filters.academicYearId}|`));
      if (!hasYear) return { ok: false, error: "FORBIDDEN" };
    }
  }

  const cards = await prisma.reportCard.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
      ...(filters.academicPeriodId
        ? { academicPeriodId: filters.academicPeriodId }
        : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.academicYearId
        ? { academicPeriod: { academicYearId: filters.academicYearId } }
        : {}),
    },
    include: {
      student: {
        select: { matricule: true, firstName: true, lastName: true },
      },
      classroom: { select: { name: true } },
      academicPeriod: {
        select: {
          name: true,
          academicYearId: true,
          academicYear: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { academicPeriod: { academicYear: { startDate: "desc" } } },
      { academicPeriod: { number: "asc" } },
      { student: { lastName: "asc" } },
    ],
    take: MAX_ROWS + 1,
  });

  const inScope = allowed
    ? cards.filter((c) =>
        allowed!.has(`${c.academicPeriod.academicYearId}|${c.classroomId}`),
      )
    : cards;
  // Filtre explicite désignant du hors-périmètre → refus (cf. P5a/b).
  if (
    allowed &&
    cards.length > 0 &&
    inScope.length === 0 &&
    (filters.classroomId ||
      filters.academicPeriodId ||
      filters.studentId ||
      filters.academicYearId)
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const truncated = inScope.length > MAX_ROWS;
  const scoped = inScope.slice(0, MAX_ROWS);
  const cardIds = scoped.map((c) => c.id);

  const versions = cardIds.length
    ? await prisma.reportCardVersion.findMany({
        where: {
          reportCardId: { in: cardIds },
          reportCard: { schoolId: ctx.schoolId },
        },
        include: {
          reportCard: { select: { identifier: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ reportCardId: "asc" }, { version: "desc" }],
      })
    : [];

  return {
    ok: true,
    result: {
      truncated,
      registry: scoped.map((c) => [
        c.identifier,
        c.academicPeriod.academicYear.name,
        c.academicPeriod.name,
        c.classroom.name,
        c.student.matricule,
        c.student.lastName,
        c.student.firstName,
        STATUS[c.status] ?? c.status,
        c.currentVersion,
        c.templateKey,
        iso(c.publishedAt),
      ]),
      versions: versions.map((v) => [
        v.reportCard.identifier,
        v.version,
        v.reason ?? "",
        v.createdBy ? `${v.createdBy.lastName} ${v.createdBy.firstName}` : "",
        isoTime(v.createdAt),
      ]),
    },
  };
}
