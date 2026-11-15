/**
 * I18N-P0 — Registre des pays supportés (COUNTRY_DEFAULTS).
 *
 * Table de vérité produit : pays ISO 3166-1 alpha-2 → devise, locale,
 * fuseau et référentiel comptable par défaut proposés à l'onboarding.
 * Aucune règle réglementaire n'est embarquée ici — ce sont des défauts
 * de création, pas des barèmes.
 */

export type CountryDefault = {
  code: string;           // ISO alpha-2
  name: string;           // nom affiché
  currency: string;       // ISO 4217
  locale: string;         // BCP-47
  timezone: string;       // IANA
  /** Référentiel comptable par défaut de la zone. */
  accountingFramework: "OHADA_SYSCOHADA" | "IFRS_STYLE" | "PCG_FR";
  /** Pays sélectionnable aujourd'hui (sinon : « bientôt » à l'onboarding). */
  available: boolean;
};

export const COUNTRY_DEFAULTS: CountryDefault[] = [
  { code: "BF", name: "Burkina Faso", currency: "XOF", locale: "fr-BF", timezone: "Africa/Ouagadougou", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF", locale: "fr-CI", timezone: "Africa/Abidjan", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "SN", name: "Sénégal", currency: "XOF", locale: "fr-SN", timezone: "Africa/Dakar", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "BJ", name: "Bénin", currency: "XOF", locale: "fr-BJ", timezone: "Africa/Porto-Novo", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "TG", name: "Togo", currency: "XOF", locale: "fr-TG", timezone: "Africa/Lome", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "ML", name: "Mali", currency: "XOF", locale: "fr-ML", timezone: "Africa/Bamako", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "NE", name: "Niger", currency: "XOF", locale: "fr-NE", timezone: "Africa/Niamey", accountingFramework: "OHADA_SYSCOHADA", available: true },
  { code: "GH", name: "Ghana", currency: "GHS", locale: "en-GH", timezone: "Africa/Accra", accountingFramework: "IFRS_STYLE", available: true },
  { code: "NG", name: "Nigeria", currency: "NGN", locale: "en-NG", timezone: "Africa/Lagos", accountingFramework: "IFRS_STYLE", available: true },
  { code: "FR", name: "France", currency: "EUR", locale: "fr-FR", timezone: "Europe/Paris", accountingFramework: "PCG_FR", available: true },
];

const BY_CODE = new Map(COUNTRY_DEFAULTS.map((c) => [c.code, c]));

/** Défauts d'un pays ; undefined si code inconnu. */
export function countryDefaults(code: string): CountryDefault | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** Pays sélectionnables à l'onboarding. */
export function availableCountries(): CountryDefault[] {
  return COUNTRY_DEFAULTS.filter((c) => c.available);
}

/**
 * Contrôle de cohérence pays ↔ devise ↔ référentiel.
 * Une école garde la devise de son pays (verrou création) ; le fuseau et
 * la locale restent ajustables (diaspora, frontières linguistiques).
 */
export function checkCountryCoherence(input: {
  country: string; currency: string;
}): { ok: true } | { ok: false; error: string } {
  const c = countryDefaults(input.country);
  if (!c) return { ok: false, error: "COUNTRY_UNKNOWN" };
  if (!c.available) return { ok: false, error: "COUNTRY_UNAVAILABLE" };
  if (input.currency.toUpperCase() !== c.currency)
    return { ok: false, error: "CURRENCY_MISMATCH" };
  return { ok: true };
}
