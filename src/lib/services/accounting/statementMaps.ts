/**
 * I18N-P0 — Correspondances des états financiers externalisées.
 *
 * Avant : le bilan et le compte de résultat supposaient en dur la
 * structure de classes OHADA (1 capitaux, 2 immobilisé, …, 6 charges,
 * 7 produits). Désormais, la correspondance rubrique ⇄ comptes est un
 * OBJET DÉCLARATIF : OHADA reste le mapping par défaut (non-régression
 * garantie), un autre référentiel fournit le sien via le pack
 * comptable ou `School.settings.statementMapping`.
 *
 * Chaque section se définit par :
 *   - classes : valeurs de `AccountingAccount.classNumber` retenues —
 *     clé de regroupement libre que chaque plan définit (OHADA = 1-7) ;
 *   - sign    : filtre optionnel sur le solde (debit | credit) ;
 *   - side    : côté du solde retenu — "debit" (D−C) ou "credit" (C−D).
 */

export type StatementSectionDef = {
  key: string;
  label: string;
  classes: number[];
  sign?: "debit" | "credit";
  side: "debit" | "credit";
};

export type StatementMapping = {
  /** Nom du référentiel — affiché dans les écrans/exports. */
  framework: string;
  incomeStatement: {
    charges: StatementSectionDef[];
    produits: StatementSectionDef[];
  };
  balanceSheet: {
    actif: StatementSectionDef[];
    passif: StatementSectionDef[];
  };
};

/** Mapping SYSCOHADA — équivalent strict du comportement historique. */
export const OHADA_STATEMENT_MAPPING: StatementMapping = {
  framework: "SYSCOHADA",
  incomeStatement: {
    charges: [{ key: "charges", label: "Charges", classes: [6], side: "debit" }],
    produits: [{ key: "produits", label: "Produits", classes: [7], side: "credit" }],
  },
  balanceSheet: {
    actif: [
      { key: "actif.immobilise", label: "Actif immobilisé", classes: [2], side: "debit" },
      { key: "actif.stocks", label: "Stocks", classes: [3], side: "debit" },
      { key: "actif.tiers", label: "Tiers débiteurs", classes: [4], sign: "debit", side: "debit" },
      { key: "actif.tresorerie", label: "Trésorerie actif", classes: [5], sign: "debit", side: "debit" },
    ],
    passif: [
      { key: "passif.capitaux", label: "Capitaux propres", classes: [1], side: "credit" },
      { key: "passif.dettes", label: "Dettes", classes: [4], sign: "credit", side: "credit" },
      { key: "passif.tresorerie", label: "Trésorerie passif", classes: [5], sign: "credit", side: "credit" },
    ],
  },
};

type SettingsWithMapping = { statementMapping?: unknown };

/**
 * Résout le mapping d'états d'une école :
 * `School.settings.statementMapping` (surcharge explicite) → OHADA.
 * Une surcharge invalide est ignorée — jamais d'état cassé.
 */
export function statementMappingFor(settings: unknown): StatementMapping {
  const m = (settings as SettingsWithMapping | null)?.statementMapping;
  if (m && typeof m === "object") {
    const cand = m as Partial<StatementMapping>;
    if (cand.balanceSheet?.actif?.length && cand.incomeStatement?.charges?.length)
      return cand as StatementMapping;
  }
  return OHADA_STATEMENT_MAPPING;
}
