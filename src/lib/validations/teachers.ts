import { z } from "zod";

export const teacherCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
});

export const teacherUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const assignmentCreateSchema = z.object({
  teacherId: z.string().min(1),
  classroomId: z.string().min(1),
  subjectId: z.string().optional(),
  academicYearId: z.string().min(1),
});

export const teacherAccountSchema = z.object({
  teacherId: z.string().min(1),
  password: z.string().min(8).max(200),
});
