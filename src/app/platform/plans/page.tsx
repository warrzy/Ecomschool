import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { userHasPlatformPermission } from "@/lib/permissions/rbac";
import { listPlans } from "@/lib/services/platform/plans";
import { listModules } from "@/lib/services/platform/modules";
import { createPlanAction, updatePlanAction } from "@/app/platform/actions";
import { errorMessage } from "@/lib/ui/errorLabels";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export default async function PlansPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requirePlatformPermission("platform.plans.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const canManage = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.plans.manage",
  });

  const [plans, modules] = await Promise.all([listPlans(true), listModules()]);
  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/platform" className="hover:underline">Plateforme</Link> / Offres
        </div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Offres commerciales ({plans.length})
        </h1>
        {ok ? <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Offre enregistrée.</div> : null}
        {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error === "DUPLICATE" ? "Code déjà utilisé." : errorMessage(error)}</div> : null}
      </div>

      {canManage ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Nouvelle offre</div>
          <form action={createPlanAction} className="flex flex-wrap items-end gap-2">
            <input aria-label="Code" name="code" placeholder="Code" required className={input} />
            <input aria-label="Nom" name="name" placeholder="Nom" required className={input} />
            <input aria-label="Description" name="description" placeholder="Description" className={input} />
            <input aria-label="Prix mensuel (XOF)" name="monthlyPrice" type="number" min="0" placeholder="Prix mensuel FCFA" required className={input} />
            <input aria-label="Prix annuel (XOF)" name="yearlyPrice" type="number" min="0" placeholder="Prix annuel FCFA" required className={input} />
            <input aria-label="Nombre maximum d'élèves" name="maxStudents" type="number" min="0" placeholder="Max élèves" className={input} />
            <input aria-label="Nombre maximum d'utilisateurs" name="maxUsers" type="number" min="0" placeholder="Max utilisateurs" className={input} />
            <input aria-label="Jours d'essai" name="trialDays" type="number" min="0" placeholder="Essai (j)" className={input} />
            <input name="graceDays" type="number" min="0" defaultValue="7" title="Grâce (j)" className={input} />
            <select
                  aria-label="Modules inclus" name="moduleCodes" multiple size={4} className={input} title="Modules inclus">
              {modules.map((m) => (
                <option key={m.code} value={m.code}>{m.name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Créer
            </button>
          </form>
          <p className="mt-2 text-xs text-zinc-500">Maintient Ctrl/Cmd pour sélectionner plusieurs modules.</p>
        </div>
      ) : null}

      {plans.map((p) => (
        <div key={p.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-zinc-900">
                {p.name} <span className="font-mono text-xs text-zinc-500">{p.code}</span>
              </div>
              <div className="text-sm text-zinc-500">{p.description}</div>
            </div>
            <div className="text-right text-sm">
              <div className="font-medium">{fmt(p.monthlyPrice)}/mois · {fmt(p.yearlyPrice)}/an</div>
              <div className="text-xs text-zinc-500">
                essai {p.trialDays} j · grâce {p.graceDays} j ·{" "}
                {p.maxStudents != null ? `≤ ${p.maxStudents} élèves` : "élèves illimités"} ·{" "}
                {p.maxUsers != null ? `≤ ${p.maxUsers} users` : "users illimités"} ·{" "}
                {p.status === "ACTIVE" ? "active" : "archivée"}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {p.modules.map((m) => (
              <span key={m.id} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                {m.module.name}
              </span>
            ))}
          </div>
          {canManage ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-600 hover:underline">Modifier</summary>
              <form action={updatePlanAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input aria-label="Nom" name="name" defaultValue={p.name} className={input} />
                <input aria-label="Prix mensuel (XOF)" name="monthlyPrice" type="number" min="0" defaultValue={p.monthlyPrice} className={input} />
                <input aria-label="Prix annuel (XOF)" name="yearlyPrice" type="number" min="0" defaultValue={p.yearlyPrice} className={input} />
                <input aria-label="Nombre maximum d'élèves" name="maxStudents" type="number" min="0" defaultValue={p.maxStudents ?? ""} className={input} />
                <input aria-label="Nombre maximum d'utilisateurs" name="maxUsers" type="number" min="0" defaultValue={p.maxUsers ?? ""} className={input} />
                <input aria-label="Jours d'essai" name="trialDays" type="number" min="0" defaultValue={p.trialDays} className={input} />
                <input aria-label="Jours de grâce" name="graceDays" type="number" min="0" defaultValue={p.graceDays} className={input} />
                <select
                  aria-label="Modules inclus"
                  name="moduleCodes"
                  multiple
                  size={4}
                  className={input}
                  defaultValue={p.modules.map((pm) => pm.module.code)}
                >
                  {modules.map((m) => (
                    <option key={m.code} value={m.code}>{m.name}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-mist">
                  Enregistrer
                </button>
              </form>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}
