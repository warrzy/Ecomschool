import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getCurrentSubscription,
  getEntitlements,
  usageSnapshot,
} from "@/lib/services/platform/modules";
import { listSchoolInvoices } from "@/lib/services/platform/billing";
import { listPlans } from "@/lib/services/platform/plans";
import { requestPlanChange } from "@/lib/services/platform/subscriptions";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/ui/errorLabels";
import { HelpLink, Notice, NoticeSection } from "@/components/ui/Notice";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const STATUS: Record<string, string> = {
  TRIALING: "Essai gratuit",
  ACTIVE: "Actif",
  PAST_DUE: "Paiement en attente",
  GRACE: "Période de grâce",
  SUSPENDED: "Suspendu",
  EXPIRED: "Expiré",
  CANCELLED: "Résilié",
};
const INV_STATUS: Record<string, string> = {
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

async function requestPlanChangeAction(formData: FormData) {
  "use server";
  const tenant = await requireSchoolPermission("school.manage");
  const res = await requestPlanChange(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      planId: String(formData.get("planId") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
    },
  );
  redirect(
    res.ok
      ? "/app/subscription?ok=request"
      : `/app/subscription?error=${res.error}`,
  );
}

export default async function SubscriptionPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("school.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const [subscription, entitlements, usage, invoices, plans, pendingReq, canRequestChange] =
    await Promise.all([
      getCurrentSubscription(tenant.schoolId),
      getEntitlements(tenant.schoolId),
      usageSnapshot(tenant.schoolId),
      listSchoolInvoices(tenant.schoolId),
      listPlans(),
      prisma.subscriptionChangeRequest.findFirst({
        where: { schoolId: tenant.schoolId, status: "PENDING" },
        include: { requestedPlan: { select: { name: true } } },
      }),
      // Aligné sur le garde de `requestPlanChangeAction` ("school.manage") :
      // le formulaire s'affiche pour tout rôle autorisé à gérer l'école,
      // pas seulement ADMIN_SCHOOL.
      userHasSchoolPermission({
        userId: tenant.userId,
        schoolId: tenant.schoolId,
        permissionKey: "school.manage",
      }),
    ]);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";
  const planModules = subscription
    ? subscription.plan.modules.map((m) => m.module)
    : [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">ECOM-SCHOOL</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Mon abonnement
        </h1>
        <div className="mt-3">
          <HelpLink>Comment fonctionne l&apos;abonnement ?</HelpLink>
        </div>
        {ok === "request" ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Demande envoyée — elle sera appliquée après validation par ECOM-TOUCH.
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "INVALID_STATUS" ? "Une demande est déjà en attente." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <Notice title="Notice — formules, cycle de vie et changement d'offre">
        <NoticeSection title="Formules et contenu">
          Chaque offre définit un prix mensuel et annuel, un plafond
          d&apos;élèves et d&apos;utilisateurs (éventuellement illimité), une
          durée d&apos;essai et la liste des modules inclus. Les modules non
          inclus dans l&apos;offre — ni ajoutés par ECOM-TOUCH à titre
          exceptionnel — restent inaccessibles dans l&apos;application.
        </NoticeSection>
        <NoticeSection title="Cycle de vie">
          <strong>Essai gratuit</strong> jusqu&apos;à la date de fin
          d&apos;essai, puis <strong>Actif</strong> tant que les échéances sont
          honorées. Un paiement en retard fait passer l&apos;abonnement en{" "}
          <strong>Paiement en attente</strong> puis en{" "}
          <strong>période de grâce</strong> ; faute de régularisation, le compte
          est <strong>suspendu</strong> : les données sont conservées en
          lecture seule jusqu&apos;à réactivation ou <strong>expiration</strong>.
          Le statut <strong>Résilié</strong> correspond à une résiliation.
        </NoticeSection>
        <NoticeSection title="Dates et renouvellement">
          L&apos;échéance affichée (« prochaine échéance ») est la fin de la
          période en cours — mensuelle ou annuelle selon le cycle choisi. La
          reconduction et les rappels d&apos;échéance sont gérés
          automatiquement côté plateforme.
        </NoticeSection>
        <NoticeSection title="Changement de formule">
          Le bouton « Demander un changement d&apos;offre » transmet votre
          choix à ECOM-TOUCH : <strong>aucune activation n&apos;est
          automatique</strong> — le changement n&apos;est appliqué
          qu&apos;après validation commerciale. Une seule demande peut être en
          attente à la fois.
        </NoticeSection>
        <NoticeSection title="Factures">
          Les factures SaaS (émissions, montants, soldes) sont listées en bas
          de page ; elles relèvent de la facturation ECOM-TOUCH et sont
          distinctes des finances internes de l&apos;établissement.
        </NoticeSection>
      </Notice>

      {subscription ? (
        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-zinc-900">
                {subscription.plan.name}{" "}
                <span className="text-xs text-zinc-500">({subscription.plan.code})</span>
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                {STATUS[subscription.status] ?? subscription.status}
                {" · "}
                {subscription.cycle === "YEARLY" ? "facturation annuelle" : "facturation mensuelle"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {subscription.status === "TRIALING"
                  ? `Fin d'essai : ${subscription.trialEndsAt?.toISOString().slice(0, 10) ?? "—"}`
                  : `Prochaine échéance : ${subscription.currentPeriodEnd?.toISOString().slice(0, 10) ?? "—"}`}
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="font-medium">{fmt(subscription.plan.monthlyPrice)}/mois</div>
              <div className="text-xs text-zinc-500">{fmt(subscription.plan.yearlyPrice)}/an</div>
            </div>
          </div>
          {subscription.status === "GRACE" || subscription.status === "SUSPENDED" ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {subscription.status === "GRACE"
                ? `Période de grâce jusqu'au ${subscription.graceEndsAt?.toISOString().slice(0, 10)} — régularisez pour éviter la suspension.`
                : "Compte suspendu — vos données sont conservées en lecture seule. Contactez ECOM-TOUCH pour réactiver."}
            </div>
          ) : null}

          <div className="mt-4 border-t border-zinc-100 pt-4">
            <div className="mb-2 text-sm font-medium text-zinc-900">Limites d&apos;utilisation</div>
            <div className="text-sm text-zinc-600">
              Élèves : {usage.students}{usage.maxStudents != null ? ` / ${usage.maxStudents}` : " (illimité)"}
              {" · "}Utilisateurs : {usage.users}{usage.maxUsers != null ? ` / ${usage.maxUsers}` : " (illimité)"}
            </div>
          </div>

          <div className="mt-4 border-t border-zinc-100 pt-4">
            <div className="mb-2 text-sm font-medium text-zinc-900">Modules disponibles</div>
            <div className="flex flex-wrap gap-1">
              {planModules.map((m) => {
                const on = entitlements.isModuleEnabled(m.code);
                return (
                  <span
                    key={m.code}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      on ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-500 line-through"
                    }`}
                  >
                    {m.name}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className={card}>
          <div className="text-sm text-zinc-600">
            Aucun abonnement commercial n&apos;est rattaché à cet établissement.
          </div>
        </div>
      )}

      {pendingReq ? (
        <div className={`${card} border-amber-200 bg-amber-50`}>
          <div className="text-sm font-medium text-amber-900">
            Demande en attente : passage à l&apos;offre {pendingReq.requestedPlan.name}
          </div>
        </div>
      ) : null}

      {canRequestChange && !pendingReq && plans.length > 0 ? (
        <div className={card}>
          <div className="mb-2 text-sm font-medium text-zinc-900">Demander un changement d&apos;offre</div>
          <p className="mb-3 text-xs text-zinc-500">
            La demande est transmise à ECOM-TOUCH — aucune activation automatique.
          </p>
          <form action={requestPlanChangeAction} className="flex flex-wrap items-end gap-2">
            <select
                  aria-label="Formule d'abonnement" name="planId" required className={`${input} w-full min-w-0 sm:w-auto`}>
              {plans
                .filter((p) => p.id !== subscription?.planId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {fmt(p.monthlyPrice)}/mois · {fmt(p.yearlyPrice)}/an
                  </option>
                ))}
            </select>
            <input aria-label="Note" name="note" placeholder="Motif (optionnel)" className={`${input} min-w-0 flex-1`} />
            <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
              Envoyer la demande
            </button>
          </form>
        </div>
      ) : null}

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Factures SaaS ({invoices.length})
        </div>
        <div className="overflow-x-auto">
        <table aria-label="Mon abonnement" className="w-full text-left text-sm">
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 font-mono text-xs">{i.invoiceNumber}</td>
                <td className="py-2 text-xs">{i.issueDate.toISOString().slice(0, 10)}</td>
                <td className="py-2 text-right">{fmt(i.total)}</td>
                <td className="py-2 text-right text-xs">
                  {i.balance > 0 ? `solde ${fmt(i.balance)}` : "soldée"}
                </td>
                <td className="py-2">{INV_STATUS[i.status] ?? i.status}</td>
              </tr>
            ))}
            {invoices.length === 0 ? (
              <tr><td colSpan={5} className="py-3 text-zinc-500">Aucune facture.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
