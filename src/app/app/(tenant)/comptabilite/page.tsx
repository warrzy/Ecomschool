import { requireSchoolPermission } from "@/lib/permissions/guard";
import { KpiCard } from "@/components/ui/dash";
import {
  listAccounts, listJournals, listMappings, listExercises,
  listEntries, listUnposted, trialBalance,
} from "@/lib/services/accounting";
import {
  installPlanAction, upsertAccountAction, upsertMappingAction,
  openExerciseAction, closeExerciseAction, generateAction, manualEntryAction,
  carryForwardAction, migrateAccrualAction,
} from "./actions";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);

const INPUT =
  "rounded border border-slate-300 px-2 py-1 text-sm";
const BTN =
  "rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700";

export default async function ComptabilitePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await requireSchoolPermission("accounting.read");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const sp = (await props.searchParams) ?? {};
  const exId = typeof sp.exercise === "string" ? sp.exercise : undefined;
  const can = (k: string) =>
    import("@/lib/permissions/rbac").then((m) =>
      m.userHasSchoolPermission({ userId: t.userId, schoolId: t.schoolId, permissionKey: k }));
  const [manage, canExport] = await Promise.all([can("accounting.manage"), can("accounting.export")]);

  const [accs, jours, maps, exs, unposted] = await Promise.all([
    listAccounts(ctx), listJournals(ctx), listMappings(ctx),
    listExercises(ctx), listUnposted(ctx),
  ]);
  const currentEx = !exs.ok
    ? null
    : exs.result.find((e) => e.id === exId)
      ?? exs.result.find((e) => e.status === "OPEN")
      ?? exs.result[0]
      ?? null;
  const [entries, tb] = currentEx
    ? await Promise.all([
        listEntries(ctx, { exerciseId: currentEx.id }),
        trialBalance(ctx, currentEx.id),
      ])
    : [null, null];
  const pending =
    unposted.ok ? unposted.result.payments + unposted.result.expenses + unposted.result.refunds : 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold">Comptabilité</h1>
        <p className="text-sm text-slate-500">
          Plan comptable configurable (SYSCOHADA), journaux, écritures générées
          depuis les opérations réelles et exports.
        </p>
      </header>

      {/* Synthèse */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Comptes" value={accs.ok ? String(accs.result.length) : "—"} />
        <KpiCard label="Journaux" value={jours.ok ? String(jours.result.length) : "—"} />
        <KpiCard label="Écritures" value={entries?.ok ? String(entries.result.length) : "—"} />
        <KpiCard label="À comptabiliser" value={String(pending)} tone={pending > 0 ? "coral" : "leaf"} />
      </section>

      {manage && accs.ok && accs.result.length === 0 ? (
        <form action={installPlanAction} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm">
            Aucun plan comptable. Installer le plan SYSCOHADA de démarrage
            (modifiable ensuite — aucun référentiel imposé).
          </p>
          <button type="submit" className={BTN}>Installer le plan SYSCOHADA</button>
        </form>
      ) : null}

      {/* Exercices */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Exercices comptables</h2>
        {exs.ok && exs.result.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1">Exercice</th><th>Période</th><th>Statut</th><th></th>
              </tr>
            </thead>
            <tbody>
              {exs.result.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-1.5">
                    <a href={`/app/comptabilite?exercise=${e.id}`} className="text-blue-700 hover:underline">{e.name}</a>
                  </td>
                  <td>{dstr(e.startDate)} → {dstr(e.endDate)}</td>
                  <td>{e.status === "OPEN" ? "Ouvert" : "Clôturé"}<span className="ml-1 text-xs text-slate-400">{e.mode}</span></td>
                  <td className="space-x-3 text-right">
                    {manage && e.status === "OPEN" && e.mode === "CASH" ? (
                      <form action={migrateAccrualAction} className="inline">
                        <input type="hidden" name="exerciseId" value={e.id} />
                        <button type="submit" className="text-xs text-amber-700 hover:underline">Bascule engagement</button>
                      </form>
                    ) : null}
                    {manage && e.status === "CLOSED" ? (
                      <form action={carryForwardAction} className="inline">
                        <input type="hidden" name="exerciseId" value={e.id} />
                        <input type="hidden" name="name" value={`${e.name}+1`} />
                        <input type="hidden" name="startDate" value={new Date(+e.endDate + 86400000).toISOString().slice(0, 10)} />
                        <input type="hidden" name="endDate" value={new Date(+e.endDate + 31536000000).toISOString().slice(0, 10)} />
                        <button type="submit" className="text-xs text-blue-700 hover:underline">À-nouveaux →</button>
                      </form>
                    ) : null}
                    {manage && e.status === "OPEN" ? (
                      <form action={closeExerciseAction} className="inline">
                        <input type="hidden" name="exerciseId" value={e.id} />
                        <button type="submit" className="text-xs text-red-700 hover:underline">Clôturer</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-slate-500">Aucun exercice.</p>}
        {manage ? (
          <form action={openExerciseAction} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs">Nom<input name="name" required className={`${INPUT} ml-1 block w-40`} placeholder="Exercice 2027" /></label>
            <label className="text-xs">Début<input name="startDate" type="date" required className={`${INPUT} ml-1 block`} /></label>
            <label className="text-xs">Fin<input name="endDate" type="date" required className={`${INPUT} ml-1 block`} /></label>
            <button type="submit" className={BTN}>Ouvrir</button>
          </form>
        ) : null}
      </section>

      {/* Génération */}
      {manage ? (
        <form action={generateAction} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-sm">
            Générer les écritures des opérations réelles non comptabilisées
            (encaissements validés, annulations, remboursements confirmés,
            dépenses payées). Idempotent — aucun doublon.
          </p>
          <button type="submit" className={BTN}>Générer les écritures</button>
        </form>
      ) : null}

      {/* Plan comptable + correspondances */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Plan comptable</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1">Code</th><th>Intitulé</th><th>Classe</th></tr></thead>
            <tbody>
              {(accs.ok ? accs.result : []).map((a) => (
                <tr key={a.id} className="border-t"><td className="py-1 font-mono">{a.code}</td><td>{a.name}</td><td>{a.classNumber}</td></tr>
              ))}
            </tbody>
          </table>
          {manage ? (
            <form action={upsertAccountAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input name="code" placeholder="Code" required className={`${INPUT} w-20`} />
              <input name="name" placeholder="Intitulé" required className={`${INPUT} w-48`} />
              <input name="classNumber" placeholder="Classe" type="number" min={1} max={9} required className={`${INPUT} w-16`} />
              <button type="submit" className={BTN}>Ajouter</button>
            </form>
          ) : null}
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Correspondances métier → comptes</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1">Clé</th><th>Compte</th></tr></thead>
            <tbody>
              {(maps.ok ? maps.result : []).map((m) => (
                <tr key={m.id} className="border-t"><td className="py-1 font-mono text-xs">{m.key}</td><td>{m.account.code} — {m.account.name}</td></tr>
              ))}
            </tbody>
          </table>
          {manage && accs.ok ? (
            <form action={upsertMappingAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input name="key" placeholder="CAT:… / METHOD:… / EXPCAT:… / FALLBACK:…" required className={`${INPUT} w-64`} />
              <select name="accountId" required className={INPUT}>
                <option value="">Compte…</option>
                {accs.result.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
              <select name="journalId" className={INPUT}>
                <option value="">Journal…</option>
                {(jours.ok ? jours.result : []).map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}
              </select>
              <button type="submit" className={BTN}>Mapper</button>
            </form>
          ) : null}
        </div>
      </section>

      {/* Balance */}
      {tb?.ok && tb.result.balance.length > 0 ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Balance — {currentEx!.name}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1">Compte</th><th>Intitulé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th></tr></thead>
              <tbody>
                {tb.result.balance.map((r) => (
                  <tr key={r.code} className="border-t">
                    <td className="py-1 font-mono">{r.code}</td><td>{r.name}</td>
                    <td className="text-right">{fmt(r.debit)}</td>
                    <td className="text-right">{fmt(r.credit)}</td>
                    <td className={`text-right font-medium ${r.debit - r.credit < 0 ? "text-red-700" : ""}`}>{fmt(r.debit - r.credit)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td colSpan={2}>Totaux</td>
                  <td className="text-right">{fmt(tb.result.totalDebit)}</td>
                  <td className="text-right">{fmt(tb.result.totalCredit)}</td>
                  <td className="text-right">{fmt(tb.result.totalDebit - tb.result.totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Écritures */}
      {entries?.ok && entries.result.length > 0 ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Écritures — {currentEx!.name}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1">Réf.</th><th>Date</th><th>Journal</th><th>Description</th><th>Statut</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead>
              <tbody>
                {entries.result.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="py-1 font-mono text-xs">{e.reference}</td>
                    <td className="whitespace-nowrap">{dstr(e.date)}</td>
                    <td>{e.journal.code}</td>
                    <td>
                      {e.description}
                      {e.origin === "SIMULATION" ? <span className="ml-1 rounded bg-amber-100 px-1 text-xs">SIMULATION</span> : null}
                      <div className="mt-0.5 text-xs text-slate-500">
                        {e.lines.map((l) => (
                          <div key={l.id}>{l.account.code} — {l.account.name} : {l.debit ? `D ${fmt(l.debit)}` : `C ${fmt(l.credit)}`}</div>
                        ))}
                      </div>
                    </td>
                    <td>{e.status === "POSTED" ? "Comptabilisée" : "Incomplète"}</td>
                    <td className="text-right">{fmt(e.lines.reduce((s, l) => s + l.debit, 0))}</td>
                    <td className="text-right">{fmt(e.lines.reduce((s, l) => s + l.credit, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Exports */}
      {canExport && currentEx ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Exports CSV — {currentEx.name}</h2>
          <div className="flex flex-wrap gap-2">
            <a className={BTN} href={`/app/comptabilite/export?kind=journal&exercise=${currentEx.id}`}>Journal complet</a>
            {(jours.ok ? jours.result : []).map((j) => (
              <a key={j.id} className={BTN} href={`/app/comptabilite/export?kind=journal&exercise=${currentEx.id}&journal=${j.id}`}>Journal {j.code}</a>
            ))}
            <a className={BTN} href={`/app/comptabilite/export?kind=balance&exercise=${currentEx.id}`}>Balance</a>
            <form action="/app/comptabilite/export" method="get" className="flex items-center gap-2">
              <input type="hidden" name="kind" value="ledger" />
              <input type="hidden" name="exercise" value={currentEx.id} />
              <select name="account" required className="rounded border px-2 py-1 text-sm">
                <option value="">Grand livre — choisir un compte…</option>
                {(accs.ok ? accs.result : []).map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              <button className={BTN} type="submit">Exporter</button>
            </form>
          </div>
        </section>
      ) : null}

      {manage && currentEx ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Écriture manuelle (OD) — {currentEx.name}</h2>
          <form action={manualEntryAction} className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <select name="journalId" required className="rounded border px-2 py-1">
                {(jours.ok ? jours.result : []).map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.label}</option>
                ))}
              </select>
              <input type="hidden" name="exerciseId" value={currentEx.id} />
              <input name="date" type="date" required className="rounded border px-2 py-1" />
              <input name="description" required placeholder="Motif" className="min-w-48 flex-1 rounded border px-2 py-1" />
            </div>
            <textarea
              name="lines" required rows={3}
              placeholder='[{"accountId":"<id>","debit":10000},{"accountId":"<id>","credit":10000}] — débit = crédit requis'
              className="w-full rounded border px-2 py-1 font-mono text-xs"
            />
            <button className={BTN} type="submit">Poster l&rsquo;écriture</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
