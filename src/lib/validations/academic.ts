import { z } from "zod";

export const yearCreateSchema = z.object({
  name: z.string().trim().min(4),
  startDate: z.string().min(4),
  endDate: z.string().min(4),
  periodType: z.enum(["TRIMESTER", "SEMESTER"]),
  isCurrent: z.boolean().default(false),
});

export type YearCreateInput = z.infer<typeof yearCreateSchema>;

export const periodUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  startDate: z.string().min(4).optional(),
  endDate: z.string().min(4).optional(),
  isLocked: z.boolean().optional(),
});

export type PeriodUpdateInput = z.infer<typeof periodUpdateSchema>;
