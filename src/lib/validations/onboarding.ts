import { z } from "zod";

export const onboardingCreateSchoolSchema = z.object({
  name: z.string().min(2),
  code: z
    .string()
    .min(2)
    .regex(/^[A-Z0-9-]+$/, "Code invalide"),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Slug invalide"),
  city: z.string().min(2).optional(),
  phone: z.string().min(6).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  academicYearName: z.string().min(4),
  startDate: z.string().min(4),
  endDate: z.string().min(4),
  periodType: z.enum(["TRIMESTER", "SEMESTER"]),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminFirstName: z.string().min(2),
  adminLastName: z.string().min(2),
});

export type OnboardingCreateSchoolInput = z.infer<
  typeof onboardingCreateSchoolSchema
>;
