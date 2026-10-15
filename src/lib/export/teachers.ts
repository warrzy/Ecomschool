import { prisma } from "@/lib/db/prisma";

/**
 * Exports enseignants et personnel — lecture seule.
 * Standard (teacher.read) : identité + affectations pédagogiques.
 * Complet (teacher.manage) : ajoute email et téléphone.
 * Personnel (user.read) : comptes et rôles — jamais de données
 * sensibles (hashes, compteurs de connexion exclus par le select).
 */

type SchoolCtx = { userId: string; schoolId: string };

export const TEACHERS_STD_HEADERS = [
  "nom",
  "prenom",
  "statut",
] as const;

export const TEACHERS_FULL_HEADERS = [
  ...TEACHERS_STD_HEADERS,
  "email",
  "telephone",
] as const;

export const ASSIGNMENTS_HEADERS = [
  "enseignant",
  "classe",
  "matiere",
  "annee",
] as const;

export const STAFF_HEADERS = [
  "nom",
  "prenom",
  "email",
  "role",
  "statut_compte",
  "statut_membre",
] as const;

const REC_STATUS: Record<string, string> = {
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};
const USER_STATUS: Record<string, string> = {
  ACTIVE: "Actif",
  DISABLED: "Désactivé",
};
const MEMBER_STATUS: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

/** Enseignants + feuille d'affectations (filtrable par année). */
export async function buildTeachersExport(
  ctx: SchoolCtx,
  filters: { academicYearId?: string; status?: string },
  opts: { full?: boolean } = {},
): Promise<{
  teachers: (string | number | null)[][];
  assignments: (string | number | null)[][];
}> {
  const teachers = await prisma.teacher.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      lastName: true,
      firstName: true,
      email: true,
      phone: true,
      status: true,
    },
  });

  const teacherRows = teachers.map((t) => {
    const base: (string | number | null)[] = [
      t.lastName,
      t.firstName,
      REC_STATUS[t.status] ?? t.status,
    ];
    if (opts.full) base.push(t.email ?? "", t.phone ?? "");
    return base;
  });

  const assignments = await prisma.teachingAssignment.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId
        ? { academicYearId: filters.academicYearId }
        : {}),
    },
    orderBy: [
      { academicYear: { startDate: "desc" } },
      { teacher: { lastName: "asc" } },
      { classroom: { name: "asc" } },
    ],
    select: {
      teacher: { select: { lastName: true, firstName: true } },
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
      academicYear: { select: { name: true } },
    },
  });

  const assignmentRows = assignments.map((a) => [
    `${a.teacher.lastName} ${a.teacher.firstName}`,
    a.classroom.name,
    a.subject?.name ?? "(toutes matières)",
    a.academicYear.name,
  ]);

  return { teachers: teacherRows, assignments: assignmentRows };
}

/** Personnel = comptes utilisateurs rattachés à l'établissement. */
export async function buildStaffExport(
  ctx: SchoolCtx,
): Promise<{ rows: (string | number | null)[][] }> {
  const memberships = await prisma.schoolMembership.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: [
      { user: { lastName: "asc" } },
      { user: { email: "asc" } },
    ],
    select: {
      status: true,
      role: { select: { name: true } },
      user: {
        select: {
          lastName: true,
          firstName: true,
          email: true,
          status: true,
        },
      },
    },
  });

  return {
    rows: memberships.map((m) => [
      m.user.lastName ?? "",
      m.user.firstName ?? "",
      m.user.email,
      m.role.name,
      USER_STATUS[m.user.status] ?? m.user.status,
      MEMBER_STATUS[m.status] ?? m.status,
    ]),
  };
}
