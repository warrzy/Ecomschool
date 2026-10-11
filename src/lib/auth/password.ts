import bcrypt from "bcryptjs";
import { z } from "zod";

/** Politique de mot de passe : ≥ 10 caractères, au moins une lettre et un chiffre. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 10) return "PASSWORD_TOO_SHORT";
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/[0-9]/.test(password)) {
    return "PASSWORD_TOO_WEAK";
  }
  return null;
}

/** Schéma Zod à réutiliser dans les validations de formulaires. */
export const passwordSchema = z
  .string()
  .max(200)
  .refine((p) => passwordPolicyError(p) === null, {
    message:
      "Mot de passe : 10 caractères minimum, avec au moins une lettre et un chiffre.",
  });

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
