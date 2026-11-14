import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listComponents, listRuns, getRun } from "@/lib/services/hr/payroll";
import { upsertComponentAction, createRunAction, computeRunAction, validateRunAction, cancelRunAction } from "./actions-paie";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const INP = "rounded border px-2 py-1 text-sm";
const fmt = (n: number) => n.toLocaleString("fr-FR");

/** RH-3 : moteur de paie — composants, campagnes, bulletins. */
export default async function PaiePage(props: { searchParams: Promise<{ run?: string; ok?: string; err?: string }> }) {
  const t = await requireSchoolPermission("payroll.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canManage = await userHasSchoolPermission({ ...ctx, permissionKey: "payroll.manage" });
  const [comps, runs] = await Promise.all([listComponents(ctx), listRuns(ctx)]);
  const run = sp.run ? await getRun(ctx, sp.run) : null;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Paie</h1>
      {sp.err ? <p className="text-sm text-red-600">{sp.err}</p> : null}
      {sp.ok ? <p className="text-sm text-green-700">{sp.ok}</p> : null}
      <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
        Paramètres réglementaires BF (CNSS, fiscalité) : aucun taux n&apos;est activé — les composants marqués
        « réglementaire » sont ignorés du calcul jusqu&apos;à validation des sources officielles.
      </p>

      <section className="rounded-lg border">
        <h2 className="border-b bg-slate-50 p-2 font-semibold">Composants de salaire</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-2">Code</th><th>Libellé</th><th>Type</th><th>Ordre</th><th>Formule</th><th>v</th><th>Actif</th></tr></thead>
          <tbody>
            {(comps.ok ? comps.result : []).filter((c) => c.enabled).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2 font-mono text-xs">{c.code}</td>
                <td>{c.label}{c.isRegulatory ? <span className="ml-1 text-xs text-amber-700">(réglementaire — inactif)</span> : null}</td>
                <td>{c.kind}</td><td>{c.order}</td>
                <td className="font-mono text-xs">{JSON.stringify(c.formula)}</td>
                <td>v{c.version}</td><td>{c.enabled ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canManage ? (
          <form action={upsertComponentAction} className="grid gap-2 border-t p-3 sm:grid-cols-6">
            <input required name="code" placeholder="Code" className={INP} />
            <input required name="label" placeholder="Libellé" className={INP} />
            <select name="kind" className={INP}><option>EARNING</option><option>DEDUCTION</option><option>EMPLOYER_CHARGE</option></select>
            <input name="order" type="number" defaultValue="0" className={INP} />
            <input required name="formula" placeholder='{"type":"percent","rate":0.05,"base":"gross"}' className={INP + " font-mono text-xs"} />
            <button className={BTN} type="submit">+ Composant</button>
          </form>
        ) : null}
      </section>

      <section className="rounded-lg border">
        <h2 className="border-b bg-slate-50 p-2 font-semibold">Campagnes de paie</h2>
        <table className="w-full text-sm"><tbody>
          {(runs.ok ? runs.result : []).map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2"><a className="underline" href={`/app/rh/paie?run=${r.id}`}>{r.periodStart.toISOString().slice(0, 7)}</a></td>
              <td>{r.periodStart.toISOString().slice(0, 10)} → {r.periodEnd.toISOString().slice(0, 10)}</td>
              <td>{r.status}</td><td>{r._count.payslips} bulletin(s)</td>
              <td className="space-x-2 text-right">
                {canManage && r.status === "DRAFT" ? (
                  <>
                    <form action={computeRunAction} className="inline"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-blue-700 underline">Calculer</button></form>
                    <form action={validateRunAction} className="inline"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-green-700 underline">Valider</button></form>
                    <form action={cancelRunAction} className="inline"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-red-700 underline">Annuler</button></form>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
          {(runs.ok ? runs.result.length : 0) === 0 ? <tr><td className="p-3 text-slate-500">Aucune campagne.</td></tr> : null}
        </tbody></table>
        {canManage ? (
          <form action={createRunAction} className="flex gap-2 border-t p-3">
            <input required name="periodStart" type="date" className={INP} />
            <input required name="periodEnd" type="date" className={INP} />
            <button className={BTN} type="submit">+ Campagne</button>
          </form>
        ) : null}
      </section>

      {run?.ok ? (
        <section className="rounded-lg border">
          <h2 className="border-b bg-slate-50 p-2 font-semibold">
            Bulletins — {run.result.periodStart.toISOString().slice(0, 7)} ({run.result.status})
          </h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left"><tr><th className="p-2">Matricule</th><th>Employé</th><th className="text-right">Base</th><th className="text-right">Brut</th><th className="text-right">Retenues</th><th className="text-right">Net</th><th className="text-right">Coût patronal</th></tr></thead>
            <tbody>
              {run.result.payslips.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{p.employee.matricule}</td>
                  <td>{p.employee.lastName} {p.employee.firstName}</td>
                  <td className="p-2 text-right font-mono">{fmt(p.baseSalary)}</td>
                  <td className="p-2 text-right font-mono">{fmt(p.gross)}</td>
                  <td className="p-2 text-right font-mono">{fmt(p.deductions)}</td>
                  <td className="p-2 text-right font-mono font-semibold">{fmt(p.net)}</td>
                  <td className="p-2 text-right font-mono">{fmt(p.employerCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
