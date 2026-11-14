import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listAssets } from "@/lib/services/accounting/assets";
import { listAccounts } from "@/lib/services/accounting";
import { createAssetAction, runDepreciationAction, disposeAssetAction } from "../actions-immo";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const INP = "rounded border px-2 py-1 text-sm";
const fmt = (n: number) => n.toLocaleString("fr-FR");

/** CG-4 : immobilisations + dotations mensuelles. */
export default async function ImmoPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const t = await requireSchoolPermission("accounting.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canManage = await userHasSchoolPermission({ ...ctx, permissionKey: "accounting.manage" });
  const [assets, accs] = await Promise.all([listAssets(ctx), listAccounts(ctx)]);
  const list = assets.ok ? assets.result : [];
  const accOpts = (accs.ok ? accs.result : []).map((a) => (
    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
  ));

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Immobilisations</h1>
      {sp.err ? <p className="text-sm text-red-600">{sp.err}</p> : null}
      {sp.ok ? <p className="text-sm text-green-700">{sp.ok}</p> : null}

      <section className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr><th className="p-2">Libellé</th><th>Coût</th><th>Comptes</th><th>Durée</th><th className="text-right">Amorti</th><th className="text-right">Restant</th><th>Statut</th><th /></tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.label}<div className="text-xs text-slate-500">{a.acquisitionDate.toISOString().slice(0, 10)}</div></td>
                <td className="font-mono">{fmt(a.acquisitionCost)}</td>
                <td className="font-mono text-xs">{a.accountAsset.code} / {a.accountDepreciation.code}</td>
                <td>{a.durationMonths} mois</td>
                <td className="p-2 text-right font-mono">{fmt(a.amortized)}</td>
                <td className="p-2 text-right font-mono">{fmt(a.remaining)}</td>
                <td>{a.status}</td>
                <td className="p-1">
                  {canManage && a.status === "ACTIVE" ? (
                    <form action={disposeAssetAction}><input type="hidden" name="id" value={a.id} />
                      <button className="text-xs text-red-600 underline" name="status" value="SCRAPPED">Sortir</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {list.length === 0 ? <tr><td className="p-3 text-sm text-slate-500" colSpan={8}>Aucune immobilisation.</td></tr> : null}
          </tbody>
        </table>
      </section>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-semibold">Nouvelle immobilisation</h2>
            <form action={createAssetAction} className="grid gap-2">
              <input required name="label" placeholder="Libellé" className={INP} />
              <div className="grid grid-cols-3 gap-2">
                <input required name="acquisitionDate" type="date" className={INP} />
                <input required name="acquisitionCost" type="number" min="1" placeholder="Coût FCFA" className={INP} />
                <input required name="durationMonths" type="number" min="1" placeholder="Durée (mois)" className={INP} />
              </div>
              <select required name="accountAssetId" className={INP}><option value="">Compte immobilisation (2x)</option>{accOpts}</select>
              <select required name="accountDepreciationId" className={INP}><option value="">Compte amortissement (28x)</option>{accOpts}</select>
              <select required name="accountChargeId" className={INP}><option value="">Compte dotation (68x)</option>{accOpts}</select>
              <button className={BTN} type="submit">Enregistrer</button>
            </form>
          </section>
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-semibold">Passer les dotations du mois</h2>
            <form action={runDepreciationAction} className="flex gap-2">
              <input required name="month" type="month" className={INP} />
              <button className={BTN} type="submit">Générer (D68x / C28x)</button>
            </form>
            <p className="mt-2 text-xs text-slate-500">Idempotent : un rejeu du même mois ne crée aucun doublon.</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
