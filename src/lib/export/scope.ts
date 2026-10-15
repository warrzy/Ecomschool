import { prisma } from "@/lib/db/prisma";

/**
 * Périmètre enseignant mutualisé (P5a notes/moyennes, P5b référentiels).
 * Une paire « classe|matière » est couverte si l'enseignant y est affecté
 * via TeachingAssignment (subjectId null = joker toute la classe) ou
 * nommé responsable de la matière via ClassroomSubject.
 */

type SchoolCtx = { userId: string; schoolId: string };

export async function teacherAllowedPairs(
  ctx: SchoolCtx,
  teacherId: string,
): Promise<Set<string>> {
  const [assignments, classSubjects] = await Promise.all([
    prisma.teachingAssignment.findMany({
      where: { schoolId: ctx.schoolId, teacherId },
      select: { classroomId: true, subjectId: true },
    }),
    prisma.classroomSubject.findMany({
      where: { schoolId: ctx.schoolId, teacherId },
      select: { classroomId: true, subjectId: true },
    }),
  ]);
  const pairs = new Set<string>();
  for (const a of assignments)
    pairs.add(`${a.classroomId}|${a.subjectId ?? "*"}`);
  for (const c of classSubjects)
    pairs.add(`${c.classroomId}|${c.subjectId}`);
  return pairs;
}

export const inScope = (
  pairs: Set<string> | null,
  classroomId: string,
  subjectId: string,
) =>
  !pairs ||
  pairs.has(`${classroomId}|${subjectId}`) ||
  pairs.has(`${classroomId}|*`);
