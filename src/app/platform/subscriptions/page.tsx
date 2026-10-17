import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { listChangeRequests } from "@/lib/services/platform/subscriptions";
import {
  reviewChangeRequestAction,
  sweepSubscriptionsAction,
} from "@/app/platform/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { HelpLink, Notice, NoticeSection } from "@/components/ui/Notice";

export const instant = false;

const STATUS: Record<string, string> = {
  TRIALING: "Essai",
  ACTIVE: "Actif",
  PAST_DUE: "Impayé",
  GRACE: "Grâce",
  SUSPENDED: "Suspendu",
  EXPIRED: "Expiré",
  CANCELLED: "Résilié",
};

export default async function SubscriptionsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.subscriptions.read");
  const sp = (await props.searchParams) ?? {};
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const [subs, requests] = await Promise.all([
    prisma.schoolSubscription.findMany({
      include: {
        school: { select: { name: true, status: true } },
        plan: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    listChangeRequests("PENDING"),
  ]);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">
              <Link href="/platform" className="hover:underline">Plateforme</Link> / Abonnements
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Abonnements ({subs.length})
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HelpLink>Cycle de vie des abonnements</HelpLink>
            <form action={sweepSubscriptionsAction}>
              <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">
                Appliquer le cycle de vie (grâce/suspension/expiration)
              </button>
            </form>
          </div>
        </div>
        {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(error)}</div> : null}
      </div>

      <Notice title="Notice — gestion des abonnements">
        <NoticeSection title="Cycle de vie automatique">
          Les transitions de statut (essai → actif → paiement en attente →
          grâce → suspension → expiration) sont appliquées par la tâche
          planifiée, avec alertes de fin d&apos;essai et rappels de factures
          impayées. Le bouton « Appliquer le cycle de vie » déclenche le même
          balayage à la demande.
        </NoticeSection>
        <NoticeSection title="Validation commerciale">
          Les changements d&apos;offre demandés par les établissements
          arrivent dans la file « Demandes de changement » : ils ne
          s&apos;appliquent qu&apos;après <strong>approbation explicite</strong>{" "}
          (boutons Approuver/Refuser) — aucune activation automatique.
        </NoticeSection>
        <NoticeSection title="Effets des statuts">
          Un abonnement suspendu laisse l&apos;établissement en lecture seule
          (données conservées). Expiré ou résilié coupe l&apos;accès.
          Les limites de l&apos;offre (élèves, utilisateurs) et les modules
          inclus s&apos;appliquent en continu côté établissement.
        </NoticeSection>
      </Notice>

      {requests.length > 0 ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Demandes de changement d&apos;offre ({requests.length})
          </div>
          <div className="overflow-x-auto">
          <table aria-label="Demandes de changement d'offre" className="w-full text-left text-sm">
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">
                    <Link href={`/platform/schools/${r.schoolId}`} className="hover:underline">
                      {r.school.name}
                    </Link>
                    {r.note ? <div className="text-xs text-zinc-500">{r.note}</div> : null}
                  </td>
                  <td className="py-2 text-xs">→ <b>{r.requestedPlan.name}</b></td>
                  <td className="py-2 text-right">
                    <form action={reviewChangeRequestAction} className="inline-flex gap-2">
                      <input type="hidden" name="requestId" value={r.id} />
                      <button name="approve" value="1" className="rounded-lg bg-zinc-900 px-3 py-1 text-xs text-white">Approuver</button>
                      <button name="approve" value="0" className="rounded-lg border border-zinc-300 px-3 py-1 text-xs">Refuser</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      <div className={card}>
        <div className="overflow-x-auto">
        <table aria-label="Abonnements" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">École</th>
              <th scope="col" className="py-2">Offre</th>
              <th scope="col" className="py-2">Cycle</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2">Échéance</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">
                  <Link href={`/platform/schools/${s.schoolId}`} className="hover:underline">
                    {s.school.name}
                  </Link>
                </td>
                <td className="py-2">{s.plan.name}</td>
                <td className="py-2 text-xs">{s.cycle === "YEARLY" ? "Annuel" : "Mensuel"}</td>
                <td className="py-2">{STATUS[s.status] ?? s.status}</td>
                <td className="py-2 text-xs">
                  {s.currentPeriodEnd?.toISOString().slice(0, 10) ?? "—"}
                </td>
                <td className="py-2 text-right">
                  <Link href={`/platform/schools/${s.schoolId}`} className="text-xs underline">Gérer</Link>
                </td>
              </tr>
            ))}
            {subs.length === 0 ? (
              <tr><td colSpan={6} className="py-4 text-zinc-500">Aucun abonnement — attribuez une offre depuis une fiche école.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
