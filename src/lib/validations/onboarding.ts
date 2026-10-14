import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";

export const onboardingCreateSchoolSchema = z.object({
  name: z.string().trim().min(2, "Nom de l'établissement : 2 caractères minimum"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Code : 2 caractères minimum")
    .regex(/^[A-Z0-9-]+$/, "Code : lettres majuscules, chiffres et tirets uniquement"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug : 2 caractères minimum")
    .regex(/^[a-z0-9-]+$/, "Slug : lettres minuscules, chiffres et tirets uniquement"),
  city: z.string().trim().min(2, "Ville : 2 caractères minimum").optional(),
  phone: z.string().trim().min(6, "Téléphone : 6 caractères minimum").optional(),
  email: z.string().trim().toLowerCase().email("Email de l'établissement invalide").optional(),
  website: z
    .string()
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .pipe(z.string().url("Site web : URL invalide (ex. https://ecole.bf)"))
    .optional(),
  academicYearName: z.string().trim().min(4, "Nom de l'année scolaire requis"),
  startDate: z.string().min(4, "Date de début requise"),
  endDate: z.string().min(4, "Date de fin requise"),
  periodType: z.enum(["TRIMESTER", "SEMESTER"]),
  adminEmail: z.string().trim().toLowerCase().email("Email de l'administrateur invalide"),
  adminPassword: passwordSchema,
  adminFirstName: z.string().trim().min(2, "Prénom : 2 caractères minimum"),
  adminLastName: z.string().trim().min(2, "Nom : 2 caractères minimum"),
});

export type OnboardingCreateSchoolInput = z.infer<
  typeof onboardingCreateSchoolSchema
>;
