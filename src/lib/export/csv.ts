/**
 * Socle CSV commun aux exports ECOM-SCHOOL.
 * - UTF-8 avec BOM (affichage correct des accents sous Excel français).
 * - Séparateur « ; », lignes CRLF.
 * - Échappement « "…" » avec guillemets doublés.
 * - Neutralisation des formules : tout texte commençant par = + - @ ou un
 *   caractère de contrôle est préfixé d'une apostrophe (recommandation
 *   OWASP — empêche l'interprétation =CMD/HYPERLINK à l'ouverture).
 */

type Cell = string | number | null | undefined;

/** Préfixe dangereux : espaces/caractères de contrôle puis = + - @. */
const FORMULA_PREFIX = /^[\s]*[=+\-@]/;

export function csvCell(v: Cell): string {
  if (v == null) return "";
  let s = typeof v === "string" ? v : String(v);
  if (typeof v === "string" && FORMULA_PREFIX.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(csvCell).join(";")];
  for (const r of rows) lines.push(r.map(csvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
