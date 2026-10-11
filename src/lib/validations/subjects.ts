import { z } from "zod";

export const subjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(20).optional(),
});

export const subjectUpdateSchema = subjectCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const levelCoefficientSchema = z.object({
  subjectId: z.string().min(1),
  levelId: z.string().min(1),
  coefficient: z.coerce.number().positive().max(100),
});

export const classroomSubjectSchema = z.object({
  classroomId: z.string().min(1),
  subjectId: z.string().min(1),
  coefficient: z.coerce.number().positive().max(100),
  teacherId: z.string().optional(),
});
