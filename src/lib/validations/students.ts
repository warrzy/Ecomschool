import { z } from "zod";

const sexField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => (v === "M" || v === "MALE" ? "MALE" : v === "F" || v === "FEMALE" ? "FEMALE" : v))
  .pipe(z.enum(["MALE", "FEMALE"]))
  .optional();

const dateField = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(new Date(v).getTime()), {
    message: "INVALID_DATE",
  })
  .optional();

export const studentRowSchema = z.object({
  matricule: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(100),
  firstName: z.string().trim().min(1).max(100),
  sex: sexField,
  birthDate: dateField,
  birthPlace: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  address: z.string().trim().max(255).optional(),
});

export type StudentRowInput = z.infer<typeof studentRowSchema>;

export const studentCreateSchema = studentRowSchema.extend({
  photoUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
});

export const studentUpdateSchema = studentCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});
