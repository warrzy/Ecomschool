import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listComponents, listRuns, getRun, getPayrollConfig, getPayslip, listAdvances } from "@/lib/services/hr/payroll";
import { listEmployees } from "@/lib/services/hr/employees";
import { upsertComponentAction, createRunAction, computeRunAction, validateRunAction, cancelRunAction, postPayrollAction, rectifyRunAction, setAdvanceCapAction, setAttendanceConfigAction, grantAdvanceAction, cancelAdvanceAction } from "./actions-paie";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const INP = "rounded border px-2 py-1 text-sm";
const fmt = (n: number) => n.toLocaleString("fr-FR");

/** RH-3 : moteur de paie — composants, campagnes, bulletins. */
export default async function PaiePage(props: { searchParams: Promise<{ run?: string; slip?: string; ok?: string; err?: string }> }) {
  const t = await requireSchoolPermission("payroll.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canManage = await userHasSchoolPermission({ ...ctx, permissionKey: "payroll.manage" });
  const [comps, runs] = await Promise.all([listComponents(ctx), listRuns(ctx)]);
  const cfg = canManage ? await getPayrollConfig(ctx) : null;
  const capPct = cfg?.ok ? cfg.result.advanceCapBp / 100 : 30;
  const run = sp.run ? await getRun(ctx, sp.run) : null;
  const slip = sp.slip ? await getPayslip(ctx, sp.slip) : null;
  // M9 : avances — liste + octroi + annulation (payroll.read suffit pour
  // la consultation ; employees pour le formulaire d'octroi).
  const [advances, employees] = await Promise.all([
    listAdvances(ctx),
    canManage ? listEmployees(ctx, { status: "ACTIVE" }) : Promise.resolve(null),
  ]);

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

      {canManage ? (
        <section className="rounded-lg border p-3">
          <h2 className="mb-1 font-semibold">Plafond de recouvrement des avances</h2>
          <p className="mb-2 text-xs text-slate-500">{"Valeur indicative configurable par l'établissement — non présentée comme une obligation réglementaire validée."}</p>
          <form action={setAdvanceCapAction} className="flex items-center gap-2">
            <input required name="capPercent" type="number" min="0" max="100" step="0.5" defaultValue={capPct} className={INP + " w-24"} />
            <span className="text-sm">% du net</span>
            <button className={BTN} type="submit">Enregistrer</button>
          </form>
        </section>
      ) : null}

      {canManage && cfg?.ok ? (
        <section className="rounded-lg border p-3">
          <h2 className="mb-1 font-semibold">Assiduité et paie</h2>
          <p className="mb-2 text-xs text-slate-500">{"Proratisation des jours non travaillés — valeurs indicatives configurées par l'établissement, aucune règle légale présumée."}</p>
          <form action={setAttendanceConfigAction} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">Base mensuelle
              <input required name="workdays" type="number" min="1" max="31" defaultValue={cfg.result.workdaysPerMonth} className={INP + " w-20"} /> j
            </label>
            <label className="flex items-center gap-1">
              <input type="hidden" name="prorateUnpaidLeave" value="0" />
              <input type="checkbox" name="prorateUnpaidLeave" value="1" defaultChecked={cfg.result.prorateUnpaidLeave} />
              Congés sans solde (UNPAID) non payés
            </label>
            <label className="flex items-center gap-1">
              <input type="hidden" name="prorateAbsences" value="0" />
              <input type="checkbox" name="prorateAbsences" value="1" defaultChecked={cfg.result.prorateAbsences} />
              Absences pointées déduites
            </label>
            <button className={BTN} type="submit">Enregistrer</button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border">
        <h2 className="border-b bg-slate-50 p-2 font-semibold">Campagnes de paie</h2>
        <table className="w-full text-sm"><tbody>
          {(runs.ok ? runs.result : []).map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2"><a className="underline" href={`/app/rh/paie?run=${r.id}`}>{r.periodStart.toISOString().slice(0, 7)}</a></td>
              <td>{r.periodStart.toISOString().slice(0, 10)} → {r.periodEnd.toISOString().slice(0, 10)}</td>
              <td>{r.status}</td><td>{r._count.payslips} bulletin(s)</td>
              <td className="space-x-2 text-right">
                {canManage && r.status === "VALIDATED" ? (
                  <form action={postPayrollAction} className="inline"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-purple-700 underline">Comptabiliser</button></form>
                ) : null}
                {canManage && (r.status === "VALIDATED" || r.status === "POSTED") ? (
                  <form action={rectifyRunAction} className="inline"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-orange-700 underline">Rectifier</button></form>
                ) : null}
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
            <thead className="bg-slate-50 text-left"><tr><th className="p-2">Matricule</th><th>Employé</th><th className="text-right">Base</th><th className="text-right">Brut</th><th className="text-right">Retenues</th><th className="text-right">Net</th><th className="text-right">Coût patronal</th><th /></tr></thead>
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
                  <td className="p-2 text-right"><a className="text-xs text-blue-700 underline" href={`/app/rh/paie?run=${run.result.id}&slip=${p.id}`}>Bulletin</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {slip?.ok ? (
        <section className="rounded-lg border">
          <h2 className="border-b bg-slate-50 p-2 font-semibold">
            Bulletin — {slip.result.employee.lastName} {slip.result.employee.firstName} ({slip.result.employee.matricule}) — {slip.result.run.periodStart.toISOString().slice(0, 7)} [{slip.result.run.status}]
          </h2>
          <div className="p-3 text-sm">
            <p className="mb-2 text-xs text-slate-500">
              {slip.result.daysWorked != null
                ? `Jours travaillés : ${slip.result.daysWorked}${slip.result.unpaidDays ? ` — jours non payés : ${slip.result.unpaidDays}` : ""}`
                : "Assiduité non proratisée"}
            </p>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left"><tr><th className="p-2">Code</th><th>Libellé</th><th>Type</th><th className="text-right">Montant</th></tr></thead>
              <tbody>
                <tr className="border-t"><td className="p-2 font-mono text-xs">BASE</td><td>Salaire de base</td><td>EARNING</td><td className="p-2 text-right font-mono">{fmt(slip.result.baseSalary)}</td></tr>
                {(slip.result.lines as { code: string; label: string; kind: string; amount: number }[]).map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono text-xs">{l.code}</td><td>{l.label}</td><td>{l.kind}</td>
                    <td className="p-2 text-right font-mono">{fmt(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t font-semibold"><td className="p-2" colSpan={3}>Brut</td><td className="p-2 text-right font-mono">{fmt(slip.result.gross)}</td></tr>
                <tr className="border-t"><td className="p-2" colSpan={3}>Retenues</td><td className="p-2 text-right font-mono">{fmt(slip.result.deductions)}</td></tr>
                <tr className="border-t font-semibold"><td className="p-2" colSpan={3}>Net à payer</td><td className="p-2 text-right font-mono">{fmt(slip.result.net)}</td></tr>
                <tr className="border-t text-slate-500"><td className="p-2" colSpan={3}>Coût patronal</td><td className="p-2 text-right font-mono">{fmt(slip.result.employerCost)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section id="avances" className="rounded-lg border">
        <h2 className="border-b bg-slate-50 p-2 font-semibold">Avances sur salaire</h2>
        {canManage && employees?.ok ? (
          <form action={grantAdvanceAction} className="flex flex-wrap items-center gap-2 border-b p-2 text-sm">
            <select required name="employeeId" className={INP}>
              <option value="">Employé…</option>
              {employees.result.map((e) => (
                <option key={e.id} value={e.id}>{e.lastName} {e.firstName} ({e.matricule})</option>
              ))}
            </select>
            <input required name="amount" type="number" min="1" step="1" placeholder="Montant" className={INP + " w-28"} />
            <input required name="date" type="date" className={INP} />
            <input name="reason" placeholder="Motif (optionnel)" className={INP} />
            <button className={BTN} type="submit">Accorder</button>
          </form>
        ) : null}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-2">Employé</th><th>Date</th><th className="text-right">Montant</th><th className="text-right">Restant</th><th>Statut</th><th>Motif</th><th /></tr></thead>
          <tbody>
            {(advances.ok ? advances.result : []).map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.employee.lastName} {a.employee.firstName}</td>
                <td>{a.date.toISOString().slice(0, 10)}</td>
                <td className="p-2 text-right font-mono">{fmt(a.amount)}</td>
                <td className="p-2 text-right font-mono">{fmt(a.remaining)}</td>
                <td>{a.status}</td>
                <td className="text-xs text-slate-500">{a.reason ?? "—"}</td>
                <td className="p-2 text-right">
                  {canManage && a.recoveries.length === 0 && a.status !== "CANCELLED" ? (
                    <form action={cancelAdvanceAction} className="inline">
                      <input type="hidden" name="id" value={a.id} />
                      <button className="text-xs text-red-700 underline" type="submit">Annuler</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
