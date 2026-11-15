/**
 * I18N-P0 — Correspondances des états financiers externalisées.
 *
 * Avant : le bilan et le compte de résultat supposaient en dur la
 * structure de classes OHADA (1 capitaux, 2 immobilisé, …, 6 charges,
 * 7 produits). Désormais, la correspondance rubrique ⇄ comptes est un
 * OBJET DÉCLARATIF : OHADA reste le mapping par défaut (non-régression
 * garantie), un autre référentiel fournit le sien via le pack
 * comptable ou `School.settings.statementMapping`.
 */

import { countryDefaults } from "@/lib/config/countries";

/**
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

type SettingsWithMapping = {
  statementMapping?: unknown;
  /** Référentiel déclaré explicitement pour l'établissement (prioritaire
   * sur le défaut pays — ex. une école du Ghana tenant ses livres en
   * SYSCOHADA pour un groupe OHADA). */
  accountingFramework?: unknown;
};

export type StatementMappingResolution =
  | { ok: true; mapping: StatementMapping }
  | { ok: false; error: "STATEMENT_MAPPING_MISSING" | "STATEMENT_MAPPING_INVALID" };

function isValidMapping(m: unknown): m is StatementMapping {
  const c = m as Partial<StatementMapping> | null;
  return !!(
    c && typeof c === "object"
    && Array.isArray(c.balanceSheet?.actif) && c.balanceSheet.actif.length > 0
    && Array.isArray(c.balanceSheet?.passif) && c.balanceSheet.passif.length > 0
    && Array.isArray(c.incomeStatement?.charges) && c.incomeStatement.charges.length > 0
    && Array.isArray(c.incomeStatement?.produits) && c.incomeStatement.produits.length > 0
  );
}

/**
 * Résout le mapping d'états d'une école — sécurisé :
 *  - surcharge `School.settings.statementMapping` valide → utilisée ;
 *  - sinon le repli OHADA n'est autorisé QUE si le référentiel de
 *    l'établissement est OHADA (déclaré via `settings.accountingFramework`
 *    ou déduit de `School.country` via COUNTRY_DEFAULTS) ;
 *  - pour tout autre référentiel, un mapping absent ou invalide produit
 *    une erreur explicite — jamais d'état potentiellement incorrect.
 */
export function statementMappingFor(input: {
  country?: string | null;
  settings?: unknown;
}): StatementMappingResolution {
  const settings = input.settings as SettingsWithMapping | null | undefined;
  const explicit = settings?.statementMapping;
  if (explicit != null && isValidMapping(explicit)) return { ok: true, mapping: explicit };

  const declared = typeof settings?.accountingFramework === "string"
    ? settings.accountingFramework : undefined;
  const framework = declared ?? countryDefaults(input.country ?? "")?.accountingFramework;
  const isOhada = framework === "OHADA_SYSCOHADA";

  if (explicit != null)
    return isOhada
      ? { ok: true, mapping: OHADA_STATEMENT_MAPPING }
      : { ok: false, error: "STATEMENT_MAPPING_INVALID" };
  return isOhada
    ? { ok: true, mapping: OHADA_STATEMENT_MAPPING }
    : { ok: false, error: "STATEMENT_MAPPING_MISSING" };
}
