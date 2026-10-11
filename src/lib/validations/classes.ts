import { z } from "zod";

export const levelCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  order: z.coerce.number().int().min(0).default(0),
});

export const levelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  order: z.coerce.number().int().min(0).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const classroomCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  academicYearId: z.string().min(1),
  levelId: z.string().min(1),
  section: z.string().trim().max(50).optional(),
  capacity: z.coerce.number().int().min(0).optional(),
  room: z.string().trim().max(100).optional(),
  headTeacherId: z.string().optional(),
});

export const classroomUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  levelId: z.string().min(1).optional(),
  section: z.string().trim().max(50).optional(),
  capacity: z.coerce.number().int().min(0).nullable().optional(),
  room: z.string().trim().max(100).optional(),
  headTeacherId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});
