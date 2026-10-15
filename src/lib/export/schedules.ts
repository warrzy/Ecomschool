import { prisma } from "@/lib/db/prisma";
import {
  getWeekTimetable,
  minutesToLabel,
} from "@/lib/services/schedules";

/**
 * Export emplois du temps — lecture seule.
 * - Sans paramètre `week` : les créneaux récurrents (CourseSchedule),
 *   avec leurs dates de validité.
 * - Avec `week=YYYY-MM-DD` : la semaine réelle via getWeekTimetable
 *   (séances déplacées/annulées appliquées, même moteur que l'écran).
 * Enseignant : limité à ses propres créneaux — toutes ses fiches Teacher
 * (des doublons de fiche peuvent exister pour un même compte) ; un filtre
 * enseignant ou classe hors périmètre → FORBIDDEN explicite.
 */

type SchoolCtx = { userId: string; schoolId: string };

export type ExportError = "FORBIDDEN";
export type ExportResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ExportError };

export const SCHEDULE_HEADERS = [
  "jour",
  "debut",
  "fin",
  "classe",
  "matiere",
  "enseignant",
  "salle",
  "annee",
  "validite_debut",
  "validite_fin",
] as const;

export const WEEK_HEADERS = [
  "date",
  "jour",
  "debut",
  "fin",
  "classe",
  "matiere",
  "enseignant",
  "salle",
  "statut",
] as const;

const WEEKDAY_FR: Record<string, string> = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

const SESSION_STATUS: Record<string, string> = {
  PLANNED: "Prévue",
  DONE: "Réalisée",
  CANCELLED: "Annulée",
  POSTPONED: "Reportée",
};

const MAX_ROWS = 50_000;

export interface ScheduleExportFilters {
  academicYearId?: string;
  classroomId?: string;
  teacherId?: string;
  levelId?: string;
  /** Semaine (lundi) — présence => export des séances réelles. */
  weekStart?: Date;
}

export async function buildSchedulesExport(
  ctx: SchoolCtx,
  filters: ScheduleExportFilters,
  opts: { asTeacher?: boolean } = {},
): Promise<
  ExportResult<{
    rows: (string | number | null)[][];
    truncated: boolean;
    week: boolean;
  }>
> {
  let teacherId = filters.teacherId;
  let tids: string[] | null = null;
  if (opts.asTeacher) {
    tids = (
      await prisma.teacher.findMany({
        where: { schoolId: ctx.schoolId, userId: ctx.userId },
        select: { id: true },
      })
    ).map((t) => t.id);
    if (tids.length === 0) return { ok: false, error: "FORBIDDEN" };
    if (teacherId && !tids.includes(teacherId))
      return { ok: false, error: "FORBIDDEN" };
    teacherId = undefined; // périmètre appliqué en mémoire (voir ci-dessous)
  }

  // --- Vue hebdomadaire réelle (même moteur que l'écran) ---
  if (filters.weekStart) {
    const slots = await getWeekTimetable(ctx, {
      weekStart: filters.weekStart,
      academicYearId: filters.academicYearId,
      classroomId: filters.classroomId,
      levelId: filters.levelId,
      teacherId,
    });
    const scoped = tids
      ? slots.filter((s) => tids!.includes(s.teacherId))
      : slots;
    // Refus explicite uniquement si un filtre désigne du hors-périmètre
    // (un export sans filtre sans créneau à soi reste un export vide).
    if (
      tids &&
      slots.length > 0 &&
      scoped.length === 0 &&
      (filters.classroomId || filters.levelId)
    ) {
      return { ok: false, error: "FORBIDDEN" };
    }
    const truncated = scoped.length > MAX_ROWS;
    return {
      ok: true,
      result: {
        week: true,
        truncated,
        rows: scoped.slice(0, MAX_ROWS).map((s) => [
          s.date,
          WEEKDAY_FR[s.weekday] ?? s.weekday,
          minutesToLabel(s.startMin),
          minutesToLabel(s.endMin),
          s.classroomName,
          s.subjectName ?? "",
          s.teacherName,
          s.roomName ?? "",
          s.status ? (SESSION_STATUS[s.status] ?? s.status) : "",
        ]),
      },
    };
  }

  // --- Créneaux récurrents ---
  const schedules = await prisma.courseSchedule.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: "ACTIVE",
      ...(filters.academicYearId
        ? { academicYearId: filters.academicYearId }
        : {}),
      ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(filters.levelId
        ? { classroom: { levelId: filters.levelId } }
        : {}),
    },
    orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
    take: MAX_ROWS + 1,
    select: {
      weekday: true,
      startMin: true,
      endMin: true,
      validFrom: true,
      validUntil: true,
      teacherId: true,
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
      teacher: { select: { lastName: true, firstName: true } },
      room: { select: { name: true } },
      academicYear: { select: { name: true } },
    },
  });

  // Enseignant : uniquement SES créneaux — les filtres désignant des
  // créneaux réels mais tous hors périmètre → refus explicite (cf. P5a).
  const inScopeRows = tids
    ? schedules.filter((s) => tids!.includes(s.teacherId))
    : schedules;
  if (
    tids &&
    schedules.length > 0 &&
    inScopeRows.length === 0 &&
    (filters.classroomId || filters.levelId)
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const truncated = inScopeRows.length > MAX_ROWS;
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return {
    ok: true,
    result: {
      week: false,
      truncated,
      rows: inScopeRows.slice(0, MAX_ROWS).map((s) => [
        WEEKDAY_FR[s.weekday] ?? s.weekday,
        minutesToLabel(s.startMin),
        minutesToLabel(s.endMin),
        s.classroom.name,
        s.subject?.name ?? "",
        `${s.teacher.lastName} ${s.teacher.firstName}`,
        s.room?.name ?? "",
        s.academicYear.name,
        iso(s.validFrom),
        iso(s.validUntil),
      ]),
    },
  };
}
