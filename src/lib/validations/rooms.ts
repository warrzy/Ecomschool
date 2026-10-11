import { z } from "zod";

const roomTypeEnum = z.enum([
  "CLASSROOM",
  "LAB",
  "SCIENCE",
  "SPORT",
  "ADMIN",
  "OTHER",
]);

export const roomCreateSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  capacity: z.coerce.number().int().min(0).optional(),
  building: z.string().trim().max(100).optional(),
  floor: z.string().trim().max(50).optional(),
  type: roomTypeEnum.optional(),
});

export const roomUpdateSchema = roomCreateSchema.partial().extend({
  capacity: z.coerce.number().int().min(0).nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});
