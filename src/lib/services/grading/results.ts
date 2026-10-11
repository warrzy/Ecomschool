import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import {
  subjectAverage,
  generalAverage,
  computeRanks,
  mentionFor,
  annualAverage,
  roundScore,
  type GradingRules,
} from "./calculation";
import { resolveRules, annualWeightsFor } from "./policy";
import { notifyResultsPublished } from "@/lib/services/notifications";
import type { ResultStatus } from "@prisma/client";

export type ResultsError =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_STATUS"
  | "UPDATE_FAILED";

export type ResultsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ResultsError };

type SchoolCtx = { userId: string; schoolId: string };

/**
 * Coefficient d'une matière pour une classe — priorité explicite :
 * ClassroomSubject > LevelSubject (niveau de la classe) > 1.
 */
async function subjectCoefficient(
  schoolId: string,
  classroomId: string,
  levelId: string,
  subjectId: string,
): Promise<number> {
  const cs = await prisma.classroomSubject.findUnique({
    where: { classroomId_subjectId: { classroomId, subjectId } },
    select: { coefficient: true },
  });
  if (cs) return cs.coefficient;
  const ls = await prisma.levelSubject.findUnique({
    where: { levelId_subjectId: { levelId, subjectId } },
    select: { coefficient: true },
  });
  return ls?.coefficient ?? 1;
}

export interface ClassCalculation {
  rules: GradingRules;
  students: {
    studentId: string;
    matricule: string;
    name: string;
    generalAverage: number | null;
    rank: number | null;
    mention: string | null;
    complete: boolean;
    subjects: {
      subjectId: string;
      name: string;
      coefficient: number;
      average: number | null;
      rank: number | null;
      complete: boolean;
    }[];
  }[];
  stats: {
    classAverage: number | null;
    bestAverage: number | null;
    worstAverage: number | null;
    passed: number;
    successRate: number | null;
    enrolled: number;
    ranked: number;
  };
  missing: { studentId: string; subjectId: string; count: number }[];
}

/**
 * Calcule les résultats d'une classe pour une période (sans persistance —
 * utiliser computeAndStore pour enregistrer).
 */
export async function calculateClassPeriod(
  ctx: SchoolCtx,
  input: { classroomId: string; academicPeriodId: string },
): Promise<ResultsResult<ClassCalculation>> {
  const classroom = await prisma.classroom.findFirst({
    where: { id: input.classroomId, schoolId: ctx.schoolId },
    select: { id: true, academicYearId: true, levelId: true },
  });
  const period = await prisma.academicPeriod.findFirst({
    where: { id: input.academicPeriodId, schoolId: ctx.schoolId },
    select: { id: true, academicYearId: true, startDate: true, endDate: true },
  });
  if (!classroom || !period || period.academicYearId !== classroom.academicYearId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  const rules = await resolveRules(ctx, classroom.academicYearId, classroom.levelId);

  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId: classroom.id,
      status: "ENROLLED",
      enrolledAt: { lte: period.endDate },
      OR: [{ leftAt: null }, { leftAt: { gte: period.startDate } }],
    },
    select: {
      student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
    },
  });

  // Matières de la période = matières avec évaluations dans la période
  // ∪ matières du référentiel classe/niveau.
  const assessments = await prisma.assessment.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId: classroom.id,
      status: { not: "CANCELLED" },
      OR: [{ academicPeriodId: period.id }, { date: { gte: period.startDate, lte: period.endDate } }],
    },
    select: { id: true, subjectId: true, maxScore: true, coefficient: true },
  });
  const subjectIds = new Set(assessments.map((a) => a.subjectId));
  const refSubjects = await prisma.classroomSubject.findMany({
    where: { schoolId: ctx.schoolId, classroomId: classroom.id },
    select: { subjectId: true },
  });
  const levelSubjects = await prisma.levelSubject.findMany({
    where: { schoolId: ctx.schoolId, levelId: classroom.levelId },
    select: { subjectId: true },
  });
  refSubjects.forEach((s) => subjectIds.add(s.subjectId));
  levelSubjects.forEach((s) => subjectIds.add(s.subjectId));

  const subjects = await prisma.subject.findMany({
    where: { schoolId: ctx.schoolId, id: { in: [...subjectIds] }, status: "ACTIVE" },
    select: { id: true, name: true },
  });

  const grades = await prisma.grade.findMany({
    where: { schoolId: ctx.schoolId, assessmentId: { in: assessments.map((a) => a.id) } },
    select: { assessmentId: true, studentId: true, value: true, status: true },
  });
  const gradeBy = new Map(grades.map((g) => [`${g.assessmentId}:${g.studentId}`, g]));

  const coefCache = new Map<string, number>();
  for (const s of subjects) {
    coefCache.set(
      s.id,
      await subjectCoefficient(ctx.schoolId, classroom.id, classroom.levelId, s.id),
    );
  }

  const missing: ClassCalculation["missing"] = [];
  const bySubject = new Map<string, typeof assessments>();
  for (const a of assessments) {
    const list = bySubject.get(a.subjectId) ?? [];
    list.push(a);
    bySubject.set(a.subjectId, list);
  }

  const students = await Promise.all(
    enrollments.map(async (e) => {
      const subjResults = [];
      for (const s of subjects) {
        const subjAssessments = bySubject.get(s.id) ?? [];
        const entries = subjAssessments.map((a) => {
          const g = gradeBy.get(`${a.id}:${e.student.id}`);
          return { value: g?.value ?? null, status: g?.status ?? ("MISSING" as const) };
        });
        const { average, complete } = subjectAverage(entries, subjAssessments, rules);
        const missingCount = subjAssessments.filter(
          (a, i) => entries[i].status === "MISSING" && a.coefficient > 0,
        ).length;
        if (missingCount > 0) {
          missing.push({ studentId: e.student.id, subjectId: s.id, count: missingCount });
        }
        subjResults.push({
          subjectId: s.id,
          name: s.name,
          coefficient: coefCache.get(s.id) ?? 1,
          average: average == null ? null : roundScore(average, rules.precision, rules.rounding),
          rank: null as number | null,
          complete,
        });
      }
      const ga = generalAverage(
        subjResults.map((s) => ({ subjectId: s.subjectId, coefficient: s.coefficient, average: s.average })),
      );
      const avg = ga.average == null ? null : roundScore(ga.average, rules.precision, rules.rounding);
      return {
        studentId: e.student.id,
        matricule: e.student.matricule,
        name: `${e.student.lastName} ${e.student.firstName}`,
        generalAverage: avg,
        rank: null as number | null,
        mention: mentionFor(avg, rules),
        complete: ga.complete && subjResults.every((s) => s.complete),
        subjects: subjResults,
      };
    }),
  );

  // Rangs généraux + rangs par matière (si activé)
  const generalRanks = computeRanks(
    students.map((s) => ({ id: s.studentId, average: s.generalAverage })),
    rules.tieRule,
  );
  students.forEach((s) => (s.rank = generalRanks.get(s.studentId) ?? null));
  if (rules.perSubjectRank) {
    for (const s of subjects) {
      const ranks = computeRanks(
        students.map((st) => ({
          id: st.studentId,
          average: st.subjects.find((x) => x.subjectId === s.id)?.average ?? null,
        })),
        rules.tieRule,
      );
      students.forEach((st) => {
        const sub = st.subjects.find((x) => x.subjectId === s.id);
        if (sub) sub.rank = ranks.get(st.studentId) ?? null;
      });
    }
  }

  const averages = students.map((s) => s.generalAverage).filter((a): a is number => a != null);
  const passed = averages.filter((a) => a >= rules.passMark).length;
  const stats = {
    classAverage: averages.length
      ? roundScore(averages.reduce((a, b) => a + b, 0) / averages.length, rules.precision, rules.rounding)
      : null,
    bestAverage: averages.length ? Math.max(...averages) : null,
    worstAverage: averages.length ? Math.min(...averages) : null,
    passed,
    successRate: averages.length
      ? roundScore((passed / averages.length) * 100, rules.precision, rules.rounding)
      : null,
    enrolled: students.length,
    ranked: averages.length,
  };

  return { ok: true, result: { rules, students, stats, missing } };
}

/**
 * Persiste les résultats calculés : SubjectPeriodResult + StudentPeriodResult
 * + ResultValidation (statut CALCULATED). Ne publie rien.
 */
export async function computeAndStore(
  ctx: SchoolCtx,
  input: { classroomId: string; academicPeriodId: string },
): Promise<ResultsResult<{ students: number }>> {
  const calc = await calculateClassPeriod(ctx, input);
  if (!calc.ok) return calc;
  const { rules, students } = calc.result;

  await prisma.$transaction(async (tx) => {
    for (const st of students) {
      for (const sub of st.subjects) {
        await tx.subjectPeriodResult.upsert({
          where: {
            academicPeriodId_studentId_subjectId: {
              academicPeriodId: input.academicPeriodId,
              studentId: st.studentId,
              subjectId: sub.subjectId,
            },
          },
          update: {
            average: sub.average,
            coefficient: sub.coefficient,
            weightedPoints:
              sub.average == null ? null : roundScore(sub.average * sub.coefficient, rules.precision, rules.rounding),
            rank: sub.rank,
            isComplete: sub.complete,
            classroomId: input.classroomId,
          },
          create: {
            schoolId: ctx.schoolId,
            academicPeriodId: input.academicPeriodId,
            classroomId: input.classroomId,
            studentId: st.studentId,
            subjectId: sub.subjectId,
            average: sub.average,
            coefficient: sub.coefficient,
            weightedPoints:
              sub.average == null ? null : roundScore(sub.average * sub.coefficient, rules.precision, rules.rounding),
            rank: sub.rank,
            isComplete: sub.complete,
          },
        });
      }
      await tx.studentPeriodResult.upsert({
        where: {
          academicPeriodId_studentId: {
            academicPeriodId: input.academicPeriodId,
            studentId: st.studentId,
          },
        },
        update: {
          generalAverage: st.generalAverage,
          totalCoefficients: st.subjects.reduce((a, s) => a + (s.average != null ? s.coefficient : 0), 0),
          subjectsCount: st.subjects.length,
          rank: st.rank,
          mention: st.mention,
          isComplete: st.complete,
          status: "CALCULATED",
          computedAt: new Date(),
          computedById: ctx.userId,
          classroomId: input.classroomId,
        },
        create: {
          schoolId: ctx.schoolId,
          academicPeriodId: input.academicPeriodId,
          classroomId: input.classroomId,
          studentId: st.studentId,
          generalAverage: st.generalAverage,
          totalCoefficients: st.subjects.reduce((a, s) => a + (s.average != null ? s.coefficient : 0), 0),
          subjectsCount: st.subjects.length,
          rank: st.rank,
          mention: st.mention,
          isComplete: st.complete,
          status: "CALCULATED",
          computedAt: new Date(),
          computedById: ctx.userId,
        },
      });
    }
    await tx.resultValidation.upsert({
      where: {
        classroomId_academicPeriodId: {
          classroomId: input.classroomId,
          academicPeriodId: input.academicPeriodId,
        },
      },
      update: { status: "CALCULATED", computedAt: new Date(), computedById: ctx.userId },
      create: {
        schoolId: ctx.schoolId,
        classroomId: input.classroomId,
        academicPeriodId: input.academicPeriodId,
        status: "CALCULATED",
        computedAt: new Date(),
        computedById: ctx.userId,
      },
    });
  });

  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "results.compute",
    entity: "ResultValidation",
    entityId: `${input.classroomId}:${input.academicPeriodId}`,
    metadata: { students: students.length },
  });
  return { ok: true, result: { students: students.length } };
}

/** Workflow : VALIDATED → résultats + bulletins liés ; PUBLISHED → diffusion. */
export async function setValidationStatus(
  ctx: SchoolCtx,
  input: { classroomId: string; academicPeriodId: string; status: ResultStatus; note?: string },
): Promise<ResultsResult> {
  const rv = await prisma.resultValidation.findFirst({
    where: {
      schoolId: ctx.schoolId,
      classroomId: input.classroomId,
      academicPeriodId: input.academicPeriodId,
    },
  });
  if (!rv) return { ok: false, error: "NOT_FOUND" };
  const allowed: Record<ResultStatus, ResultStatus[]> = {
    DRAFT: ["CALCULATED"],
    CALCULATED: ["VALIDATED", "DRAFT"],
    PENDING_VALIDATION: ["VALIDATED", "CALCULATED"],
    VALIDATED: ["PUBLISHED", "CALCULATED"],
    PUBLISHED: ["RECTIFIED"],
    RECTIFIED: ["VALIDATED"],
  };
  if (!allowed[rv.status].includes(input.status)) {
    return { ok: false, error: "INVALID_STATUS" };
  }
  const data: Record<string, unknown> = { status: input.status, note: input.note ?? rv.note };
  if (input.status === "VALIDATED") {
    data.validatedById = ctx.userId;
    data.validatedAt = new Date();
  }
  if (input.status === "PUBLISHED") {
    data.publishedById = ctx.userId;
    data.publishedAt = new Date();
  }
  await prisma.$transaction([
    prisma.resultValidation.update({ where: { id: rv.id }, data }),
    prisma.studentPeriodResult.updateMany({
      where: { schoolId: ctx.schoolId, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId },
      data: { status: input.status },
    }),
    prisma.reportCard.updateMany({
      where: { schoolId: ctx.schoolId, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId },
      data:
        input.status === "PUBLISHED"
          ? { status: "PUBLISHED", publishedAt: new Date(), publishedById: ctx.userId }
          : { status: input.status },
    }),
  ]);
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
    action: `results.${input.status.toLowerCase()}`,
    entity: "ResultValidation",
    entityId: rv.id,
  });
  if (input.status === "PUBLISHED") {
    const period = await prisma.academicPeriod.findUnique({
      where: { id: input.academicPeriodId },
      select: { name: true },
    });
    await notifyResultsPublished({
      schoolId: ctx.schoolId,
      classroomId: input.classroomId,
      periodName: period?.name ?? "Période",
    });
  }
  return { ok: true, result: undefined };
}

export async function getClassResults(
  ctx: SchoolCtx,
  classroomId: string,
  academicPeriodId: string,
) {
  const [validation, students, subjects] = await Promise.all([
    prisma.resultValidation.findFirst({
      where: { schoolId: ctx.schoolId, classroomId, academicPeriodId },
    }),
    prisma.studentPeriodResult.findMany({
      where: { schoolId: ctx.schoolId, classroomId, academicPeriodId },
      include: { student: { select: { matricule: true, firstName: true, lastName: true } } },
      orderBy: [{ rank: "asc" }, { generalAverage: "desc" }],
    }),
    prisma.subjectPeriodResult.findMany({
      where: { schoolId: ctx.schoolId, classroomId, academicPeriodId },
      include: { subject: { select: { name: true } } },
    }),
  ]);
  return { validation, students, subjects };
}

/** Résultats annuels : moyenne pondérée des périodes validées/calculées. */
export async function computeAnnualResults(
  ctx: SchoolCtx,
  academicYearId: string,
): Promise<ResultsResult<{ students: number }>> {
  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return { ok: false, error: "NOT_FOUND" };
  const weights = await annualWeightsFor(ctx, academicYearId);
  const periodResults = await prisma.studentPeriodResult.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicPeriod: { academicYearId },
      status: { in: ["CALCULATED", "VALIDATED", "PUBLISHED", "RECTIFIED"] },
    },
    select: { studentId: true, academicPeriodId: true, generalAverage: true },
  });
  const rules = await resolveRules(ctx, academicYearId);

  const byStudent = new Map<string, { periodId: string; average: number | null }[]>();
  for (const r of periodResults) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push({ periodId: r.academicPeriodId, average: r.generalAverage });
    byStudent.set(r.studentId, list);
  }
  const entries = [...byStudent.entries()].map(([studentId, periods]) => ({
    studentId,
    average:
      annualAverage(periods, weights) == null
        ? null
        : roundScore(annualAverage(periods, weights)!, rules.precision, rules.rounding),
  }));
  const ranks = computeRanks(entries.map((e) => ({ id: e.studentId, average: e.average })), rules.tieRule);

  await prisma.$transaction(
    entries.map((e) =>
      prisma.studentAnnualResult.upsert({
        where: { academicYearId_studentId: { academicYearId, studentId: e.studentId } },
        update: {
          annualAverage: e.average,
          rank: ranks.get(e.studentId) ?? null,
          mention: mentionFor(e.average, rules),
          status: "CALCULATED",
          computedAt: new Date(),
          computedById: ctx.userId,
        },
        create: {
          schoolId: ctx.schoolId,
          academicYearId,
          studentId: e.studentId,
          annualAverage: e.average,
          rank: ranks.get(e.studentId) ?? null,
          mention: mentionFor(e.average, rules),
          status: "CALCULATED",
          computedAt: new Date(),
          computedById: ctx.userId,
        },
      }),
    ),
  );
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "results.computeAnnual",
    entity: "AcademicYear",
    entityId: academicYearId,
    metadata: { students: entries.length },
  });
  return { ok: true, result: { students: entries.length } };
}
