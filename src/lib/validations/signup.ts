import { z } from "zod";

/**
 * Formulaire public d'inscription d'établissement.
 * Normalisation identique à l'onboarding plateforme : trims, casse des
 * emails, préfixe https:// automatique pour le site web.
 */
export const signupRequestSchema = z.object({
  schoolName: z
    .string()
    .trim()
    .min(2, "Nom de l'établissement : 2 caractères minimum")
    .max(160),
  city: z.string().trim().min(2, "Ville : 2 caractères minimum").optional(),
  country: z.string().trim().max(80).optional(),
  phone: z
    .string()
    .trim()
    .min(6, "Téléphone de l'établissement : 6 caractères minimum")
    .optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email de l'établissement invalide")
    .optional(),
  website: z
    .string()
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .pipe(z.string().url("Site web : URL invalide (ex. https://ecole.bf)"))
    .optional(),

  contactName: z
    .string()
    .trim()
    .min(2, "Nom du responsable : 2 caractères minimum")
    .max(120),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email du responsable invalide"),
  contactPhone: z.string().trim().min(6, "Téléphone : 6 caractères minimum").optional(),

  planCode: z.string().trim().max(40).optional(),
  note: z.string().trim().max(2000, "Message : 2000 caractères maximum").optional(),

  // Honeypot anti-spam : invisible pour les humains, rempli par les bots.
  companyUrl: z.string().max(0).optional().or(z.literal("")),
});

export type SignupRequestInput = z.infer<typeof signupRequestSchema>;
