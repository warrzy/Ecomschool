import { z } from "zod";

export const gradingPolicySchema = z.object({
  academicYearId: z.string().min(1),
  levelId: z.string().optional(),
  maxScore: z.coerce.number().positive().max(1000).default(20),
  minScore: z.coerce.number().min(0).default(0),
  precision: z.coerce.number().int().min(0).max(4).default(2),
  rounding: z.enum(["HALF_UP", "FLOOR", "CEIL"]).default("HALF_UP"),
  passMark: z.coerce.number().min(0).default(10),
  missingGradePolicy: z.enum(["EXCLUDE", "ZERO"]).default("EXCLUDE"),
  absentPolicy: z.enum(["EXCLUDE", "ZERO"]).default("EXCLUDE"),
  exemptPolicy: z.enum(["EXCLUDE", "ZERO"]).default("EXCLUDE"),
  tieRule: z.enum(["SHARED_RANK", "DENSE_RANK"]).default("SHARED_RANK"),
  perSubjectRank: z.coerce.boolean().default(true),
  mentions: z.string().optional(), // JSON ou "Label:min;Label:min"
});

export const assessmentCreateSchema = z.object({
  academicYearId: z.string().min(1),
  academicPeriodId: z.string().optional(),
  classroomId: z.string().min(1),
  subjectId: z.string().min(1),
  teacherId: z.string().optional(),
  typeId: z.string().min(1),
  title: z.string().min(2).max(200),
  date: z.string().min(1),
  maxScore: z.coerce.number().positive().max(1000).default(20),
  coefficient: z.coerce.number().positive().max(100).default(1),
  description: z.string().max(2000).optional(),
});

export const assessmentTypeSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(100),
  defaultCoefficient: z.coerce.number().positive().max(100).default(1),
});

export const gradeStatusSchema = z.enum([
  "ENTERED",
  "MISSING",
  "ABSENT",
  "EXEMPT",
  "CANCELLED",
]);

export const computeResultsSchema = z.object({
  classroomId: z.string().min(1),
  academicPeriodId: z.string().min(1),
});

export const annualResultsSchema = z.object({
  academicYearId: z.string().min(1),
});

export const reportCardGenerateSchema = z.object({
  classroomId: z.string().min(1),
  academicPeriodId: z.string().min(1),
});
