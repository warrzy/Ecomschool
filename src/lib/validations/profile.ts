import { z } from "zod";

/**
 * Numéro WhatsApp au format international E.164 : « + » suivi de 7 à 15
 * chiffres, le premier non nul (ex. +22655903205).
 */
export const e164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Format international attendu (ex. +226XXXXXXXX)");

export const whatsappProfileSchema = z.object({
  whatsappNumber: z.union([e164Schema, z.literal("")]),
  whatsappOptIn: z.boolean(),
});

export type WhatsappProfileInput = z.infer<typeof whatsappProfileSchema>;
