import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { listPolicies } from "@/lib/services/grading/policy";
import { upsertPolicyAction } from "@/app/app/(tenant)/grading-policy/actions";

export const instant = false;

export default async function GradingPolicyPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const [policies, years, levels] = await Promise.all([
    listPolicies(c),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true },
    }),
    prisma.level.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const inputCls =
    "rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Configuration</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Règles de notation
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Une politique par année scolaire, éventuellement spécifique à un niveau.
          Toute modification crée une nouvelle version — les bulletins publiés
          conservent leur snapshot et ne sont jamais altérés rétroactivement.
        </p>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Règles enregistrées.
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">Nouvelle politique / mise à jour</div>
        <form action={upsertPolicyAction} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <select name="academicYearId" required className={inputCls}>
            <option value="">Année scolaire…</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? " (courante)" : ""}</option>
            ))}
          </select>
          <select name="levelId" className={inputCls}>
            <option value="">Tous niveaux (défaut)</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <input name="maxScore" type="number" step="0.5" defaultValue="20" placeholder="Barème (max)" className={inputCls} />
          <input name="minScore" type="number" step="0.5" defaultValue="0" placeholder="Note min" className={inputCls} />
          <input name="precision" type="number" min="0" max="4" defaultValue="2" placeholder="Décimales" className={inputCls} />
          <select name="rounding" defaultValue="HALF_UP" className={inputCls}>
            <option value="HALF_UP">Arrondi demi-sup.</option>
            <option value="FLOOR">Arrondi inf.</option>
            <option value="CEIL">Arrondi sup.</option>
          </select>
          <input name="passMark" type="number" step="0.5" defaultValue="10" placeholder="Seuil de réussite" className={inputCls} />
          <select name="missingGradePolicy" defaultValue="EXCLUDE" className={inputCls}>
            <option value="EXCLUDE">Note manquante : exclue</option>
            <option value="ZERO">Note manquante : zéro</option>
          </select>
          <select name="absentPolicy" defaultValue="EXCLUDE" className={inputCls}>
            <option value="EXCLUDE">Absence : exclue</option>
            <option value="ZERO">Absence : zéro</option>
          </select>
          <select name="exemptPolicy" defaultValue="EXCLUDE" className={inputCls}>
            <option value="EXCLUDE">Dispense : exclue</option>
            <option value="ZERO">Dispense : zéro</option>
          </select>
          <select name="tieRule" defaultValue="SHARED_RANK" className={inputCls}>
            <option value="SHARED_RANK">Ex æquo : rang partagé</option>
            <option value="DENSE_RANK">Ex æquo : rang dense</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="perSubjectRank" defaultChecked /> Rang par matière
          </label>
          <input
            name="mentions"
            placeholder="Mentions : Excellent:16;Très bien:14;Bien:12"
            className={`${inputCls} col-span-2`}
          />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            Enregistrer
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2 pr-3">Année</th>
              <th className="py-2 pr-3">Niveau</th>
              <th className="py-2 pr-3">Barème</th>
              <th className="py-2 pr-3">Seuil</th>
              <th className="py-2 pr-3">Manquantes</th>
              <th className="py-2 pr-3">Absences</th>
              <th className="py-2 pr-3">Ex æquo</th>
              <th className="py-2">Version</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100">
                <td className="py-2 pr-3">{p.academicYear.name}</td>
                <td className="py-2 pr-3">{p.level?.name ?? "Tous"}</td>
                <td className="py-2 pr-3">/{p.maxScore}</td>
                <td className="py-2 pr-3">{p.passMark}</td>
                <td className="py-2 pr-3">{p.missingGradePolicy === "ZERO" ? "Zéro" : "Exclues"}</td>
                <td className="py-2 pr-3">{p.absentPolicy === "ZERO" ? "Zéro" : "Exclues"}</td>
                <td className="py-2 pr-3">{p.tieRule === "DENSE_RANK" ? "Dense" : "Partagé"}</td>
                <td className="py-2">v{p.version}</td>
              </tr>
            ))}
            {policies.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-zinc-500">
                  Aucune politique — les règles par défaut (barème /20, seuil 10) s&apos;appliquent.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
