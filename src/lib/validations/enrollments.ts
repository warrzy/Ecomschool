import { z } from "zod";

export const enrollmentCreateSchema = z.object({
  studentId: z.string().min(1),
  classroomId: z.string().min(1),
  academicYearId: z.string().optional(),
});

export const enrollmentTransferSchema = z.object({
  enrollmentId: z.string().min(1),
  toClassroomId: z.string().min(1),
});

export const enrollmentCloseSchema = z.object({
  enrollmentId: z.string().min(1),
  status: z.enum(["WITHDRAWN", "COMPLETED"]),
});
