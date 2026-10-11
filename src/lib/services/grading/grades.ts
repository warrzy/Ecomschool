import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { teacherIdForUser } from "@/lib/services/attendance";
import { teacherAllowed } from "./assessments";
import type { GradeStatus } from "@prisma/client";

export type GradesError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LOCKED"
  | "OUT_OF_RANGE"
  | "UPDATE_FAILED";

export type GradesResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: GradesError };

type SchoolCtx = { userId: string; schoolId: string };

/** Résout le périmètre enseignant pour une évaluation (null = non enseignant). */
async function assertTeacherScope(
  ctx: SchoolCtx,
  assessment: { classroomId: string; subjectId: string },
  asTeacher?: boolean,
): Promise<GradesError | null> {
  if (!asTeacher) return null;
  const tid = await teacherIdForUser(ctx);
  if (!tid) return "FORBIDDEN";
  return (await teacherAllowed(ctx, tid, assessment.classroomId, assessment.subjectId))
    ? null
    : "FORBIDDEN";
}

export interface GradeRow {
  studentId: string;
  matricule: string;
  name: string;
  value: number | null;
  status: GradeStatus;
  observation: string | null;
}

/**
 * Charge la grille de saisie : élèves inscrits dans la classe à la date
 * de l'évaluation, fusionnés avec les notes déjà saisies.
 */
export async function getGradeGrid(
  ctx: SchoolCtx,
  assessmentId: string,
): Promise<GradesResult<{ assessment: { id: string; maxScore: number; status: string; title: string; classroomId: string }; rows: GradeRow[] }>> {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, schoolId: ctx.schoolId },
    select: { id: true, title: true, maxScore: true, status: true, classroomId: true, date: true },
  });
  if (!assessment) return { ok: false, error: "NOT_FOUND" };

  const dayEnd = new Date(assessment.date.getTime() + 86399999);
  const [enrollments, grades] = await Promise.all([
    prisma.enrollment.findMany({
      where: {
        schoolId: ctx.schoolId,
        classroomId: assessment.classroomId,
        status: "ENROLLED",
        enrolledAt: { lte: dayEnd },
        OR: [{ leftAt: null }, { leftAt: { gt: assessment.date } }],
      },
      select: {
        student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
      },
    }),
    prisma.grade.findMany({
      where: { assessmentId: assessment.id, schoolId: ctx.schoolId },
      select: { studentId: true, value: true, status: true, observation: true },
    }),
  ]);

  const byStudent = new Map(grades.map((g) => [g.studentId, g]));
  const rows = enrollments
    .map((e) => {
      const g = byStudent.get(e.student.id);
      return {
        studentId: e.student.id,
        matricule: e.student.matricule,
        name: `${e.student.lastName} ${e.student.firstName}`,
        value: g?.value ?? null,
        status: g?.status ?? ("MISSING" as GradeStatus),
        observation: g?.observation ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { ok: true, result: { assessment, rows } };
}

export interface GradeEntryInput {
  studentId: string;
  value?: number | null;
  status: GradeStatus;
  observation?: string | null;
}

/**
 * Enregistrement en masse des notes. Chaque modification d'une note
 * existante produit un GradeRevision (historisation).
 */
export async function saveGrades(
  ctx: SchoolCtx,
  assessmentId: string,
  entries: GradeEntryInput[],
  opts: { asTeacher?: boolean } = {},
): Promise<GradesResult<{ saved: number }>> {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, schoolId: ctx.schoolId },
    select: {
      id: true, maxScore: true, status: true, classroomId: true, subjectId: true,
      academicPeriod: { select: { isLocked: true } },
    },
  });
  if (!assessment) return { ok: false, error: "NOT_FOUND" };
  if (assessment.academicPeriod?.isLocked) return { ok: false, error: "LOCKED" };
  if (["VALIDATED", "PUBLISHED", "CANCELLED"].includes(assessment.status)) {
    return { ok: false, error: "LOCKED" };
  }
  const err = await assertTeacherScope(ctx, assessment, opts.asTeacher);
  if (err) return { ok: false, error: err };

  for (const e of entries) {
    if (e.status === "ENTERED" && (e.value == null || e.value < 0 || e.value > assessment.maxScore)) {
      return { ok: false, error: "OUT_OF_RANGE" };
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const e of entries) {
      const value = e.status === "ENTERED" ? e.value ?? null : null;
      const existing = await tx.grade.findUnique({
        where: { assessmentId_studentId: { assessmentId, studentId: e.studentId } },
      });
      if (existing) {
        if (existing.value !== value || existing.status !== e.status || existing.observation !== (e.observation ?? null)) {
          await tx.grade.update({
            where: { id: existing.id },
            data: { value, status: e.status, observation: e.observation ?? null, recordedById: ctx.userId },
          });
          await tx.gradeRevision.create({
            data: {
              gradeId: existing.id,
              oldValue: existing.value,
              newValue: value,
              oldStatus: existing.status,
              newStatus: e.status,
              changedById: ctx.userId,
            },
          });
        }
      } else {
        await tx.grade.create({
          data: {
            schoolId: ctx.schoolId,
            assessmentId,
            studentId: e.studentId,
            value,
            status: e.status,
            observation: e.observation ?? null,
            recordedById: ctx.userId,
          },
        });
      }
      n++;
    }
    return n;
  });

  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "grades.save",
    entity: "Assessment",
    entityId: assessmentId,
    metadata: { count: saved },
  });
  return { ok: true, result: { saved } };
}

/** Import CSV : lignes "matricule;note" ou "matricule;note;observation". */
export function parseGradesCsv(
  csv: string,
): { matricule: string; value: number | null; observation: string | null }[] {
  return csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^matricule/i.test(l))
    .map((l) => {
      // Séparateur : point-virgule ou tabulation ; la virgule n'est utilisée
      // que si la ligne n'a ni l'un ni l'autre (évite de casser "14,5").
      const sep = l.includes(";") ? ";" : l.includes("\t") ? "\t" : ",";
      const parts = l.split(sep).map((p) => p.trim());
      const v = parts[1] === "" || parts[1] == null ? null : Number(parts[1].replace(",", "."));
      return {
        matricule: parts[0],
        value: v != null && Number.isFinite(v) ? v : null,
        observation: parts[2] ?? null,
      };
    })
    .filter((r) => r.matricule);
}
