import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getSession,
  getSessionForPv,
  PROGRESSION_LABELS,
  SCOPE_LABELS,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_TONES,
} from "@/lib/services/deliberations";
import {
  adjustDecisionAction,
  depublishAction,
  publishAction,
  reprepareAction,
  unlockAction,
  validateAction,
} from "@/app/app/(tenant)/deliberations/[id]/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const DECISION_STATUS_LABELS: Record<string, string> = {
  PROPOSED: "Proposée",
  ADJUSTED: "Ajustée",
  VALIDATED: "Validée",
};

const fmtScore = (n: number | null | undefined) =>
  n == null ? "—" : n.toFixed(2).replace(".", ",");
const fmtDate = (d: Date | null | undefined) =>
  d ? `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "—";

export default async function DeliberationDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("deliberations.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const confirm = str("confirm");

  const [session, pv, canManage, canValidate, canPublish] = await Promise.all([
    getSession(ctx, id),
    getSessionForPv(ctx, id),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "deliberations.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "deliberations.validate",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "deliberations.publish",
    }),
  ]);
  if (!session || !pv) notFound();

  // Règles actives du scope pour le sélecteur d'ajustement.
  const rules = await prisma.deliberationRule.findMany({
    where: { schoolId: tenant.schoolId, scope: session.scope, status: "ACTIVE" },
    select: { id: true, label: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  const undecided = session.decisions.filter((d) => !d.finalLabel).length;
  const base = `/app/deliberations/${session.id}`;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <p className="text-sm">
        <Link href="/app/deliberations" className="text-blue-700 underline">
          ← Délibérations
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">
        {SCOPE_LABELS[session.scope]} — {session.classroom.name}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        PV <span className="font-mono">{session.number}</span> ·{" "}
        {session.scope === "PERIOD"
          ? `Période : ${session.academicPeriod?.name}`
          : `Année : ${session.academicYear.name}`}{" "}
        ·{" "}
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${SESSION_STATUS_TONES[session.status]}`}
        >
          {SESSION_STATUS_LABELS[session.status]}
        </span>
      </p>

      {ok && (
        <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">
          {okMessage(ok)}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          {errorMessage(error)}
        </p>
      )}
      {session.staleDecisionIds.size > 0 && session.status === "OPEN" && (
        <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
          Les moyennes de {session.staleDecisionIds.size} élève(s) ont été
          recalculées depuis la préparation — les propositions ci-dessous
          datent de la préparation. Relancez le calcul des propositions pour
          les rafraîchir.
        </p>
      )}
      {session.unlockReason && (
        <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
          Déverrouillée pour correction : {session.unlockReason}
        </p>
      )}
      {session.depublishReason && session.status !== "PUBLISHED" && (
        <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
          Dernière dépublication : {session.depublishReason}
        </p>
      )}

      {/* Actions de cycle de vie — chacune sous confirmation explicite */}
      {confirm === "validate" && canValidate && session.status === "OPEN" && (
        <div className="mt-6">
          <ConfirmPanel
            title="Valider la délibération"
            action={validateAction}
            fields={{ id: session.id }}
            confirmLabel="Valider et verrouiller"
            cancelHref={base}
          >
            Le conseil valide les décisions retenues pour les{" "}
            {session.decisions.length} élèves de {session.classroom.name}.
            La session sera verrouillée : aucun ajustement ne sera plus
            possible sans déverrouillage motivé.
          </ConfirmPanel>
        </div>
      )}
      {confirm === "publish" && canPublish && session.status === "VALIDATED" && (
        <div className="mt-6">
          <ConfirmPanel
            title="Publier les décisions"
            action={publishAction}
            fields={{ id: session.id }}
            confirmLabel="Publier"
            cancelHref={base}
          >
            Les décisions retenues seront diffusées
            {session.scope === "PERIOD"
              ? " vers les résultats de période (colonne « décision du conseil » des bulletins)"
              : " vers les décisions annuelles (moyennes annuelles et réinscriptions)"}
            . La publication reste réversible par dépublication motivée.
          </ConfirmPanel>
        </div>
      )}
      {confirm === "unlock" && canValidate && session.status === "VALIDATED" && (
        <div className="mt-6">
          <ConfirmPanel
            title="Déverrouiller pour correction"
            action={unlockAction}
            fields={{ id: session.id }}
            inputs={[
              {
                name: "reason",
                label: "Motif de la correction",
                required: true,
                placeholder: "ex. erreur de saisie constatée par le conseil",
              },
            ]}
            confirmLabel="Déverrouiller"
            cancelHref={base}
          >
            La session repassera en préparation : les décisions pourront de
            nouveau être ajustées, puis devront être revalidées.
          </ConfirmPanel>
        </div>
      )}
      {confirm === "depublish" && canPublish && session.status === "PUBLISHED" && (
        <div className="mt-6">
          <ConfirmPanel
            title="Retirer la publication"
            tone="danger"
            action={depublishAction}
            fields={{ id: session.id }}
            inputs={[
              {
                name: "reason",
                label: "Motif de la dépublication",
                required: true,
              },
            ]}
            confirmLabel="Dépublier"
            cancelHref={base}
          >
            Les libellés de décision seront retirés des bulletins / résultats
            annuels (les corrections manuelles éventuelles sont préservées) et
            la session repassera à l&rsquo;état validée.
          </ConfirmPanel>
        </div>
      )}

      <section className="mt-6 flex flex-wrap items-center gap-3">
        {session.status === "OPEN" && canManage && (
          <form action={reprepareAction}>
            <input type="hidden" name="id" value={session.id} />
            <SubmitButton>Recalculer les propositions</SubmitButton>
          </form>
        )}
        {session.status === "OPEN" && canValidate && (
          <Link
            href={`${base}?confirm=validate`}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Valider la délibération{undecided ? ` (${undecided} sans décision)` : ""}
          </Link>
        )}
        {session.status === "VALIDATED" && canPublish && (
          <Link
            href={`${base}?confirm=publish`}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Publier les décisions
          </Link>
        )}
        {session.status === "VALIDATED" && canValidate && (
          <Link
            href={`${base}?confirm=unlock`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
          >
            Déverrouiller (correction)
          </Link>
        )}
        {session.status === "PUBLISHED" && canPublish && (
          <Link
            href={`${base}?confirm=depublish`}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Dépublier
          </Link>
        )}
        <Link
          href={`${base}/pv`}
          target="_blank"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
        >
          Procès-verbal (PDF)
        </Link>
        <Link
          href={`${base}/export`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
        >
          Liste des décisions (CSV)
        </Link>
      </section>

      <section className="mt-6 rounded border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">Synthèse</h2>
        <p className="mt-2">
          Effectif : {pv.stats.enrolled} · Classés : {pv.stats.ranked} ·
          Moyenne de classe : {fmtScore(pv.stats.classAverage)}
          {pv.stats.undecided > 0 &&
            ` · Sans décision : ${pv.stats.undecided}`}
        </p>
        {pv.stats.byDecision.length > 0 && (
          <p className="mt-1 text-gray-600">
            {pv.stats.byDecision
              .map(([label, n]) => `${label} : ${n}`)
              .join(" — ")}
          </p>
        )}
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-gray-500 sm:grid-cols-2">
          <div>
            Préparée le {fmtDate(session.preparedAt)}
          </div>
          <div>
            Validée le {fmtDate(session.validatedAt)}
          </div>
          <div>
            Publiée le {fmtDate(session.publishedAt)}
          </div>
          <div>
            {session.note ? `Note : ${session.note}` : ""}
          </div>
        </dl>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Décisions par élève</h2>
        <p className="mt-1 text-xs text-gray-500">
          La « proposition » est calculée par les règles ; la « décision
          retenue » est celle du conseil. Tout écart exige un motif.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-600">
                <th className="py-2">Élève</th>
                <th>Moyenne</th>
                <th>Rang</th>
                <th>Mention</th>
                <th>Proposition</th>
                <th>Décision retenue</th>
                <th>État</th>
                {session.status === "OPEN" && canManage && (
                  <th className="min-w-64">Ajuster (conseil)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {session.decisions.map((d) => {
                const stale = session.staleDecisionIds.has(d.id);
                return (
                  <tr key={d.id} className="border-b align-top">
                    <td className="py-2">
                      <span className="font-medium">
                        {d.student.lastName} {d.student.firstName}
                      </span>
                      <span className="block font-mono text-xs text-gray-500">
                        {d.student.matricule}
                      </span>
                      {!d.completeSnapshot && (
                        <span className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                          notes incomplètes
                        </span>
                      )}
                      {stale && (
                        <span className="mt-0.5 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">
                          moyenne recalculée
                        </span>
                      )}
                    </td>
                    <td className="font-mono">{fmtScore(d.averageSnapshot)}</td>
                    <td>{d.rankSnapshot ?? "—"}</td>
                    <td>{d.mentionSnapshot ?? "—"}</td>
                    <td>
                      {d.proposedLabel ?? (
                        <span className="text-gray-400">aucune règle</span>
                      )}
                      {d.proposedProgression && (
                        <span className="block text-[10px] uppercase text-zinc-500">
                          {PROGRESSION_LABELS[d.proposedProgression]}
                        </span>
                      )}
                    </td>
                    <td className="font-medium">
                      {d.finalLabel ?? (
                        <span className="text-red-600">à trancher</span>
                      )}
                      {d.finalProgression && (
                        <span className="block text-[10px] uppercase text-zinc-500">
                          {PROGRESSION_LABELS[d.finalProgression]}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          d.status === "ADJUSTED"
                            ? "bg-amber-50 text-amber-800"
                            : d.status === "VALIDATED"
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {DECISION_STATUS_LABELS[d.status]}
                      </span>
                      {d.adjustmentReason && (
                        <span className="mt-1 block max-w-56 text-xs text-gray-500">
                          Motif : {d.adjustmentReason}
                        </span>
                      )}
                    </td>
                    {session.status === "OPEN" && canManage && (
                      <td>
                        <form
                          action={adjustDecisionAction}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="decisionId" value={d.id} />
                          <input
                            type="hidden"
                            name="sessionId"
                            value={session.id}
                          />
                          <select
                            name="ruleId"
                            className="rounded border px-1.5 py-1 text-xs"
                            defaultValue=""
                          >
                            <option value="">— règle —</option>
                            {rules.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <input
                            name="customLabel"
                            placeholder="ou libellé libre"
                            maxLength={100}
                            className="w-36 rounded border px-1.5 py-1 text-xs"
                          />
                          {session.scope === "ANNUAL" && (
                            <select
                              name="progression"
                              aria-label="Progression"
                              className="rounded border px-1.5 py-1 text-xs"
                              defaultValue=""
                            >
                              <option value="">— progression —</option>
                              {Object.entries(PROGRESSION_LABELS).map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          )}
                          <input
                            name="reason"
                            placeholder="motif (requis si ≠ proposition)"
                            maxLength={1000}
                            className="w-44 rounded border px-1.5 py-1 text-xs"
                          />
                          <button
                            type="submit"
                            className="rounded bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-800"
                          >
                            Retenir
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
