import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { balanceSheet, incomeStatement } from "@/lib/services/accounting/statements";
import { listExercises } from "@/lib/services/accounting";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const fmt = (n: number) => n.toLocaleString("fr-FR");

function Sec({ s }: { s: { label: string; lines: { code: string; name: string; amount: number }[]; total: number } }) {
  return (
    <>
      <tr className="bg-slate-100 font-medium"><td className="p-2" colSpan={3}>{s.label}</td></tr>
      {s.lines.map((l) => (
        <tr key={s.label + l.code + l.name} className="border-t">
          <td className="p-2 font-mono text-xs">{l.code}</td><td>{l.name}</td>
          <td className="p-2 text-right font-mono">{fmt(l.amount)}</td>
        </tr>
      ))}
      <tr className="border-t font-semibold"><td className="p-2" colSpan={2}>Total {s.label}</td><td className="p-2 text-right font-mono">{fmt(s.total)}</td></tr>
    </>
  );
}

/** CG-3 : bilan + compte de résultat (mapping classes SYSCOHADA, à valider par le référent). */
export default async function EtatsPage(props: { searchParams: Promise<{ exercise?: string }> }) {
  const t = await requireSchoolPermission("accounting.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canExport = await userHasSchoolPermission({ ...ctx, permissionKey: "accounting.export" });
  const exs = await listExercises(ctx);
  const list = exs.ok ? exs.result : [];
  const ex = list.find((e) => e.id === sp.exercise) ?? list.find((e) => e.status === "OPEN") ?? list[0];
  const [bs, is] = ex
    ? await Promise.all([balanceSheet(ctx, ex.id), incomeStatement(ctx, ex.id)])
    : [{ ok: false as const, error: "NO_EXERCISE" }, { ok: false as const, error: "NO_EXERCISE" }];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">États financiers</h1>
        {canExport && ex ? (
          <div className="flex gap-2">
            <a className={BTN} href={`/app/comptabilite/export-etats?kind=bilan&format=csv&exercise=${ex.id}`}>Bilan CSV</a>
            <a className={BTN} href={`/app/comptabilite/export-etats?kind=resultat&format=csv&exercise=${ex.id}`}>Résultat CSV</a>
            <a className={BTN} href={`/app/comptabilite/export-etats?kind=all&format=pdf&exercise=${ex.id}`}>PDF</a>
          </div>
        ) : null}
      </div>
      <form method="get" className="flex gap-2">
        <select name="exercise" defaultValue={ex?.id ?? ""} className="rounded border px-2 py-1 text-sm">
          {list.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status})</option>)}
        </select>
        <button className={BTN} type="submit">Afficher</button>
      </form>
      {!ex ? <p className="text-sm text-slate-500">Aucun exercice comptable.</p> : null}
      {bs.ok ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border">
            <h2 className="border-b bg-slate-50 p-2 font-semibold">Actif — total {fmt(bs.result.totalActif)}</h2>
            <table className="w-full text-sm"><tbody>{bs.result.actif.map((s) => <Sec key={s.label} s={s} />)}</tbody></table>
          </section>
          <section className="rounded-lg border">
            <h2 className="border-b bg-slate-50 p-2 font-semibold">Passif — total {fmt(bs.result.totalPassif)}</h2>
            <table className="w-full text-sm"><tbody>{bs.result.passif.map((s) => <Sec key={s.label} s={s} />)}</tbody></table>
          </section>
        </div>
      ) : ex ? <p className="text-sm text-red-600">{bs.error}</p> : null}
      {is.ok ? (
        <section className="rounded-lg border">
          <h2 className="border-b bg-slate-50 p-2 font-semibold">
            Compte de résultat — {is.result.resultat >= 0 ? "bénéfice" : "perte"} {fmt(Math.abs(is.result.resultat))}
          </h2>
          <table className="w-full text-sm"><tbody><Sec s={is.result.charges} /><Sec s={is.result.produits} /></tbody></table>
        </section>
      ) : null}
    </div>
  );
}
