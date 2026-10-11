import { z } from "zod";

const relationEnum = z.enum([
  "FATHER",
  "MOTHER",
  "GUARDIAN",
  "FINANCIAL",
  "EMERGENCY",
]);

export const guardianCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  address: z.string().trim().max(255).optional(),
});

export const guardianUpdateSchema = guardianCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const guardianLinkSchema = z.object({
  studentId: z.string().min(1),
  guardianId: z.string().min(1),
  relation: relationEnum,
});

// Création d'un nouveau tuteur + rattachement immédiat depuis la fiche élève
export const guardianCreateAndLinkSchema = guardianCreateSchema.extend({
  studentId: z.string().min(1),
  relation: relationEnum,
});
