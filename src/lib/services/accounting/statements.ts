import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { trialBalance } from "@/lib/services/accounting";

type AcctResult<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): AcctResult<T> => ({ ok: true, result: r });
const err = (e: string): AcctResult<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: k });

type Ctx = { userId: string; schoolId: string };
type Line = { code: string; name: string; amount: number };
type Section = { label: string; lines: Line[]; total: number };

/**
 * États financiers SYSCOHADA (CG-3).
 * Mapping par défaut par classe de compte — référentiel à valider par
 * le référent comptable (CG-E) avant usage officiel :
 *   actif  : 2 immobilisé, 3 stocks, 4/5 soldes débiteurs (tiers, trésorerie)
 *   passif : 1 capitaux, 4/5 soldes créditeurs (dettes, trésorerie passif)
 *   résultat : produits (7) − charges (6) ; bénéfice → passif, perte → actif.
 */

const sec = (label: string, lines: Line[]): Section => ({
  label, lines: lines.filter((l) => l.amount !== 0).sort((a, b) => a.code.localeCompare(b.code)),
  total: lines.reduce((s, l) => s + l.amount, 0),
});

function rows(ctx: Ctx, exerciseId: string) {
  return trialBalance(ctx, exerciseId).then((r) =>
    r.ok ? r.result.balance : Promise.reject(new Error(r.error)));
}

export async function incomeStatement(
  ctx: Ctx, exerciseId: string,
): Promise<AcctResult<{ charges: Section; produits: Section; resultat: number }>> {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const balance = await rows(ctx, exerciseId);
  const charges = sec("Charges", balance
    .filter((r) => r.classNumber === 6)
    .map((r) => ({ code: r.code, name: r.name, amount: r.debit - r.credit })));
  const produits = sec("Produits", balance
    .filter((r) => r.classNumber === 7)
    .map((r) => ({ code: r.code, name: r.name, amount: r.credit - r.debit })));
  return ok({ charges, produits, resultat: produits.total - charges.total });
}

export async function balanceSheet(
  ctx: Ctx, exerciseId: string,
): Promise<AcctResult<{ actif: Section[]; passif: Section[]; totalActif: number; totalPassif: number; resultat: number }>> {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const balance = await rows(ctx, exerciseId);
  const net = balance.map((r) => ({ ...r, solde: r.debit - r.credit }));
  const actif = [
    sec("Actif immobilisé", net.filter((r) => r.classNumber === 2).map((r) => ({ code: r.code, name: r.name, amount: r.solde }))),
    sec("Stocks", net.filter((r) => r.classNumber === 3).map((r) => ({ code: r.code, name: r.name, amount: r.solde }))),
    sec("Tiers débiteurs", net.filter((r) => r.classNumber === 4 && r.solde > 0).map((r) => ({ code: r.code, name: r.name, amount: r.solde }))),
    sec("Trésorerie actif", net.filter((r) => r.classNumber === 5 && r.solde > 0).map((r) => ({ code: r.code, name: r.name, amount: r.solde }))),
  ];
  const passif = [
    sec("Capitaux propres", net.filter((r) => r.classNumber === 1).map((r) => ({ code: r.code, name: r.name, amount: -r.solde }))),
    sec("Dettes", net.filter((r) => r.classNumber === 4 && r.solde < 0).map((r) => ({ code: r.code, name: r.name, amount: -r.solde }))),
    sec("Trésorerie passif", net.filter((r) => r.classNumber === 5 && r.solde < 0).map((r) => ({ code: r.code, name: r.name, amount: -r.solde }))),
  ];
  const is = await incomeStatement(ctx, exerciseId);
  const resultat = is.ok ? is.result.resultat : 0;
  // Résultat : bénéfice côté passif (classe 13), perte côté actif — actif = passif garanti.
  if (resultat >= 0) passif[0].lines.push({ code: "RÉS", name: "Résultat de l'exercice (bénéfice)", amount: resultat });
  else actif[0].lines.push({ code: "RÉS", name: "Résultat de l'exercice (perte)", amount: -resultat });
  const totalActif = actif.reduce((s, x) => s + x.lines.reduce((t, l) => t + l.amount, 0), 0);
  const totalPassif = passif.reduce((s, x) => s + x.lines.reduce((t, l) => t + l.amount, 0), 0);
  passif[0].total = passif[0].lines.reduce((t, l) => t + l.amount, 0);
  actif[0].total = actif[0].lines.reduce((t, l) => t + l.amount, 0);
  return ok({ actif, passif, totalActif, totalPassif, resultat });
}

const escCsv = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};

export async function statementCsv(
  ctx: Ctx, kind: "bilan" | "resultat", exerciseId: string,
): Promise<AcctResult<{ csv: string; filename: string }>> {
  if (!(await has(ctx, "accounting.export"))) return err("FORBIDDEN");
  const rows: string[] = ["section;compte;libelle;montant"];
  if (kind === "resultat") {
    const is = await incomeStatement(ctx, exerciseId);
    if (!is.ok) return err(is.error);
    for (const s of [is.result.charges, is.result.produits])
      for (const l of s.lines) rows.push([s.label, l.code, l.name, l.amount].map(escCsv).join(";"));
    rows.push(["RÉSULTAT", "", "Produits − charges", is.result.resultat].map(escCsv).join(";"));
    return ok({ csv: rows.join("\r\n"), filename: `compte-resultat-${exerciseId}.csv` });
  }
  const bs = await balanceSheet(ctx, exerciseId);
  if (!bs.ok) return err(bs.error);
  for (const s of [...bs.result.actif, ...bs.result.passif])
    for (const l of s.lines) rows.push([s.label, l.code, l.name, l.amount].map(escCsv).join(";"));
  rows.push(["TOTAL ACTIF", "", "", bs.result.totalActif].map(escCsv).join(";"));
  rows.push(["TOTAL PASSIF", "", "", bs.result.totalPassif].map(escCsv).join(";"));
  return ok({ csv: rows.join("\r\n"), filename: `bilan-${exerciseId}.csv` });
}

/** Utilisé par la page et la route PDF. */
export async function exerciseOf(ctx: Ctx, exerciseId: string) {
  return prisma.accountingExercise.findFirst({
    where: { id: exerciseId, schoolId: ctx.schoolId },
    select: { id: true, name: true, startDate: true, endDate: true, status: true },
  });
}
