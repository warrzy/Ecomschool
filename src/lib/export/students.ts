import { prisma } from "@/lib/db/prisma";

/**
 * Exports élèves et inscriptions — lecture seule.
 * Deux niveaux : pédagogique standard (student.read) et administratif
 * complet (student.manage — coordonnées, naissance, adresse).
 */

type SchoolCtx = { userId: string; schoolId: string };

export const STUDENTS_STD_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "sexe",
  "classe",
  "annee",
  "statut",
] as const;

export const STUDENTS_FULL_HEADERS = [
  ...STUDENTS_STD_HEADERS,
  "date_naissance",
  "lieu_naissance",
  "telephone",
  "email",
  "adresse",
] as const;

export const ENROLLMENTS_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "annee",
  "statut_inscription",
  "date_inscription",
  "date_sortie",
] as const;

const MAX_ROWS = 50_000;

const SEX: Record<string, string> = { MALE: "M", FEMALE: "F" };
const ENR_STATUS: Record<string, string> = {
  ENROLLED: "Inscrit",
  TRANSFERRED: "Transféré",
  WITHDRAWN: "Retiré",
  COMPLETED: "Terminé",
};
const REC_STATUS: Record<string, string> = {
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

export interface ReferentielFilters {
  academicYearId?: string;
  classroomId?: string;
  status?: string;
  /** Recherche matricule/nom/prénom — appliquée aux élèves uniquement. */
  q?: string;
}

/**
 * Élèves. Les filtres année/classe passent par les inscriptions :
 * un élève apparaît s'il possède au moins une inscription dans
 * l'année/classe demandée (historique conservé par année).
 */
export async function buildStudentsExport(
  ctx: SchoolCtx,
  filters: ReferentielFilters,
  opts: { full?: boolean } = {},
): Promise<{ rows: (string | number | null)[][]; truncated: boolean }> {
  const enrollWhere = filters.academicYearId || filters.classroomId
    ? {
        some: {
          schoolId: ctx.schoolId,
          ...(filters.academicYearId
            ? { academicYearId: filters.academicYearId }
            : {}),
          ...(filters.classroomId
            ? { classroomId: filters.classroomId }
            : {}),
        },
      }
    : undefined;

  const q = filters.q?.trim();
  const students = await prisma.student.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(q
        ? {
            OR: [
              { matricule: { contains: q, mode: "insensitive" as const } },
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(enrollWhere ? { enrollments: enrollWhere } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: MAX_ROWS + 1,
    select: {
      matricule: true,
      lastName: true,
      firstName: true,
      sex: true,
      birthDate: true,
      birthPlace: true,
      phone: true,
      email: true,
      address: true,
      status: true,
      // Classe affichée = inscription la plus récente dans le périmètre filtré.
      enrollments: {
        where: {
          schoolId: ctx.schoolId,
          ...(filters.academicYearId
            ? { academicYearId: filters.academicYearId }
            : {}),
          ...(filters.classroomId
            ? { classroomId: filters.classroomId }
            : {}),
        },
        orderBy: { academicYear: { startDate: "desc" } },
        take: 1,
        select: {
          classroom: { select: { name: true } },
          academicYear: { select: { name: true } },
        },
      },
    },
  });

  const truncated = students.length > MAX_ROWS;
  const rows = students.slice(0, MAX_ROWS).map((s) => {
    const base: (string | number | null)[] = [
      s.matricule,
      s.lastName,
      s.firstName,
      SEX[s.sex ?? ""] ?? "",
      s.enrollments[0]?.classroom.name ?? "",
      s.enrollments[0]?.academicYear.name ?? "",
      REC_STATUS[s.status] ?? s.status,
    ];
    if (opts.full) {
      base.push(
        iso(s.birthDate),
        s.birthPlace ?? "",
        s.phone ?? "",
        s.email ?? "",
        s.address ?? "",
      );
    }
    return base;
  });
  return { rows, truncated };
}

/** Inscriptions — historique complet par année scolaire. */
export async function buildEnrollmentsExport(
  ctx: SchoolCtx,
  filters: ReferentielFilters,
): Promise<{ rows: (string | number | null)[][]; truncated: boolean }> {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId
        ? { academicYearId: filters.academicYearId }
        : {}),
      ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    orderBy: [
      { academicYear: { startDate: "desc" } },
      { student: { lastName: "asc" } },
    ],
    take: MAX_ROWS + 1,
    select: {
      status: true,
      enrolledAt: true,
      leftAt: true,
      student: {
        select: { matricule: true, lastName: true, firstName: true },
      },
      classroom: { select: { name: true } },
      academicYear: { select: { name: true } },
    },
  });

  const truncated = enrollments.length > MAX_ROWS;
  const rows = enrollments.slice(0, MAX_ROWS).map((e) => [
    e.student.matricule,
    e.student.lastName,
    e.student.firstName,
    e.classroom.name,
    e.academicYear.name,
    ENR_STATUS[e.status] ?? e.status,
    iso(e.enrolledAt),
    iso(e.leftAt),
  ]);
  return { rows, truncated };
}
