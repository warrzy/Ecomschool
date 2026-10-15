import { prisma } from "@/lib/db/prisma";

/**
 * Export classes et niveaux — lecture seule.
 * Feuille 1 « Classes » : une ligne par classe avec effectif réel
 * (inscriptions ENROLLED) et informations du modèle uniquement.
 * Feuille 2 « Niveaux » : synthèse par niveau (XLSX).
 */

type SchoolCtx = { userId: string; schoolId: string };

export const CLASSES_HEADERS = [
  "annee",
  "niveau",
  "classe",
  "section",
  "salle",
  "capacite",
  "effectif",
  "prof_principal",
  "statut",
] as const;

export const LEVELS_HEADERS = [
  "niveau",
  "nb_classes",
  "effectif_total",
  "nb_matieres",
] as const;

const REC_STATUS: Record<string, string> = {
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};

export async function buildClassesExport(
  ctx: SchoolCtx,
  filters: { academicYearId?: string; levelId?: string; status?: string },
): Promise<{
  classes: (string | number | null)[][];
  levels: (string | number | null)[][];
}> {
  const classrooms = await prisma.classroom.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId
        ? { academicYearId: filters.academicYearId }
        : {}),
      ...(filters.levelId ? { levelId: filters.levelId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    orderBy: [
      { academicYear: { startDate: "desc" } },
      { level: { order: "asc" } },
      { name: "asc" },
    ],
    select: {
      name: true,
      section: true,
      room: true,
      capacity: true,
      status: true,
      academicYear: { select: { name: true } },
      level: { select: { name: true } },
      headTeacher: {
        select: { lastName: true, firstName: true },
      },
      _count: {
        select: { enrollments: { where: { status: "ENROLLED" } } },
      },
    },
  });

  const classes = classrooms.map((c) => [
    c.academicYear.name,
    c.level.name,
    c.name,
    c.section ?? "",
    c.room ?? "",
    c.capacity ?? "",
    c._count.enrollments,
    c.headTeacher
      ? `${c.headTeacher.lastName} ${c.headTeacher.firstName}`
      : "",
    REC_STATUS[c.status] ?? c.status,
  ]);

  // Synthèse par niveau (année filtrée uniquement — regroupée en mémoire).
  const levelRows = await prisma.level.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.levelId ? { id: filters.levelId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.academicYearId
        ? {
            classrooms: {
              some: {
                schoolId: ctx.schoolId,
                academicYearId: filters.academicYearId,
              },
            },
          }
        : {}),
    },
    orderBy: { order: "asc" },
    select: {
      name: true,
      status: true,
      classrooms: {
        where: {
          schoolId: ctx.schoolId,
          ...(filters.academicYearId
            ? { academicYearId: filters.academicYearId }
            : {}),
        },
        select: {
          _count: {
            select: { enrollments: { where: { status: "ENROLLED" } } },
          },
        },
      },
      _count: { select: { subjects: true } },
    },
  });

  const levels = levelRows.map((l) => [
    `${l.name}${l.status !== "ACTIVE" ? ` (${REC_STATUS[l.status] ?? l.status})` : ""}`,
    l.classrooms.length,
    l.classrooms.reduce((s, c) => s + c._count.enrollments, 0),
    l._count.subjects,
  ]);

  return { classes, levels };
}
