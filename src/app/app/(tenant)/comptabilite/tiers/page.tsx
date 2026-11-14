import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listThirdParties, studentAging } from "@/lib/services/accounting/thirdparty";
import { listAccounts } from "@/lib/services/accounting";
import { upsertThirdPartyAction } from "../actions-tiers";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const KINDS = ["STUDENT", "SUPPLIER", "STAFF", "OTHER"] as const;

/** CG-2 : référentiel tiers + balance âgée des créances élèves. */
export default async function TiersPage(props: {
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  const t = await requireSchoolPermission("accounting.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canManage = await userHasSchoolPermission({ ...ctx, permissionKey: "accounting.manage" });
  const canExport = await userHasSchoolPermission({ ...ctx, permissionKey: "accounting.export" });
  const [tps, aging, accs] = await Promise.all([
    listThirdParties(ctx, { kind: sp.kind, q: sp.q }),
    studentAging(ctx),
    listAccounts(ctx),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tiers auxiliaires</h1>
        {canExport ? <a className={BTN} href="/app/comptabilite/export-tiers">Export balance âgée (CSV)</a> : null}
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <select name="kind" defaultValue={sp.kind ?? ""} className="rounded border px-2 py-1 text-sm">
          <option value="">Tous les types</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher…" className="rounded border px-2 py-1 text-sm" />
        <button className={BTN} type="submit">Filtrer</button>
      </form>

      <section className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr><th className="p-2">Nom</th><th>Type</th><th>Compte collectif</th><th className="text-right">Solde</th></tr>
          </thead>
          <tbody>
            {(tps.ok ? tps.result : []).map((x) => (
              <tr key={x.id} className="border-t">
                <td className="p-2">{x.name}</td><td>{x.kind}</td>
                <td>{x.collectiveAccount.code}</td>
                <td className="text-right font-mono">{x.balance.toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-lg border">
        <h2 className="bg-slate-50 p-2 font-medium">Balance âgée des créances élèves</h2>
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr><th className="p-2">Élève</th><th className="text-right">Non échu</th><th className="text-right">1-30 j</th><th className="text-right">31-60 j</th><th className="text-right">61-90 j</th><th className="text-right">+90 j</th></tr>
          </thead>
          <tbody>
            {(aging.ok ? aging.result : []).map((x) => (
              <tr key={x.studentId} className="border-t">
                <td className="p-2">{x.tiers ?? x.studentId}</td>
                {[x.current, x.d1_30, x.d31_60, x.d61_90, x.d90p].map((v, i) => (
                  <td key={i} className="text-right font-mono">{v.toLocaleString("fr-FR")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canManage && accs.ok ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Nouveau tiers (fournisseur / partenaire)</h2>
          <form action={upsertThirdPartyAction} className="flex flex-wrap gap-2 text-sm">
            <select name="kind" className="rounded border px-2 py-1">
              {(["SUPPLIER", "STAFF", "OTHER"] as const).map((k) => <option key={k}>{k}</option>)}
            </select>
            <input name="name" required placeholder="Nom" className="rounded border px-2 py-1" />
            <input name="refId" placeholder="Référence (optionnel)" className="rounded border px-2 py-1" />
            <select name="collectiveAccountId" required className="rounded border px-2 py-1">
              <option value="">Compte collectif…</option>
              {accs.result.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
            <button className={BTN} type="submit">Enregistrer</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
