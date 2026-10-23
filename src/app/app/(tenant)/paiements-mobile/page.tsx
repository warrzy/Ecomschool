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
import {
  listDiscrepancies,
  listReconciliations,
  listSettlements,
} from "@/lib/services/payments/reconciliation";
import { listRefunds } from "@/lib/services/payments/refunds";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  approveRefundAction,
  cancelIntentAction,
  cancelRefundAction,
  completeSettlementAction,
  confirmRefundAction,
  createIntentAction,
  createRefundAction,
  createSandboxProviderAction,
  decideDiscrepancyAction,
  declareSettlementAction,
  executeRefundAction,
  pollIntentAction,
  postIntentAction,
  rejectRefundAction,
  replayWebhookAction,
  setProviderFeesAction,
  simulateOutcomeAction,
  sweepExpiredAction,
  syncReconciliationAction,
  toggleProviderAction,
  verifyReconciliationAction,
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
const RECON_LABELS: Record<string, string> = {
  PENDING: "En attente",
  MATCHED: "Rapprochée",
  DISCREPANCY: "Écart détecté",
  TO_VERIFY: "À vérifier",
  RESOLVED: "Clôturée",
};
const RECON_TONES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  MATCHED: "bg-emerald-50 text-emerald-800",
  DISCREPANCY: "bg-red-50 text-red-800",
  TO_VERIFY: "bg-blue-50 text-blue-800",
  RESOLVED: "bg-zinc-100 text-zinc-600",
};
const SETTLE_LABELS: Record<string, string> = {
  DECLARED: "Déclaré",
  MATCHED: "Rapproché",
  PARTIAL: "Partiel",
  DISCREPANCY: "Écart",
  MISSING: "Manquant",
};
const SETTLE_TONES: Record<string, string> = RECON_TONES;
const REFUND_LABELS: Record<string, string> = {
  REQUESTED: "Demandé",
  APPROVED: "Approuvé",
  EXECUTED: "Exécuté (simulé)",
  CONFIRMED: "Confirmé",
  REJECTED: "Refusé",
  FAILED: "Échoué",
  CANCELLED: "Annulé",
};
const REFUND_TONES: Record<string, string> = {
  REQUESTED: "bg-amber-50 text-amber-800",
  APPROVED: "bg-blue-50 text-blue-800",
  EXECUTED: "bg-violet-50 text-violet-800",
  CONFIRMED: "bg-emerald-50 text-emerald-800",
  REJECTED: "bg-red-50 text-red-800",
  FAILED: "bg-red-50 text-red-800",
  CANCELLED: "bg-zinc-100 text-zinc-600",
};
const DISC_LABELS: Record<string, string> = {
  CONFIRMED_NO_PAYMENT: "Confirmation sans encaissement",
  PAYMENT_NO_CONFIRM: "Encaissement sans confirmation",
  AMOUNT_MISMATCH: "Écart de montant",
  FEE_MISMATCH: "Commission incorrecte",
  SETTLEMENT_MISSING: "Reversement manquant",
  SETTLEMENT_PARTIAL: "Reversement partiel",
  SETTLEMENT_MISMATCH: "Écart de reversement",
  DUPLICATE_REFERENCE: "Double référence",
  UNKNOWN_REFERENCE: "Référence inconnue",
  LATE_CONFIRMATION: "Confirmation tardive",
  OVERPAYMENT_BLOCKED: "Déjà soldé (guichet) — imputation impossible",
  REFUND_UNCONFIRMED: "Remboursement non confirmé",
  OTHER: "Autre",
};
const DISC_STATUS_LABELS: Record<string, string> = {
  OPEN: "Ouverte",
  IN_REVIEW: "En traitement",
  RESOLVED: "Résolue",
  IGNORED: "Classée",
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

  const [canManage, canSimulate, canReconcile, canRefund] = await Promise.all([
    userHasSchoolPermission({ ...ctx, permissionKey: "mobilepayments.manage" }),
    userHasSchoolPermission({ ...ctx, permissionKey: "mobilepayments.simulate" }),
    userHasSchoolPermission({ ...ctx, permissionKey: "mobilepayments.reconcile" }),
    userHasSchoolPermission({ ...ctx, permissionKey: "mobilepayments.refund" }),
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

  // G3-D : rapprochement, reversements, anomalies, remboursements.
  const [reconciliations, settlements, discrepancies, refunds, mmPayments] =
    canReconcile || canRefund
      ? await Promise.all([
          listReconciliations(ctx),
          listSettlements(ctx),
          listDiscrepancies(ctx),
          listRefunds(ctx),
          prisma.payment.findMany({
            where: { schoolId: ctx.schoolId, method: "MOBILE_MONEY", status: "VALIDATED" },
            select: {
              id: true, amount: true, receiptNumber: true,
              student: { select: { matricule: true, lastName: true, firstName: true } },
            },
            orderBy: { paidAt: "desc" },
            take: 200,
          }),
        ])
      : [[], [], [], [], []] as const;
  const openDiscrepancies = discrepancies.filter((d) => d.status === "OPEN" || d.status === "IN_REVIEW");

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
                    {i.status === "CONFIRMED" && !i.paymentId ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        Confirmée — imputation en anomalie
                      </span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONES[i.status]}`}>
                        {STATUS_LABELS[i.status]}
                      </span>
                    )}
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
            <div><dt className="text-xs text-zinc-500">Statut</dt><dd>{detail.status === "CONFIRMED" && !detail.paymentId ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Paiement confirmé — imputation en anomalie</span> : <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONES[detail.status]}`}>{STATUS_LABELS[detail.status]}</span>}</dd></div>
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

      {/* ─── G3-D : commissions opérateurs ─── */}
      {canManage && providers.length > 0 && (
        <div className={card} id="commissions">
          <h2 className="text-sm font-semibold text-ink">Commissions opérateurs</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Paramétrage contractuel par fournisseur — fixe + proportionnelle (points de base,
            100&nbsp;=&nbsp;1&nbsp;%). Aucun tarif n&apos;est présumé : seule la saisie compte.
          </p>
          <div className="mt-3 space-y-3">
            {providers.map((p) => (
              <form key={p.id} action={setProviderFeesAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-100 px-3 py-2">
                <input type="hidden" name="providerId" value={p.id} />
                <span className="pb-2 text-sm font-medium">{p.label}</span>
                <label className="text-sm">
                  Fixe (XOF)
                  <input name="feeFixed" type="number" min={0} defaultValue={p.feeFixed} className={input} />
                </label>
                <label className="text-sm">
                  Taux (points de base)
                  <input name="feePercent" type="number" min={0} max={10000} defaultValue={p.feePercent} className={input} />
                </label>
                <label className="text-sm">
                  Supportée par
                  <select name="feeBearer" defaultValue={p.feeBearer} className={input}>
                    <option value="SCHOOL">L&apos;établissement</option>
                    <option value="PAYER">Le payeur</option>
                  </select>
                </label>
                <SubmitButton className={btnNeutral} pendingLabel="…">Enregistrer</SubmitButton>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* ─── G3-D : rapprochement ─── */}
      {canReconcile && (
        <div className={card} id="rapprochement">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">Rapprochement financier</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Brut payé / commission / net attendu par opération confirmée — aucun
                rapprochement automatique sur la seule similitude des montants.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={syncReconciliationAction}>
                <SubmitButton className={btnNeutral} pendingLabel="Balayage…">
                  Synchroniser
                </SubmitButton>
              </form>
              <a href="/app/paiements-mobile/export?type=reconciliations" className={btnNeutral}>
                Export CSV
              </a>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">Élève</th>
                  <th className="py-2 pr-4">Brut</th>
                  <th className="py-2 pr-4">Commission</th>
                  <th className="py-2 pr-4">Net attendu</th>
                  <th className="py-2 pr-4">Reçu</th>
                  <th className="py-2 pr-4">Reversement</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2">Décision</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-4 text-xs">
                      {r.intent.student.matricule} — {r.intent.student.lastName} {r.intent.student.firstName}
                    </td>
                    <td className="py-2 pr-4 font-medium">{fmt(r.grossAmount)}</td>
                    <td className="py-2 pr-4 text-xs">
                      {fmt(r.feeAmount)}{r.feeBearer === "PAYER" && <span className="ml-1 text-zinc-500">(payeur)</span>}
                    </td>
                    <td className="py-2 pr-4">{fmt(r.netExpected)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.payment?.receiptNumber ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.settlement?.reference ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${RECON_TONES[r.status]}`}>
                        {RECON_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="py-2">
                      {(r.status === "PENDING" || r.status === "TO_VERIFY" || r.status === "DISCREPANCY") && (
                        <form action={verifyReconciliationAction} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="reconciliationId" value={r.id} />
                          <input name="note" placeholder="motif" className="h-7 w-28 rounded border border-zinc-300 px-1 text-xs" />
                          <button name="action" value="TO_VERIFY" className="text-xs text-blue-700 hover:underline">À vérifier</button>
                          <button name="action" value="MATCHED" className="text-xs text-emerald-700 hover:underline">Rapprochée</button>
                          <button name="action" value="RESOLVED" className="text-xs text-zinc-600 hover:underline">Clôturer</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {reconciliations.length === 0 && (
                  <tr><td colSpan={8} className="py-4 text-center text-sm text-zinc-500">Aucune opération à rapprocher.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── G3-D : reversements ─── */}
      {canReconcile && (
        <div className={card} id="reversements">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">Reversements</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Reversements groupés déclarés (prestataire ou relevé) — une déclaration
                administrative n&apos;est pas une preuve bancaire.
              </p>
            </div>
            <a href="/app/paiements-mobile/export?type=settlements" className={btnNeutral}>
              Export CSV
            </a>
          </div>
          <form action={declareSettlementAction} className="mt-3 grid gap-3 border-b border-zinc-100 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              Fournisseur
              <select name="providerId" required className={input}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              Référence du reversement
              <input name="reference" required className={input} placeholder="REV-2026-001" />
            </label>
            <label className="text-sm">
              Début de période
              <input name="periodStart" type="date" required className={input} />
            </label>
            <label className="text-sm">
              Fin de période
              <input name="periodEnd" type="date" required className={input} />
            </label>
            <label className="text-sm">
              Net déclaré reçu (vide = non reçu)
              <input name="netDeclared" type="number" min={0} className={input} />
            </label>
            <label className="text-sm">
              Date de réception
              <input name="receivedAt" type="date" className={input} />
            </label>
            <label className="text-sm sm:col-span-2">
              Notes
              <input name="notes" className={input} />
            </label>
            <div className="flex items-end">
              <SubmitButton className={btnPrimary} pendingLabel="Déclaration…">
                Déclarer le reversement
              </SubmitButton>
            </div>
          </form>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">Référence</th>
                  <th className="py-2 pr-4">Prestataire</th>
                  <th className="py-2 pr-4">Période</th>
                  <th className="py-2 pr-4">Brut</th>
                  <th className="py-2 pr-4">Commissions</th>
                  <th className="py-2 pr-4">Net attendu</th>
                  <th className="py-2 pr-4">Net déclaré</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2 pr-4">Opér.</th>
                  <th className="py-2">Clôturer</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {s.reference}
                      <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">déclaré</span>
                    </td>
                    <td className="py-2 pr-4 text-xs">{s.provider.label}</td>
                    <td className="py-2 pr-4 text-xs text-zinc-500">
                      {dt(s.periodStart)} → {dt(s.periodEnd)}
                    </td>
                    <td className="py-2 pr-4">{fmt(s.grossTotal)}</td>
                    <td className="py-2 pr-4">{fmt(s.feeTotal)}</td>
                    <td className="py-2 pr-4">{fmt(s.netExpected)}</td>
                    <td className="py-2 pr-4">{s.netDeclared == null ? "—" : fmt(s.netDeclared)}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${SETTLE_TONES[s.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                        {SETTLE_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs">{s._count.reconciliations}</td>
                    <td className="py-2">
                      {s.status === "DECLARED" && (
                        <form action={completeSettlementAction} className="flex items-center gap-1">
                          <input type="hidden" name="settlementId" value={s.id} />
                          <input name="netDeclared" type="number" min={0} required placeholder="net reçu" className="h-7 w-24 rounded border border-zinc-300 px-1 text-xs" />
                          <SubmitButton className="text-xs text-brand-700 hover:underline" pendingLabel="…">Valider</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {settlements.length === 0 && (
                  <tr><td colSpan={10} className="py-4 text-center text-sm text-zinc-500">Aucun reversement déclaré.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── G3-D : remboursements ─── */}
      {canRefund && (
        <div className={card} id="remboursements">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">Remboursements</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Demandé → approuvé → exécuté (simulé) → confirmé. Une demande n&apos;est
                jamais un remboursement effectué ; aucun prestataire réel n&apos;est appelé.
              </p>
            </div>
            <a href="/app/paiements-mobile/export?type=refunds" className={btnNeutral}>
              Export CSV
            </a>
          </div>
          <form action={createRefundAction} className="mt-3 grid gap-3 border-b border-zinc-100 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              Encaissement Mobile Money
              <select name="paymentId" required className={input}>
                {mmPayments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.receiptNumber ?? p.id.slice(0, 8)} — {p.student.lastName} {p.student.firstName} ({fmt(p.amount)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Montant (XOF)
              <input name="amount" type="number" min={1} required className={input} />
            </label>
            <label className="text-sm sm:col-span-2">
              Motif (obligatoire)
              <input name="reason" required className={input} placeholder="Trop-perçu, annulation…" />
            </label>
            <div className="flex items-end">
              <SubmitButton className={btnPrimary} pendingLabel="Envoi…">
                Déposer la demande
              </SubmitButton>
            </div>
          </form>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">Reçu</th>
                  <th className="py-2 pr-4">Élève</th>
                  <th className="py-2 pr-4">Montant</th>
                  <th className="py-2 pr-4">Motif</th>
                  <th className="py-2 pr-4">Réf.</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-4 font-mono text-xs">{r.payment?.receiptNumber ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs">
                      {r.intent?.student ? `${r.intent.student.matricule} — ${r.intent.student.lastName}` : "—"}
                    </td>
                    <td className="py-2 pr-4 font-medium">{fmt(r.amount)}</td>
                    <td className="py-2 pr-4 text-xs">{r.reason}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.providerRef ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${REFUND_TONES[r.status]}`}>
                        {REFUND_LABELS[r.status]}
                      </span>
                      {r.requestedBy?.id && r.requestedBy.id === r.approvedBy?.id && (
                        <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                          auto-approuvée (mono-admin)
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.status === "REQUESTED" && (
                          <>
                            <form action={approveRefundAction}>
                              <input type="hidden" name="refundId" value={r.id} />
                              <SubmitButton className="text-xs text-emerald-700 hover:underline" pendingLabel="…">Approuver</SubmitButton>
                            </form>
                            <form action={rejectRefundAction} className="flex items-center gap-1">
                              <input type="hidden" name="refundId" value={r.id} />
                              <input name="reason" placeholder="motif du refus" className="h-7 w-24 rounded border border-zinc-300 px-1 text-xs" />
                              <SubmitButton className="text-xs text-red-700 hover:underline" pendingLabel="…">Refuser</SubmitButton>
                            </form>
                          </>
                        )}
                        {r.status === "APPROVED" && (
                          <form action={executeRefundAction}>
                            <input type="hidden" name="refundId" value={r.id} />
                            <SubmitButton className="text-xs text-violet-700 hover:underline" pendingLabel="…">Exécuter (simulé)</SubmitButton>
                          </form>
                        )}
                        {r.status === "EXECUTED" && (
                          <form action={confirmRefundAction}>
                            <input type="hidden" name="refundId" value={r.id} />
                            <SubmitButton className="text-xs text-emerald-700 hover:underline" pendingLabel="…">Confirmer</SubmitButton>
                          </form>
                        )}
                        {(r.status === "REQUESTED" || r.status === "APPROVED") && (
                          <form action={cancelRefundAction}>
                            <input type="hidden" name="refundId" value={r.id} />
                            <SubmitButton className="text-xs text-zinc-600 hover:underline" pendingLabel="…">Annuler</SubmitButton>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {refunds.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-sm text-zinc-500">Aucun remboursement.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── G3-D : anomalies financières ─── */}
      {canReconcile && (
        <div className={card} id="anomalies">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Anomalies financières
                {openDiscrepancies.length > 0 && (
                  <span className="ml-2 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-800">
                    {openDiscrepancies.length} ouverte{openDiscrepancies.length > 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                File de traitement — chaque décision est tracée avec acteur, motif et
                horodatage. Aucune correction financière silencieuse.
              </p>
            </div>
            <a href="/app/paiements-mobile/export?type=discrepancies" className={btnNeutral}>
              Export CSV
            </a>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4">Attendu</th>
                  <th className="py-2 pr-4">Constaté</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2">Décision</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map((d) => (
                  <tr key={d.id} className="border-t border-zinc-100 align-top">
                    <td className="py-2 pr-4 text-xs font-medium">{DISC_LABELS[d.type] ?? d.type}</td>
                    <td className="py-2 pr-4 text-xs text-zinc-600">
                      {d.description}
                      {(d.history as { action: string; note: string }[] | null)?.length ? (
                        <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-400">
                          {(d.history as { action: string; note: string }[]).map((h, i) => (
                            <li key={i}>→ {h.action} : {h.note}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-xs">{d.expectedAmount == null ? "—" : fmt(d.expectedAmount)}</td>
                    <td className="py-2 pr-4 text-xs">{d.actualAmount == null ? "—" : fmt(d.actualAmount)}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${d.status === "OPEN" ? "bg-red-50 text-red-800" : d.status === "IN_REVIEW" ? "bg-blue-50 text-blue-800" : "bg-zinc-100 text-zinc-600"}`}>
                        {DISC_STATUS_LABELS[d.status]}
                      </span>
                    </td>
                    <td className="py-2">
                      {(d.status === "OPEN" || d.status === "IN_REVIEW") && (
                        <form action={decideDiscrepancyAction} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="discrepancyId" value={d.id} />
                          <input name="note" required placeholder="motif (obligatoire)" className="h-7 w-32 rounded border border-zinc-300 px-1 text-xs" />
                          <button name="action" value="IN_REVIEW" className="text-xs text-blue-700 hover:underline">Prendre en charge</button>
                          <button name="action" value="RESOLVED" className="text-xs text-emerald-700 hover:underline">Résoudre</button>
                          <button name="action" value="IGNORED" className="text-xs text-zinc-600 hover:underline">Classer</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {discrepancies.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-sm text-zinc-500">Aucune anomalie.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
