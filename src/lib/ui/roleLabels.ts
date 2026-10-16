/**
 * Libellés français des rôles — jamais de clé technique brute à l'écran.
 * Clé inconnue → la clé est renvoyée telle quelle (rôle personnalisé).
 */
const ROLE_LABELS: Record<string, string> = {
  PLATFORM_OWNER: "Propriétaire plateforme",
  PLATFORM_SALES: "Commercial plateforme",
  ADMIN_SCHOOL: "Administrateur",
  TEACHER: "Enseignant",
  FINANCE_MANAGER: "Responsable financier",
  CASHIER: "Caissier",
  PARENT: "Parent",
  STUDENT: "Élève",
};

export function roleLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return ROLE_LABELS[key] ?? key;
}
