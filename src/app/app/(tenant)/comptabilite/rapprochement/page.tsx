import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listStatements, reconciliationReport } from "@/lib/services/accounting/reconciliation";
import { listJournals } from "@/lib/services/accounting";
import { importStatementAction, autoMatchAction, unmatchAction } from "../actions-rapprochement";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const INP = "rounded border px-2 py-1 text-sm";
const fmt = (n: number) => n.toLocaleString("fr-FR");

/** CG-5 : rapprochement bancaire — import relevé, pointage auto, écarts. */
export default async function RapproPage(props: { searchParams: Promise<{ id?: string; ok?: string; err?: string }> }) {
  const t = await requireSchoolPermission("accounting.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canManage = await userHasSchoolPermission({ ...ctx, permissionKey: "accounting.manage" });
  const [sts, jours] = await Promise.all([listStatements(ctx), listJournals(ctx)]);
  const rep = sp.id ? await reconciliationReport(ctx, sp.id) : null;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Rapprochement bancaire</h1>
      {sp.err ? <p className="text-sm text-red-600">{sp.err}</p> : null}
      {sp.ok ? <p className="text-sm text-green-700">{sp.ok}</p> : null}

      <section className="rounded-lg border">
        <h2 className="border-b bg-slate-50 p-2 font-semibold">Relevés importés</h2>
        <table className="w-full text-sm">
          <tbody>
            {(sts.ok ? sts.result : []).map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2"><a className="underline" href={`/app/comptabilite/rapprochement?id=${s.id}`}>{s.journal.code} — {s.journal.label}</a></td>
                <td>{s.periodStart.toISOString().slice(0, 10)} → {s.periodEnd.toISOString().slice(0, 10)}</td>
                <td>{s._count.lines} lignes</td>
                <td className="text-right font-mono">{fmt(s.closingBalance)}</td>
              </tr>
            ))}
            {(sts.ok ? sts.result.length : 0) === 0 ? <tr><td className="p-3 text-slate-500">Aucun relevé.</td></tr> : null}
          </tbody>
        </table>
      </section>

      {canManage ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-semibold">Importer un relevé</h2>
          <form action={importStatementAction} className="grid gap-2">
            <select required name="journalId" className={INP}>
              <option value="">Journal de trésorerie…</option>
              {(jours.ok ? jours.result : []).filter((j) => j.defaultAccountId).map((j) => (
                <option key={j.id} value={j.id}>{j.code} — {j.label}</option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <input required name="periodStart" type="date" className={INP} />
              <input required name="periodEnd" type="date" className={INP} />
              <input required name="closingBalance" type="number" placeholder="Solde final" className={INP} />
            </div>
            <textarea required name="lines" rows={5} className={INP + " font-mono text-xs"}
              placeholder={"Une ligne par mouvement : YYYY-MM-DD;libellé;montant\n2025-10-05;Encaissement scolarité;50000\n2025-10-08;Fournitures;-12000"} />
            <button className={BTN} type="submit">Importer</button>
          </form>
        </section>
      ) : null}

      {rep?.ok ? (
        <section className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {rep.result.statement.journal.code} : {rep.result.matched}/{rep.result.statement.lines.length} pointées —
              écart relevé−livre : <span className={rep.result.ecart === 0 ? "text-green-700" : "text-red-600"}>{fmt(rep.result.ecart)}</span>
            </h2>
            {canManage ? (
              <form action={autoMatchAction}><input type="hidden" name="id" value={rep.result.statement.id} />
                <button className={BTN} type="submit">Pointage automatique (±3 j)</button>
              </form>
            ) : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold">Lignes du relevé</h3>
              <table className="w-full text-xs">
                <tbody>
                  {rep.result.statement.lines.map((l) => (
                    <tr key={l.id} className={`border-t ${l.matchedEntryLineId ? "text-green-700" : "text-red-600"}`}>
                      <td className="p-1">{l.date.toISOString().slice(0, 10)}</td>
                      <td className="p-1">{l.label}</td>
                      <td className="p-1 text-right font-mono">{fmt(l.amount)}</td>
                      <td className="p-1">{l.matchedEntryLineId ? "✓" : canManage ? (
                        <form action={unmatchAction}><input type="hidden" name="line" value={l.id} /></form>
                      ) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Écritures livre non pointées ({rep.result.unmatchedBook.length})</h3>
              <table className="w-full text-xs">
                <tbody>
                  {rep.result.unmatchedBook.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="p-1">{l.entry.date.toISOString().slice(0, 10)}</td>
                      <td className="p-1 font-mono">{l.entry.reference}</td>
                      <td className="p-1">{l.entry.description}</td>
                      <td className="p-1 text-right font-mono">{fmt(l.debit - l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
