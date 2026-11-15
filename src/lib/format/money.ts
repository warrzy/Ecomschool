/**
 * I18N-P0 — Formatage monétaire international centralisé.
 *
 * Remplace les littéraux `${n.toLocaleString("fr-FR")} FCFA` répétés dans
 * ~60 fichiers. Le rendu par défaut (XOF / fr-FR) est STRICTEMENT
 * identique à l'ancien : `1 234 567 FCFA` — compatibilité visuelle
 * garantie pour les établissements existants.
 *
 * Le symbole affiché est contrôlé par CURRENCY_DISPLAY (décision produit,
 * pas la notation ISO d'Intl — "FCFA" reste préféré à "XOF" en Afrique
 * de l'Ouest). Ajouter une devise = ajouter une ligne, zéro logique.
 */

/** Symbole affiché par devise (position et séparateur par locale). */
export const CURRENCY_DISPLAY: Record<string, string> = {
  XOF: "FCFA",
  XAF: "FCFA",
  GHS: "GH₵",
  NGN: "₦",
  EUR: "€",
  USD: "$",
};

/** Devises sans décimales (pas de centimes en usage courant). */
const ZERO_DECIMAL = new Set(["XOF", "XAF"]);

export type MoneyOptions = {
  /** ISO 4217 — défaut XOF : comportement historique inchangé. */
  currency?: string;
  /** BCP-47 — défaut fr-FR : comportement historique inchangé. */
  locale?: string;
  /** Format compact ("1,2 M") pour les KPIs — conserve le suffixe devise. */
  compact?: boolean;
};

/** Formate un montant entier dans la devise et la locale données. */
export function fmtMoney(n: number, opts: MoneyOptions = {}): string {
  const currency = opts.currency ?? "XOF";
  const locale = opts.locale ?? "fr-FR";
  const symbol = CURRENCY_DISPLAY[currency] ?? currency;
  if (opts.compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000)
      return `${(n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })} M ${symbol}`;
    if (abs >= 10_000)
      return `${(n / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })} k ${symbol}`;
  }
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const num = n.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Convention francophone : montant espace symbole (défaut historique).
  // L'extension par pays introduira des patterns par pack FORMAT.
  return `${num} ${symbol}`;
}

/**
 * Format compact en millions, suffixe « M » — usage KPI
 * (ex. `1,2 M`). Sans symbole devise : le contexte l'indique déjà.
 */
export function fmtMoneyCompactM(millions: number, locale = "fr-FR"): string {
  return `${millions.toLocaleString(locale, { maximumFractionDigits: 1 })} M`;
}

/** Fabrique un formateur lié à la devise/locale d'un établissement. */
export function moneyFormatter(school: {
  currency?: string | null;
  locale?: string | null;
}): (n: number, opts?: Omit<MoneyOptions, "currency" | "locale">) => string {
  return (n, opts = {}) =>
    fmtMoney(n, { currency: school.currency ?? "XOF", locale: school.locale ?? "fr-FR", ...opts });
}
