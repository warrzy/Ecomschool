import { z } from "zod";

/**
 * Aides de validation Zod pour les server actions (FormData).
 * Objectif : rejeter proprement les entrées invalides (NaN, dates invalides,
 * identifiants vides) avant qu'elles n'atteignent Prisma.
 */

/** Entier strict : rejette NaN / valeurs non numériques. */
export const intField = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v), "INVALID_NUMBER")
  .transform((v) => Math.trunc(v));

/** Entier strict ≥ 0. */
export const intNonNegative = intField.refine((v) => v >= 0, "INVALID_NUMBER");

/** Entier strict > 0. */
export const intPositive = intField.refine((v) => v > 0, "INVALID_NUMBER");

/** Date au format YYYY-MM-DD (ou ISO) ; rejette les dates invalides. */
export const dateField = z
  .string()
  .min(4)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "INVALID_DATE");

/** Date optionnelle : chaîne vide → undefined, sinon dateField. */
export const optionalDateField = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v : undefined))
  .pipe(dateField.optional());

/** Identifiant non vide. */
export const idField = z.string().trim().min(1);

/** Chaîne non vide. */
export const requiredText = z.string().trim().min(1);

/** Chaîne optionnelle : vide → undefined. */
export const optionalText = z
  .string()
  .transform((v) => v.trim())
  .optional()
  .transform((v) => (v ? v : undefined));
