import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getPaymentIntent,
  listPaymentIntents,
  listPaymentProviders,
  paymentIntentStats,
} from "@/lib/services/payments/mobileIntents";
import { listWebhookEvents } from "@/lib/services/payments/webhooks";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  cancelIntentAction,
  createIntentAction,
  createSandboxProviderAction,
  pollIntentAction,
  postIntentAction,
  replayWebhookAction,
  simulateOutcomeAction,
  sweepExpiredAction,
  toggleProviderAction,
} from "./actions";
import type { PaymentIntentStatus } from "@prisma/client";

export const instant = false;

const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
const input = "mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm";
const btn = "rounded-lg px-3 py-2 text-sm font-medium";
const btnPrimary = `${btn} bg-brand-600 text-white hover:bg-brand-700`;
const btnNeutral = `${btn} border border-zinc-300 bg-white text-zinc-700 hover:bg-mist`;
const btnDanger = `${btn} border border-red-300 bg-red-50 text-red-800 hover:bg-red-100`;

const STATUS_LABELS: Record<PaymentIntentStatus, string> = {
  CREATED: "Créée",
  PENDING: "En attente",
  CONFIRMED: "Confirmée",
  FAILED: "Échouée",
  EXPIRED: "Expirée",
  CANCELLED: "Annulée",
  CONFIRMED_PENDING_POSTING: "Confirmée — compta. en attente",
};
const STATUS_TONES: Record<PaymentIntentStatus, string> = {
  CREATED: "bg-zinc-100 text-zinc-700",
  PENDING: "bg-amber-50 text-amber-800",
  CONFIRMED: "bg-emerald-50 text-emerald-800",
  FAILED: "bg-red-50 text-red-800",
  EXPIRED: "bg-zinc-100 text-zinc-600",
  CANCELLED: "bg-zinc-100 text-zinc-600",
  CONFIRMED_PENDING_POSTING: "bg-blue-50 text-blue-800",
};
const KIND_LABELS: Record<string, string> = {
  INITIATE: "Initiation",
  STATUS_CHECK: "Consultation",
  CONFIRM: "Confirmation",
  FAIL: "Échec",
  EXPIRE: "Expiration",
  CANCEL: "Annulation",
  POSTING: "Comptabilisation",
  WEBHOOK: "Webhook",
  REFUND: "Remboursement",
};
const WEBHOOK_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Reçu",
  PROCESSING: "En traitement",
  PROCESSED: "Traité",
  FAILED: "Échec",
  IGNORED: "Ignoré",
  ANOMALY: "Anomalie",
};
const WEBHOOK_STATUS_TONES: Record<string, string> = {
  RECEIVED: "bg-zinc-100 text-zinc-700",
  PROCESSING: "bg-amber-50 text-amber-800",
  PROCESSED: "bg-emerald-50 text-emerald-800",
  FAILED: "bg-red-50 text-red-800",
  IGNORED: "bg-zinc-100 text-zinc-600",
  ANOMALY: "bg-orange-50 text-orange-800",
};
const OUTCOMES = [
  ["SUCCESS", "Succès"],
  ["FAILED", "Échec"],
  ["PENDING", "Reste en attente"],
  ["LATE", "Réponse tardive"],
  ["TIMEOUT", "Timeout"],
  ["REPEATED", "Confirmation répétée"],
] as const;

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
const dt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default async function PaiementsMobilePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("mobilepayments.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const error = str("error");
  const okMsg = str("ok");
  const statusFilter = str("status");
  const selectedId = str("intent");

  const [canManage, canSimulate] = await Promise.all([
    userHasSchoolPermission({ ...ctx, permissionKey: "mobilepayments.manage" }),
    userHasSchoolPermission({ ...ctx, permissionKey: "mobilepayments.simulate" }),
  ]);
  // Simulation : permission dédiée + environnement autorisé uniquement.
  const sandboxEnv =
    process.env.MOBILE_MONEY_SANDBOX_UI === "1" || process.env.NODE_ENV !== "production";
  const showSimulate = canSimulate && sandboxEnv;

  const [providers, intents, stats, students, years] = await Promise.all([
    listPaymentProviders(ctx),
    listPaymentIntents(ctx, { status: statusFilter }),
    paymentIntentStats(ctx),
    prisma.student.findMany({
      where: { schoolId: ctx.schoolId, status: "ACTIVE" },
      select: { id: true, matricule: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
      take: 300,
    }),
    prisma.academicYear.findMany({
      where: { schoolId: ctx.schoolId },
      select: { id: true, name: true, isCurrent: true },
      orderBy: { startDate: "desc" },
    }),
  ]);
  const detail = selectedId ? await getPaymentIntent(ctx, selectedId) : null;
  const webhookEvents = await listWebhookEvents(ctx, { limit: 50 });
  const pendingPostings = intents.filter((i) => i.status === "CONFIRMED_PENDING_POSTING");
  const anomalies = webhookEvents.filter((e) => e.status === "ANOMALY" || e.status === "FAILED");
  const totalAmount = stats.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Paiements Mobile Money</h1>
          <p className="text-sm text-zinc-500">
            Intentions de paiement — aucune intention n&apos;est un encaissement
            tant qu&apos;elle n&apos;est pas confirmée puis comptabilisée.
          </p>
        </div>
        {canManage && (
          <form action={sweepExpiredAction}>
            <SubmitButton className={btnNeutral} pendingLabel="Balayage…">
              Balayer les intentions expirées
            </SubmitButton>
          </form>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage(error)}
        </div>
      )}
      {okMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {okMessage(okMsg)}
        </div>
      )}

      {/* Statistiques */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={card}>
          <p className="text-xs uppercase text-zinc-500">Intentions</p>
          <p className="mt-1 text-2xl font-semibold">{stats.reduce((s, r) => s + r.count, 0)}</p>
        </div>
        <div className={card}>
          <p className="text-xs uppercase text-zinc-500">Montant cumulé</p>
          <p className="mt-1 text-2xl font-semibold">{fmt(totalAmount)} XOF</p>
        </div>
        <div className={card}>
          <p className="text-xs uppercase text-zinc-500">En attente</p>
          <p className="mt-1 text-2xl font-semibold">
            {stats.find((r) => r.status === "PENDING")?.count ?? 0}
          </p>
        </div>
        <div className={card}>
          <p className="text-xs uppercase text-zinc-500">Compta. en attente</p>
          <p className="mt-1 text-2xl font-semibold">
            {stats.find((r) => r.status === "CONFIRMED_PENDING_POSTING")?.count ?? 0}
          </p>
        </div>
      </div>

      {/* Fournisseurs */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-ink">Fournisseurs configurés</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-zinc-500">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Libellé</th>
                <th className="py-2 pr-4">Mode</th>
                <th className="py-2 pr-4">Bornes</th>
                <th className="py-2 pr-4">Statut</th>
                {canManage && <th className="py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-4 font-mono text-xs">{p.code}</td>
                  <td className="py-2 pr-4">{p.label}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.mode === "SANDBOX" ? "bg-violet-50 text-violet-800" : "bg-zinc-100 text-zinc-700"}`}>
                      {p.mode === "SANDBOX" ? "Simulateur" : "Réel"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-zinc-500">
                    {fmt(p.minAmount)} – {p.maxAmount === null ? "∞" : fmt(p.maxAmount)}
                  </td>
                  <td className="py-2 pr-4 text-xs">{p.status === "ACTIVE" ? "Actif" : "Archivé"}</td>
                  {canManage && (
                    <td className="py-2">
                      <form action={toggleProviderAction}>
                        <input type="hidden" name="providerId" value={p.id} />
                        <input type="hidden" name="status" value={p.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"} />
                        <SubmitButton className="text-xs text-brand-700 hover:underline" pendingLabel="…">
                          {p.status === "ACTIVE" ? "Archiver" : "Réactiver"}
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {providers.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-sm text-zinc-500">Aucun fournisseur configuré.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canManage && sandboxEnv && (
          <form action={createSandboxProviderAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
            <label className="text-sm">
              Libellé du simulateur
              <input name="label" required className={input} placeholder="Sandbox Mobile Money" />
            </label>
            <label className="text-sm">
              Montant min
              <input name="minAmount" type="number" defaultValue={100} className={input} />
            </label>
            <label className="text-sm">
              Montant max (vide = illimité)
              <input name="maxAmount" type="number" className={input} />
            </label>
            <SubmitButton className={btnPrimary} pendingLabel="Création…">
              Ajouter le simulateur
            </SubmitButton>
          </form>
        )}
      </div>

      {/* Création d'intention (guichet de test) */}
      {canManage && sandboxEnv && providers.some((p) => p.status === "ACTIVE") && (
        <div className={card}>
          <h2 className="text-sm font-semibold text-ink">Nouvelle intention (environnement de test)</h2>
          <form action={createIntentAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              Élève
              <select name="studentId" required className={input}>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.matricule} — {s.lastName} {s.firstName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Année scolaire
              <select name="academicYearId" required className={input}>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}{y.isCurrent ? " (courante)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Fournisseur
              <select name="providerId" required className={input}>
                {providers.filter((p) => p.status === "ACTIVE").map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Montant (XOF)
              <input name="amount" type="number" min={1} required className={input} />
            </label>
            <label className="text-sm">
              Téléphone payeur (fictif)
              <input name="payerPhone" className={input} placeholder="+226 00 00 00 00" />
            </label>
            <label className="text-sm">
              Clé d&apos;idempotence (optionnel)
              <input name="idempotencyKey" className={input} placeholder="auto" />
            </label>
            {showSimulate && (
              <label className="text-sm">
                Scénario sandbox
                <select name="sandboxOutcome" className={input} defaultValue="PENDING">
                  {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
            <div className="flex items-end">
              <SubmitButton className={btnPrimary} pendingLabel="Création…">
                Créer l&apos;intention
              </SubmitButton>
            </div>
          </form>
        </div>
      )}

      {/* Liste des intentions */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Intentions</h2>
          <form method="get" className="flex items-center gap-2 text-sm">
            <select name="status" defaultValue={statusFilter ?? ""} className={input}>
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <button type="submit" className={btnNeutral}>Filtrer</button>
          </form>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-zinc-500">
                <th className="py-2 pr-4">Élève</th>
                <th className="py-2 pr-4">Montant</th>
                <th className="py-2 pr-4">Fournisseur</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4">Réf. prestataire</th>
                <th className="py-2 pr-4">Reçu</th>
                <th className="py-2 pr-4">Créée le</th>
                <th className="py-2">Détail</th>
              </tr>
            </thead>
            <tbody>
              {intents.map((i) => (
                <tr key={i.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-4">
                    {i.student.matricule} — {i.student.lastName} {i.student.firstName}
                  </td>
                  <td className="py-2 pr-4 font-medium">{fmt(i.amount)} {i.currency}</td>
                  <td className="py-2 pr-4 text-xs">
                    {i.provider.label}
                    {i.provider.mode === "SANDBOX" && (
                      <span className="ml-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">simu</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONES[i.status]}`}>
                      {STATUS_LABELS[i.status]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-500">
                    {i.providerTxId ?? i.providerRef ?? "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {i.payment?.receiptNumber ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-xs text-zinc-500">{dt(i.createdAt)}</td>
                  <td className="py-2">
                    <a href={`${"/app/paiements-mobile"}?intent=${i.id}${statusFilter ? `&status=${statusFilter}` : ""}`} className="text-xs text-brand-700 hover:underline">
                      Voir
                    </a>
                  </td>
                </tr>
              ))}
              {intents.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-sm text-zinc-500">Aucune intention.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Encaissements confirmés en attente de comptabilisation */}
      {pendingPostings.length > 0 && (
        <div className={`${card} border-blue-200`}>
          <h2 className="text-sm font-semibold text-blue-900">
            Encaissements confirmés en attente ({pendingPostings.length})
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Reprise automatique par le cron ; relance manuelle possible ci-dessous.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {pendingPostings.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
                <span>
                  {i.student.matricule} — {fmt(i.amount)} {i.currency}
                  {i.failureReason && <span className="ml-2 font-mono text-xs text-red-700">{i.failureReason}</span>}
                </span>
                {canManage && (
                  <form action={postIntentAction}>
                    <input type="hidden" name="intentId" value={i.id} />
                    <SubmitButton className="text-xs text-brand-700 hover:underline" pendingLabel="…">
                      Relancer la comptabilisation
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Événements webhooks */}
      <div className={card} id="webhooks">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Événements webhooks</h2>
          {anomalies.length > 0 && (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-800">
              {anomalies.length} à vérifier
            </span>
          )}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-zinc-500">
                <th className="py-2 pr-4">Événement</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4">Tentatives</th>
                <th className="py-2 pr-4">Intention</th>
                <th className="py-2 pr-4">Reçu le</th>
                <th className="py-2 pr-4">Erreur / résultat</th>
                {canManage && <th className="py-2">Action</th>}
              </tr>
            </thead>
            <tbody>
              {webhookEvents.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-4 font-mono text-xs">{e.externalId.slice(0, 24)}</td>
                  <td className="py-2 pr-4 text-xs">{e.eventType}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${WEBHOOK_STATUS_TONES[e.status]}`}>
                      {WEBHOOK_STATUS_LABELS[e.status]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs">{e.attempts}</td>
                  <td className="py-2 pr-4 text-xs">
                    {e.intent ? (
                      <a href={`/app/paiements-mobile?intent=${e.intent.id}`} className="text-brand-700 hover:underline">
                        {fmt(e.intent.amount)} {e.intent.currency}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-xs text-zinc-500">{dt(e.receivedAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-500">
                    {e.lastError ?? (e.result as { anomaly?: string } | null)?.anomaly ?? "—"}
                  </td>
                  {canManage && (
                    <td className="py-2">
                      {(e.status === "FAILED" || e.status === "ANOMALY") && (
                        <form action={replayWebhookAction}>
                          <input type="hidden" name="eventId" value={e.id} />
                          <SubmitButton className="text-xs text-brand-700 hover:underline" pendingLabel="…">
                            Relancer
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {webhookEvents.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-sm text-zinc-500">Aucun événement reçu.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Détail + historique des transitions */}
      {detail && (
        <div className={card}>
          <h2 className="text-sm font-semibold text-ink">
            Intention {detail.id.slice(0, 8)}… — {fmt(detail.amount)} {detail.currency}
          </h2>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs text-zinc-500">Élève</dt><dd>{detail.student.matricule} — {detail.student.lastName} {detail.student.firstName}</dd></div>
            <div><dt className="text-xs text-zinc-500">Année</dt><dd>{detail.academicYear.name}</dd></div>
            <div><dt className="text-xs text-zinc-500">Fournisseur</dt><dd>{detail.provider.label} ({detail.provider.mode === "SANDBOX" ? "simulateur" : "réel"})</dd></div>
            <div><dt className="text-xs text-zinc-500">Statut</dt><dd><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONES[detail.status]}`}>{STATUS_LABELS[detail.status]}</span></dd></div>
            <div><dt className="text-xs text-zinc-500">Canal</dt><dd>{detail.channel}</dd></div>
            <div><dt className="text-xs text-zinc-500">Clé d&apos;idempotence</dt><dd className="font-mono text-xs">{detail.idempotencyKey}</dd></div>
            <div><dt className="text-xs text-zinc-500">Réf. prestataire</dt><dd className="font-mono text-xs">{detail.providerRef ?? "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Tx prestataire</dt><dd className="font-mono text-xs">{detail.providerTxId ?? "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Encaissement lié</dt><dd className="font-mono text-xs">{detail.payment ? `${detail.payment.receiptNumber} (${detail.payment.status})` : "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Initiée par</dt><dd>{detail.initiatedBy ? `${detail.initiatedBy.firstName ?? ""} ${detail.initiatedBy.lastName ?? ""}` : "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Expire le</dt><dd>{dt(detail.expiresAt)}</dd></div>
            {detail.failureReason && (
              <div><dt className="text-xs text-zinc-500">Erreur</dt><dd className="font-mono text-xs text-red-700">{detail.failureReason}</dd></div>
            )}
          </dl>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
            {canManage && detail.status === "PENDING" && (
              <form action={pollIntentAction}>
                <input type="hidden" name="intentId" value={detail.id} />
                <SubmitButton className={btnNeutral} pendingLabel="Consultation…">
                  Consulter le statut prestataire
                </SubmitButton>
              </form>
            )}
            {canManage && (detail.status === "CREATED" || detail.status === "PENDING") && (
              <form action={cancelIntentAction}>
                <input type="hidden" name="intentId" value={detail.id} />
                <SubmitButton className={btnDanger} pendingLabel="Annulation…">
                  Annuler l&apos;intention
                </SubmitButton>
              </form>
            )}
            {canManage && detail.status === "CONFIRMED_PENDING_POSTING" &&
              detail.provider.mode !== "SANDBOX" && (
              <form action={postIntentAction}>
                <input type="hidden" name="intentId" value={detail.id} />
                <SubmitButton className={btnPrimary} pendingLabel="Comptabilisation…">
                  Comptabiliser l&apos;encaissement
                </SubmitButton>
              </form>
            )}
            {showSimulate && detail.provider.mode === "SANDBOX" &&
              (detail.status === "CREATED" || detail.status === "PENDING") && (
              <form action={simulateOutcomeAction} className="flex items-center gap-2">
                <input type="hidden" name="intentId" value={detail.id} />
                <select name="outcome" className={input}>
                  {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <SubmitButton className={btnNeutral} pendingLabel="…">
                  Programmer le scénario
                </SubmitButton>
              </form>
            )}
          </div>

          <h3 className="mt-6 text-xs font-semibold uppercase text-zinc-500">Historique des échanges</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Réf. tx</th>
                  <th className="py-2 pr-4">Statut brut</th>
                  <th className="py-2">Détail</th>
                </tr>
              </thead>
              <tbody>
                {detail.transactions.map((t) => (
                  <tr key={t.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-4 text-xs text-zinc-500">{dt(t.createdAt)}</td>
                    <td className="py-2 pr-4">{KIND_LABELS[t.kind] ?? t.kind}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{t.providerTxId ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{t.rawStatus ?? "—"}</td>
                    <td className="py-2 font-mono text-[11px] text-zinc-500">
                      {t.payload ? JSON.stringify(t.payload) : "—"}
                    </td>
                  </tr>
                ))}
                {detail.transactions.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-sm text-zinc-500">Aucun échange enregistré.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
