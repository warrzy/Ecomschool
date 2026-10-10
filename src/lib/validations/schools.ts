import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const schoolUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  address: optionalText,
  city: optionalText,
  phone: optionalText,
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().email().nullable())
    .optional(),
  website: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().url().nullable())
    .optional(),
  logoUrl: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().url().nullable())
    .optional(),
  type: z
    .enum(["PRIMARY", "MIDDLE", "HIGH", "MIXED", "OTHER"])
    .nullable()
    .optional(),
  schoolSystem: z.enum(["TRIMESTER", "SEMESTER", "OTHER"]).nullable().optional(),
  settings: z.unknown().optional(),
});

export type SchoolUpdateInput = z.infer<typeof schoolUpdateSchema>;

export const platformSchoolUpdateSchema = schoolUpdateSchema.extend({
  code: z
    .string()
    .trim()
    .min(2)
    .regex(/^[A-Z0-9-]+$/, "Code invalide")
    .optional(),
  country: z.string().trim().min(2).optional(),
});

export type PlatformSchoolUpdateInput = z.infer<
  typeof platformSchoolUpdateSchema
>;

export const schoolAdminCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
});

export type SchoolAdminCreateInput = z.infer<typeof schoolAdminCreateSchema>;
