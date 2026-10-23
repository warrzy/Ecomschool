/**
 * G3-A — Intentions de paiement Mobile Money.
 *
 * Un PaymentIntent représente une demande de paiement EN COURS auprès
 * d'un prestataire — jamais un encaissement. Seule une confirmation
 * fiable, suivie de `recordPayment` (moteur financier existant), crée
 * un Payment comptable. Les confirmations SANDBOX sont des simulations
 * marquées `simulated:true` et ne créent aucun encaissement réel.
 *
 * Machine à états :
 *   CREATED  → PENDING | FAILED (initiation)
 *   PENDING  → CONFIRMED | FAILED | EXPIRED | CANCELLED
 *            | CONFIRMED_PENDING_POSTING (confirmation fiable reçue,
 *              encaissement comptable en attente — ex. jour clôturé)
 *   CONFIRMED_PENDING_POSTING → CONFIRMED (comptabilisation réussie)
 *   CONFIRMED | FAILED | EXPIRED | CANCELLED : états terminaux.
 * Toute transition hors matrice est rejetée ; le montant est immuable.
 *
 * Idempotence : `idempotencyKey` unique par école — même clé + même
 * contenu → même intention ; même clé + contenu différent → conflit.
 * Au plus une intention active (CREATED/PENDING/…PENDING_POSTING) par
 * élève et année, garantie par verrou consultatif + contrôle en
 * transaction. La confirmation est sérialisée par un verrou
 * `mm-confirm:{intentId}` : les confirmations répétées ou simultanées
 * ne produisent jamais deux encaissements.
 */
import { PaymentMethod, type PaymentIntentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { recordPayment } from "@/lib/services/finance/payments";
import { notifyUsers } from "@/lib/services/notifications";
import {
  ensureDiscrepancy,
  ensureReconciliation,
  notifyReconcileAdmins,
} from "./reconciliation";
import { getProviderAdapter, checkLiveExecution, resolveProviderSecret, ProviderTimeoutError } from "./providers";
import type { AdapterCallContext, PaymentProviderAdapter, SandboxScript } from "./providers";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const ACTIVE_STATUSES = ["CREATED", "PENDING", "CONFIRMED_PENDING_POSTING"] as const;
const MIN_INTENT_TTL_MIN = 15;
const DEFAULT_INTENT_TTL_MIN = 24 * 60;

/**
 * Marqueur serveur « simulé » — déterminé côté serveur uniquement,
 * jamais par un paramètre client. Une intention est simulée si son
 * fournisseur est SANDBOX, si son adaptateur est le simulateur, ou si
 * le script sandbox a été figé à la création. Aucune bascule de mode
 * ou de configuration ne peut la transformer rétroactivement en
 * intention LIVE.
 */
function isSimulated(i: {
  sandboxScript: unknown;
  provider: { mode: string; code: string };
}): boolean {
  return i.provider.mode === "SANDBOX" || i.provider.code === "SANDBOX" || i.sandboxScript != null;
}

/**
 * Contexte d'appel pour un prestataire LIVE : identifiants résolus en
 * mémoire + config non-secrète + `env: "live"` (choisi côté serveur,
 * jamais par l'admin). Ne pas appeler avant checkLiveExecution —
 * la résolution des secrets lève si la référence est absente.
 */
export function liveCallContext(provider: {
  mode: string;
  config?: unknown;
  credentialsRef?: string | null;
}): AdapterCallContext | undefined {
  if (provider.mode !== "LIVE") return undefined;
  return {
    credentials: resolveProviderSecret(provider, "credentials"),
    config: {
      ...((provider.config as Record<string, unknown> | null) ?? {}),
      env: "live",
    },
  };
}

// ─── Fournisseurs ───────────────────────────────────────────────────

export async function createPaymentProvider(
  ctx: Ctx,
  input: { code: string; label: string; mode: "SANDBOX" | "LIVE"; minAmount?: number; maxAmount?: number | null },
): Promise<Res<{ id: string }>> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,30}$/.test(code)) return { ok: false, error: "INVALID_INPUT" };
  if (!input.label.trim()) return { ok: false, error: "INVALID_INPUT" };
  if (input.mode === "LIVE") {
    // Un prestataire LIVE exige un adaptateur enregistré — et restera
    // bloqué à l'initiation tant que liveEnabled n'est pas activé.
    if (!getProviderAdapter(code)) return { ok: false, error: "PROVIDER_UNAVAILABLE" };
    // L'adaptateur SANDBOX ne doit jamais tourner en mode LIVE.
    if (code === "SANDBOX") return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.mode === "SANDBOX" && code !== "SANDBOX") {
    return { ok: false, error: "INVALID_INPUT" };
  }
  try {
    const provider = await prisma.paymentProvider.create({
      data: {
        schoolId: ctx.schoolId,
        code,
        label: input.label.trim(),
        mode: input.mode,
        minAmount: input.minAmount ?? 100,
        maxAmount: input.maxAmount ?? null,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "payment_provider.created", entity: "PaymentProvider", entityId: provider.id,
      metadata: { code, mode: input.mode },
    });
    return { ok: true, data: provider };
  } catch {
    return { ok: false, error: "ALREADY_EXISTS" };
  }
}

export async function setPaymentProviderStatus(
  ctx: Ctx, providerId: string, status: "ACTIVE" | "ARCHIVED",
): Promise<Res<true>> {
  const provider = await prisma.paymentProvider.findFirst({
    where: { id: providerId, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!provider) return { ok: false, error: "NOT_FOUND" };
  if (provider.status === status) return { ok: true, data: true };
  await prisma.paymentProvider.update({
    where: { id: provider.id },
    data: { status },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "payment_provider.status", entity: "PaymentProvider", entityId: provider.id,
    metadata: { from: provider.status, to: status },
  });
  return { ok: true, data: true };
}

/**
 * G3-E — Activation/désactivation contrôlée du mode réel. Idempotent ;
 * `enable` exige un adaptateur enregistré et un prestataire en mode
 * LIVE ; l'audit conserve l'acteur (traçabilité de la décision).
 */
export async function setProviderLive(
  ctx: Ctx,
  providerId: string,
  enabled: boolean,
): Promise<Res<true>> {
  const provider = await prisma.paymentProvider.findFirst({
    where: { id: providerId, schoolId: ctx.schoolId },
    select: { id: true, code: true, mode: true, liveEnabled: true },
  });
  if (!provider) return { ok: false, error: "NOT_FOUND" };
  if (provider.liveEnabled === enabled) return { ok: true, data: true };
  if (enabled) {
    if (provider.mode !== "LIVE") return { ok: false, error: "INVALID_STATE" };
    if (!getProviderAdapter(provider.code)) {
      return { ok: false, error: "PROVIDER_UNAVAILABLE" };
    }
  }
  await prisma.paymentProvider.update({
    where: { id: provider.id },
    data: enabled
      ? { liveEnabled: true, liveEnabledAt: new Date(), liveEnabledById: ctx.userId }
      : { liveEnabled: false, liveEnabledAt: null, liveEnabledById: null },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: enabled ? "payment_provider.live_enabled" : "payment_provider.live_disabled",
    entity: "PaymentProvider", entityId: provider.id,
    metadata: { code: provider.code },
  });
  return { ok: true, data: true };
}

/**
 * Active les remboursements via l'API prestataire — uniquement si
 * l'adaptateur déclare la capacité ET si le contrat le prévoit
 * (validation administrative tracée).
 */
export async function setProviderRefundsEnabled(
  ctx: Ctx,
  providerId: string,
  enabled: boolean,
): Promise<Res<true>> {
  const provider = await prisma.paymentProvider.findFirst({
    where: { id: providerId, schoolId: ctx.schoolId },
    select: { id: true, code: true, refundsEnabled: true },
  });
  if (!provider) return { ok: false, error: "NOT_FOUND" };
  if (provider.refundsEnabled === enabled) return { ok: true, data: true };
  if (enabled) {
    const adapter = getProviderAdapter(provider.code);
    if (!adapter?.capabilities.refunds || !adapter.initiateRefund) {
      return { ok: false, error: "REFUND_UNSUPPORTED" };
    }
  }
  await prisma.paymentProvider.update({
    where: { id: provider.id },
    data: { refundsEnabled: enabled },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: enabled ? "payment_provider.refunds_enabled" : "payment_provider.refunds_disabled",
    entity: "PaymentProvider", entityId: provider.id,
    metadata: { code: provider.code },
  });
  return { ok: true, data: true };
}

/**
 * Trace une rotation de secrets prestataire. La valeur nouvelle est
 * posée dans l'environnement (procédure ops, hors application) — la
 * base ne fait que consigner la date et l'acteur.
 */
export async function markProviderCredentialsRotated(
  ctx: Ctx,
  providerId: string,
): Promise<Res<true>> {
  const provider = await prisma.paymentProvider.findFirst({
    where: { id: providerId, schoolId: ctx.schoolId },
    select: { id: true, code: true },
  });
  if (!provider) return { ok: false, error: "NOT_FOUND" };
  await prisma.paymentProvider.update({
    where: { id: provider.id },
    data: { credentialsRotatedAt: new Date() },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "payment_provider.credentials_rotated",
    entity: "PaymentProvider", entityId: provider.id,
    metadata: { code: provider.code },
  });
  return { ok: true, data: true };
}

export async function listPaymentProviders(ctx: Ctx) {
  // credentialsRef / webhookSecretRef exclus : noms d'env internes,
  // jamais utiles côté navigateur.
  return prisma.paymentProvider.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, schoolId: true, code: true, label: true,
      mode: true, status: true, minAmount: true, maxAmount: true,
      merchantRef: true, createdAt: true, updatedAt: true,
      feeFixed: true, feePercent: true, feeBearer: true,
      liveEnabled: true, liveEnabledAt: true, refundsEnabled: true,
      credentialsRotatedAt: true,
    },
  });
}

// ─── Création d'intention ───────────────────────────────────────────

function fingerprint(i: {
  studentId: string; academicYearId: string; amount: number; currency: string;
  providerId: string; feeInstallmentId?: string | null; channel: string;
}) {
  return [
    i.studentId, i.academicYearId, i.amount, i.currency,
    i.providerId, i.feeInstallmentId ?? "", i.channel,
  ].join("|");
}

export async function createPaymentIntent(
  ctx: Ctx,
  input: {
    studentId: string;
    academicYearId: string;
    amount: number;
    currency: string;
    providerId: string;
    feeInstallmentId?: string | null;
    payerPhone?: string | null;
    channel?: "CASHIER_DESK" | "PARENT_PORTAL" | "ADMIN_TEST";
    allocations?: { installmentId: string; amount: number }[];
    idempotencyKey?: string;
    /** Scénario du simulateur — ignoré pour les prestataires réels. */
    sandboxOutcome?: SandboxScript["outcome"];
    sandboxAfterChecks?: number;
  },
): Promise<Res<{ intentId: string; providerRef: string; replayed: boolean; active: boolean }>> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }
  if (input.currency !== "XOF") return { ok: false, error: "INVALID_CURRENCY" };

  const [student, year, provider] = await Promise.all([
    prisma.student.findFirst({
      where: { id: input.studentId, schoolId: ctx.schoolId },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.paymentProvider.findFirst({
      where: { id: input.providerId, schoolId: ctx.schoolId },
    }),
  ]);
  if (!student || !year) return { ok: false, error: "NOT_FOUND" };
  if (!provider) return { ok: false, error: "UNKNOWN_PROVIDER" };
  if (provider.status !== "ACTIVE") return { ok: false, error: "PROVIDER_INACTIVE" };
  if (input.amount < provider.minAmount) return { ok: false, error: "INVALID_AMOUNT" };
  if (provider.maxAmount !== null && input.amount > provider.maxAmount) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }

  const adapter = getProviderAdapter(provider.code);
  // G3-E — prestataire LIVE : verrou global serveur + activation
  // contrôlée + adaptateur + secrets requis avant toute initiation.
  if (provider.mode === "LIVE") {
    const liveErr = checkLiveExecution(provider, adapter);
    if (liveErr) return { ok: false, error: liveErr };
  }
  if (!adapter) return { ok: false, error: "UNKNOWN_PROVIDER" };

  if (input.feeInstallmentId) {
    const inst = await prisma.feeInstallment.findFirst({
      where: { id: input.feeInstallmentId, charge: { schoolId: ctx.schoolId, studentId: student.id } },
      select: { id: true },
    });
    if (!inst) return { ok: false, error: "NOT_FOUND" };
  }

  const channel = input.channel ?? "ADMIN_TEST";
  const key = input.idempotencyKey?.trim() || `mmi-${crypto.randomUUID()}`;
  const fp = fingerprint({ ...input, feeInstallmentId: input.feeInstallmentId ?? null, channel });

  // Rejeu : même clé → même intention si même contenu, conflit sinon.
  const existing = await prisma.paymentIntent.findUnique({
    where: { schoolId_idempotencyKey: { schoolId: ctx.schoolId, idempotencyKey: key } },
  });
  if (existing) {
    if (fingerprint(existing) === fp) {
      return {
        ok: true,
        data: {
          intentId: existing.id,
          providerRef: existing.providerRef ?? "",
          replayed: true,
          active: ACTIVE_STATUSES.includes(existing.status as never),
        },
      };
    }
    return { ok: false, error: "IDEMPOTENCY_CONFLICT" };
  }

  const script: SandboxScript | null =
    provider.mode === "SANDBOX"
      ? {
          outcome: input.sandboxOutcome ?? "PENDING",
          afterChecks: input.sandboxAfterChecks ?? 2,
          checks: 0,
        }
      : null;

  const ttlMin = Math.max(input.sandboxOutcome === "LATE" ? MIN_INTENT_TTL_MIN : DEFAULT_INTENT_TTL_MIN, MIN_INTENT_TTL_MIN);
  const expiresAt = new Date(Date.now() + ttlMin * 60_000);

  // Une seule intention active PAR OPÉRATION MÉTIER — (élève, année,
  // échéance cible). Les opérations indépendantes (autre échéance,
  // paiement partiel après confirmation, nouvelle tentative après
  // échec/expiration/annulation) restent autorisées ; l'index partiel
  // `payment_intent_one_active_per_op` fait foi en base.
  const opKey = `${student.id}:${year.id}:${input.feeInstallmentId ?? ""}`;
  let intentId = "";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"mm-intent:" + opKey}))`;
      const activeCount = await tx.paymentIntent.count({
        where: {
          schoolId: ctx.schoolId,
          studentId: student.id,
          academicYearId: year.id,
          feeInstallmentId: input.feeInstallmentId ?? null,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });
      if (activeCount > 0) throw new Error("ACTIVE_INTENT_EXISTS");
      const intent = await tx.paymentIntent.create({
        data: {
          schoolId: ctx.schoolId,
          studentId: student.id,
          academicYearId: year.id,
          feeInstallmentId: input.feeInstallmentId ?? null,
          providerId: provider.id,
          initiatedById: ctx.userId,
          amount: input.amount,
          currency: input.currency,
          idempotencyKey: key,
          channel,
          payerPhone: input.payerPhone?.trim() || null,
          sandboxScript: script ?? undefined,
          allocations: input.allocations ?? undefined,
          expiresAt,
        },
        select: { id: true },
      });
      intentId = intent.id;
      await logAudit({
        actorId: ctx.userId, schoolId: ctx.schoolId,
        action: "payment_intent.created", entity: "PaymentIntent", entityId: intent.id,
        metadata: {
          amount: input.amount, currency: input.currency, provider: provider.code,
          channel, simulated: provider.mode === "SANDBOX" || provider.code === "SANDBOX",
        },
        tx,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ACTIVE_INTENT_EXISTS") return { ok: false, error: "ACTIVE_INTENT_EXISTS" };
    // Doublon de clé injecté par une requête concurrente → rejeu standard.
    const again = await prisma.paymentIntent.findUnique({
      where: { schoolId_idempotencyKey: { schoolId: ctx.schoolId, idempotencyKey: key } },
    });
    if (again && fingerprint(again) === fp) {
      return { ok: true, data: { intentId: again.id, providerRef: again.providerRef ?? "", replayed: true, active: true } };
    }
    if (again) return { ok: false, error: "IDEMPOTENCY_CONFLICT" };
    // Conflit sur l'index partiel (même opération déjà active) — la
    // contrainte de base fait foi face à une course résiduelle.
    const active = await prisma.paymentIntent.count({
      where: {
        schoolId: ctx.schoolId,
        studentId: student.id,
        academicYearId: year.id,
        feeInstallmentId: input.feeInstallmentId ?? null,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
    if (active > 0) return { ok: false, error: "ACTIVE_INTENT_EXISTS" };
    return { ok: false, error: "CREATE_FAILED" };
  }

  // Initiation prestataire (hors transaction — appel externe simulé).
  return initiateIntent(
    ctx, intentId, adapter, provider.mode === "SANDBOX",
    liveCallContext(provider),
  );
}

async function initiateIntent(
  ctx: Ctx, intentId: string, adapter: PaymentProviderAdapter, simulated: boolean,
  call?: AdapterCallContext,
): Promise<Res<{ intentId: string; providerRef: string; replayed: boolean; active: boolean }>> {
  const intent = await prisma.paymentIntent.findFirstOrThrow({
    where: { id: intentId, schoolId: ctx.schoolId },
  });
  try {
    const res = await adapter.initiate({
      intentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      payerPhone: intent.payerPhone,
      sandboxScript: (intent.sandboxScript as SandboxScript | null) ?? null,
      call,
    });
    await prisma.$transaction(async (tx) => {
      const upd = await tx.paymentIntent.updateMany({
        where: { id: intent.id, status: "CREATED" },
        data: { status: "PENDING", providerRef: res.providerRef },
      });
      if (upd.count === 0) throw new Error("INVALID_STATE");
      await tx.paymentTransaction.create({
        data: {
          intentId: intent.id, schoolId: ctx.schoolId,
          kind: "INITIATE",
          providerTxId: res.providerRef,
          payload: { status: "PENDING", instructions: res.instructions ?? null, simulated },
        },
      });
    });
    return { ok: true, data: { intentId: intent.id, providerRef: res.providerRef, replayed: false, active: true } };
  } catch (e) {
    const timeout = e instanceof ProviderTimeoutError;
    const reason = timeout ? "TIMEOUT" : "INITIATE_FAILED";
    await prisma.$transaction(async (tx) => {
      await tx.paymentIntent.updateMany({
        where: { id: intent.id, status: "CREATED" },
        data: { status: "FAILED", failureReason: reason },
      });
      await tx.paymentTransaction.create({
        data: {
          intentId: intent.id, schoolId: ctx.schoolId,
          kind: "INITIATE",
          rawStatus: reason,
          payload: { status: "FAILED", simulated },
        },
      });
    });
    return { ok: false, error: timeout ? "PROVIDER_TIMEOUT" : "INITIATE_FAILED" };
  }
}

// ─── Consultation de statut ─────────────────────────────────────────

export async function pollPaymentIntent(
  ctx: Ctx, intentId: string,
): Promise<Res<{ status: string; providerTxId?: string }>> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, schoolId: ctx.schoolId },
    include: { provider: true },
  });
  if (!intent) return { ok: false, error: "NOT_FOUND" };
  if (intent.status !== "PENDING") {
    return { ok: true, data: { status: intent.status } };
  }
  if (!intent.providerRef) return { ok: false, error: "INVALID_STATE" };

  const adapter = getProviderAdapter(intent.provider.code);
  // G3-E — la consultation de statut d'un prestataire LIVE est un
  // appel externe : verrou global + activation + adaptateur + secrets.
  // Le refus laisse l'intention PENDING — aucune preuve n'est perdue.
  if (intent.provider.mode === "LIVE") {
    const liveErr = checkLiveExecution(intent.provider, adapter);
    if (liveErr) return { ok: false, error: liveErr };
  }
  if (!adapter) return { ok: false, error: "UNKNOWN_PROVIDER" };

  const script = (intent.sandboxScript as SandboxScript | null) ?? null;
  if (script) script.checks = (script.checks ?? 0) + 1;

  let res;
  try {
    res = await adapter.checkStatus(
      intent.providerRef, script, liveCallContext(intent.provider),
    );
  } catch (e) {
    if (e instanceof ProviderTimeoutError) {
      await prisma.paymentTransaction.create({
        data: {
          intentId: intent.id, schoolId: ctx.schoolId,
          kind: "STATUS_CHECK",
          providerTxId: intent.providerRef,
          rawStatus: "TIMEOUT",
          payload: { status: "FAILED" },
        },
      });
      return { ok: false, error: "PROVIDER_TIMEOUT" };
    }
    throw e;
  }

  if (script) {
    await prisma.paymentIntent.updateMany({
      where: { id: intent.id }, data: { sandboxScript: script as unknown as Prisma.InputJsonValue },
    });
  }
  await prisma.paymentTransaction.create({
    data: {
      intentId: intent.id, schoolId: ctx.schoolId,
      kind: "STATUS_CHECK",
      providerTxId: res.providerTxId ?? intent.providerRef,
      rawStatus: res.rawStatus ?? null,
      payload: {
        status: res.status,
        reason: res.reason ?? null,
        simulated: intent.provider.mode === "SANDBOX",
      },
    },
  });

  switch (res.status) {
    case "SUCCESS": {
      // Contrôle du montant/devise renvoyés par le prestataire : une
      // divergence bloque la confirmation et ouvre une anomalie —
      // jamais de comptabilisation d'un montant non attendu.
      const amountMismatch = res.amount != null && res.amount !== intent.amount;
      const currencyMismatch = res.currency != null && res.currency !== intent.currency;
      if (amountMismatch || currencyMismatch) {
        await ensureDiscrepancy(prisma, {
          schoolId: ctx.schoolId,
          type: "AMOUNT_MISMATCH",
          intentId: intent.id,
          expectedAmount: intent.amount,
          actualAmount: res.amount ?? null,
          description: `Statut SUCCESS avec montant/devise divergents (${res.amount ?? "?"} ${res.currency ?? "?"} vs attendu ${intent.amount} ${intent.currency}) — confirmation bloquée.`,
        });
        await notifyReconcileAdmins(ctx.schoolId, {
          title: "Confirmation prestataire incohérente",
          body: `Intention ${intent.id.slice(0, 8)}… : SUCCESS reçu mais montant/devise divergent — aucune comptabilisation.`,
          link: `/app/paiements-mobile?intent=${intent.id}`,
        });
        return { ok: false, error: "AMOUNT_MISMATCH" };
      }
      // Même mécanisme central que les webhooks (G3-B) : la
      // comptabilisation est tentée pour les intentions LIVE ; la
      // barrière `isSimulated` garde le sandbox en simulation.
      return confirmIntent(ctx, intent.id, {
        providerTxId: res.providerTxId,
        postToLedger: !isSimulated(intent),
      });
    }
    case "FAILED":
      await transition(ctx, intent.id, ["PENDING"], "FAILED", {
        failureReason: res.reason ?? "REFUSED", providerTxId: res.providerTxId,
      });
      return { ok: true, data: { status: "FAILED" } };
    case "EXPIRED":
      await transition(ctx, intent.id, ["PENDING"], "EXPIRED", {
        failureReason: res.reason ?? "EXPIRED", providerTxId: res.providerTxId,
      });
      return { ok: true, data: { status: "EXPIRED" } };
    default:
      return { ok: true, data: { status: "PENDING" } };
  }
}

// ─── Confirmation (point d'entrée unique) ──────────────────────────

/**
 * Confirme une intention — appelé uniquement après vérification fiable
 * (statut prestataire consulté ou, en G3-B, webhook signé vérifié).
 * Sérialisé par verrou : confirmations répétées/simultanées → no-op
 * idempotent. `postToLedger` déclenche `recordPayment` (moteur F3) —
 * refusé pour toute intention simulée sauf `__allowSandboxPosting`,
 * indicateur INTERNE réservé aux recettes sur fixtures isolées et
 * jamais positionné par les actions serveur exposées.
 */
export async function confirmIntent(
  ctx: Ctx,
  intentId: string,
  opts: { providerTxId?: string; postToLedger?: boolean; __allowSandboxPosting?: boolean } = {},
): Promise<Res<{ status: string; paymentId?: string; already?: boolean }>> {
  // Phase 1 — verrou + transition d'état.
  const first = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"mm-confirm:" + intentId}))`;
    const intent = await tx.paymentIntent.findFirst({
      where: { id: intentId, schoolId: ctx.schoolId },
      include: { provider: true },
    });
    if (!intent) throw new Error("NOT_FOUND");
    if (intent.status === "CONFIRMED") {
      return { intent, already: true as const };
    }
    const simulated = isSimulated(intent);
    if (opts.postToLedger && simulated && !opts.__allowSandboxPosting) {
      throw new Error("POSTING_SANDBOX_FORBIDDEN");
    }
    if (intent.status !== "PENDING" && intent.status !== "CONFIRMED_PENDING_POSTING") {
      throw new Error("INVALID_STATE");
    }
    const target =
      opts.postToLedger && !intent.paymentId
        ? "CONFIRMED_PENDING_POSTING"
        : intent.status === "CONFIRMED_PENDING_POSTING"
          ? "CONFIRMED_PENDING_POSTING"
          : "CONFIRMED";
    const upd = await tx.paymentIntent.updateMany({
      where: { id: intent.id, status: intent.status },
      data: {
        status: target as never,
        confirmedAt: new Date(),
        providerTxId: opts.providerTxId ?? intent.providerTxId,
      },
    });
    if (upd.count === 0) throw new Error("CONCURRENT");
    await tx.paymentTransaction.create({
      data: {
        intentId: intent.id, schoolId: ctx.schoolId,
        kind: "CONFIRM",
        providerTxId: opts.providerTxId ?? intent.providerTxId ?? intent.providerRef,
        payload: {
          status: target,
          simulated,
          postToLedger: opts.postToLedger === true,
        },
      },
    });
    await logAudit({
      actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "payment_intent.confirmed", entity: "PaymentIntent", entityId: intent.id,
      metadata: {
        amount: intent.amount,
        providerTxId: opts.providerTxId ?? null,
        simulated,
        postToLedger: opts.postToLedger === true,
      },
      tx,
    });
    return { intent, already: false as const };
  }).catch((e: Error) => ({ error: e.message }));

  if ("error" in first) {
    return { ok: false, error: first.error === "CONCURRENT" ? "CONCURRENT" : first.error };
  }
  if (first.already) {
    return { ok: true, data: { status: "CONFIRMED", paymentId: first.intent.paymentId ?? undefined, already: true } };
  }

  const intent = first.intent;

  // Phase 2 — comptabilisation via le moteur existant (hors transaction).
  if (opts.postToLedger && !intent.paymentId) {
    return postConfirmedIntent(ctx, intent.id, {
      __allowSandboxPosting: opts.__allowSandboxPosting,
    });
  }

  // G3-D : toute confirmation matérialise son rapprochement
  // (brut/frais/net attendu), même sans comptabilisation.
  await ensureReconciliation(prisma, intent.id).catch(() => null);

  // Confirmation simulée ou sans comptabilisation : notification.
  await notifyUsers({
    schoolId: ctx.schoolId,
    userIds: [ctx.userId],
    type: "ADMIN_MESSAGE",
    title: "Paiement Mobile Money confirmé (simulation)",
    body: `${intent.amount} ${intent.currency} — réf. ${opts.providerTxId ?? intent.providerRef ?? intent.id}`,
    link: "/app/paiements-mobile",
  });
  return { ok: true, data: { status: "CONFIRMED" } };
}

/**
 * Comptabilise une intention CONFIRMED_PENDING_POSTING via
 * `recordPayment` — réutilise le moteur F3 (répartition, reçu,
 * idempotence `mm:{intentId}`). Idempotent : un second appel retourne
 * l'encaissement existant.
 */
export async function postConfirmedIntent(
  ctx: Ctx,
  intentId: string,
  opts: { __allowSandboxPosting?: boolean } = {},
): Promise<Res<{ status: string; paymentId?: string; already?: boolean }>> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, schoolId: ctx.schoolId },
    include: { provider: { select: { mode: true, code: true } } },
  });
  if (!intent) return { ok: false, error: "NOT_FOUND" };
  if (intent.status === "CONFIRMED" && intent.paymentId) {
    return { ok: true, data: { status: "CONFIRMED", paymentId: intent.paymentId, already: true } };
  }
  // CONFIRMED_PENDING_POSTING : flux normal. CONFIRMED sans paymentId :
  // une anomalie d'imputation passée — relançable si le solde s'est
  // libéré (ex. encaissement guichet annulé).
  const retryableConfirmed = intent.status === "CONFIRMED" && !intent.paymentId;
  if (intent.status !== "CONFIRMED_PENDING_POSTING" && !retryableConfirmed) {
    return { ok: false, error: "INVALID_STATE" };
  }
  // Barrière serveur : une intention simulée ne devient jamais un
  // encaissement opérationnel (sauf recette interne explicitée).
  if (isSimulated(intent) && !opts.__allowSandboxPosting) {
    return { ok: false, error: "POSTING_SANDBOX_FORBIDDEN" };
  }

  // Idempotence d'abord : un crash après recordPayment a pu laisser
  // l'encaissement `mm:{intentId}` créé sans rattachement — le solde
  // est alors déjà consommé par CE paiement ; on le rattache avant
  // tout recalcul de solde.
  const existingPay = await prisma.payment.findFirst({
    where: { schoolId: ctx.schoolId, idempotencyKey: `mm:${intent.id}` },
    select: { id: true, receiptNumber: true },
  });
  let pay: Awaited<ReturnType<typeof recordPayment>>;
  if (existingPay?.receiptNumber) {
    pay = { ok: true, result: { id: existingPay.id, receiptNumber: existingPay.receiptNumber } };
  } else {
    // G3-D — risque guichet : entre l'émission de l'intention et sa
    // confirmation, un encaissement au guichet a pu consommer tout ou
    // partie du solde. `recordPayment` bloque le dépassement du solde
    // GLOBAL de l'élève, mais une allocation explicite peut encore
    // dépasser le reste à payer de SON échéance. On recalcule avant
    // toute imputation : si le montant n'est plus imputable, la preuve
    // de confirmation est conservée (statut CONFIRMED), aucune double
    // allocation n'est créée, aucune créance n'est inventée — la
    // divergence part dans la file d'anomalies pour traitement
    // administratif (remboursement ou régularisation manuelle).
    const allocatable = await checkPostingBalance(ctx.schoolId, intent);
    if (!allocatable.ok) {
      await blockUnallocatableIntent(ctx, intent, allocatable.detail);
      return { ok: false, error: "OVERPAYMENT_BLOCKED" };
    }
    pay = await recordPayment(
      { userId: intent.initiatedById ?? ctx.userId, schoolId: ctx.schoolId },
      {
        studentId: intent.studentId,
        academicYearId: intent.academicYearId,
        amount: intent.amount,
        method: PaymentMethod.MOBILE_MONEY,
        reference: intent.providerTxId ?? intent.providerRef ?? intent.id,
        idempotencyKey: `mm:${intent.id}`,
        allocations: (intent.allocations as { installmentId: string; amount: number }[] | null) ?? undefined,
      },
    );
  }

  if (pay.ok) {
    // Le paiement existe déjà (rejeu idempotent de `mm:{intentId}`) ou
    // vient d'être créé — dans les deux cas on le rattache.
    await prisma.$transaction(async (tx) => {
      const upd = await tx.paymentIntent.updateMany({
        where: { id: intent.id, paymentId: null },
        data: { status: "CONFIRMED", paymentId: pay.result.id },
      });
      if (upd.count === 0) return;
      await tx.paymentTransaction.create({
        data: {
          intentId: intent.id, schoolId: ctx.schoolId,
          kind: "POSTING",
          providerTxId: intent.providerTxId ?? intent.providerRef,
          payload: { status: "CONFIRMED", paymentId: pay.result.id, receiptNumber: pay.result.receiptNumber },
        },
      });
      await logAudit({
        actorId: ctx.userId, schoolId: ctx.schoolId,
        action: "payment_intent.posted", entity: "PaymentIntent", entityId: intent.id,
        metadata: { paymentId: pay.result.id, receiptNumber: pay.result.receiptNumber },
        tx,
      });
      // G3-D : le rapprochement brut/frais/net est matérialisé dès
      // l'encaissement confirmé.
      await ensureReconciliation(tx, intent.id);
    });
    return { ok: true, data: { status: "CONFIRMED", paymentId: pay.result.id } };
  }

  // Solde global épuisé entre l'émission et la confirmation (ex. le
  // guichet a tout encaissé) : même traitement que la garde pré-posting
  // — la confirmation reste, l'imputation part en anomalie.
  if (pay.error === "OVERPAYMENT") {
    await blockUnallocatableIntent(ctx, intent, {
      kind: "GLOBAL",
      message: `solde global élève épuisé (recordPayment: ${pay.error})`,
    });
    return { ok: false, error: "OVERPAYMENT_BLOCKED" };
  }

  // Jour clôturé : l'intention reste CONFIRMED_PENDING_POSTING —
  // l'encaissement n'est pas perdu, il sera reposté (cron ou action).
  if (pay.error === "CLOSED_DAY") {
    await prisma.paymentTransaction.create({
      data: {
        intentId: intent.id, schoolId: ctx.schoolId,
        kind: "POSTING",
        providerTxId: intent.providerTxId ?? intent.providerRef,
        payload: { status: "DEFERRED_CLOSED_DAY" },
      },
    });
    return { ok: true, data: { status: "CONFIRMED_PENDING_POSTING" } };
  }
  // Refus métier (OVERPAYMENT, NOT_FOUND…) : l'intention reste en
  // attente de comptabilisation avec la raison tracée — pas de perte
  // d'un encaissement confirmé par le prestataire.
  await prisma.$transaction(async (tx) => {
    await tx.paymentIntent.updateMany({
      where: { id: intent.id },
      data: { failureReason: `POSTING_${pay.error}` },
    });
    await tx.paymentTransaction.create({
      data: {
        intentId: intent.id, schoolId: ctx.schoolId,
        kind: "POSTING",
        providerTxId: intent.providerTxId ?? intent.providerRef,
        payload: { status: "RETRY_FAILED", error: pay.error },
      },
    });
  });
  return { ok: false, error: pay.error };
}

// ─── Annulation, expiration, simulation ────────────────────────────

export async function cancelPaymentIntent(
  ctx: Ctx, intentId: string, reason?: string,
): Promise<Res<true>> {
  const r = await transition(ctx, intentId, ["CREATED", "PENDING"], "CANCELLED", {
    failureReason: reason ?? "CANCELLED_BY_USER",
  });
  return r.ok ? { ok: true, data: true } : r;
}

export async function expireDuePaymentIntents(
  ctx: { userId: string | null; schoolId: string },
): Promise<{ expired: number }> {
  const now = new Date();
  const due = await prisma.paymentIntent.findMany({
    where: { schoolId: ctx.schoolId, status: "PENDING", expiresAt: { lt: now } },
    select: { id: true },
  });
  let expired = 0;
  for (const i of due) {
    const r = await transition(
      { userId: ctx.userId ?? "system", schoolId: ctx.schoolId },
      i.id, ["PENDING"], "EXPIRED", { failureReason: "TTL" },
    );
    if (r.ok) expired += 1;
  }
  return { expired };
}

/** Transition atomique gardée par statut — toute autre issue est rejetée. */
async function transition(
  ctx: Ctx,
  intentId: string,
  from: PaymentIntentStatus[],
  to: PaymentIntentStatus,
  extra: { failureReason?: string; providerTxId?: string } = {},
): Promise<Res<true>> {
  const kindMap = {
    CONFIRMED: "CONFIRM", FAILED: "FAIL", EXPIRED: "EXPIRE",
    CANCELLED: "CANCEL",
  } as const;
  const kind = (kindMap as Record<string, string>)[to] ?? "STATUS_CHECK";
  const stamp =
    to === "FAILED" ? { failedAt: new Date() }
    : to === "EXPIRED" ? { expiredAt: new Date() }
    : to === "CANCELLED" ? { cancelledAt: new Date() }
    : {};
  try {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.paymentIntent.updateMany({
        where: { id: intentId, schoolId: ctx.schoolId, status: { in: from } },
        data: {
          status: to as never,
          failureReason: extra.failureReason ?? undefined,
          providerTxId: extra.providerTxId ?? undefined,
          ...stamp,
        },
      });
      if (upd.count === 0) throw new Error("INVALID_STATE");
      await tx.paymentTransaction.create({
        data: {
          intentId, schoolId: ctx.schoolId,
          kind: kind as never,
          providerTxId: extra.providerTxId ?? null,
          payload: { status: to, reason: extra.failureReason ?? null },
        },
      });
      await logAudit({
        actorId: ctx.userId === "system" ? null : ctx.userId,
        schoolId: ctx.schoolId,
        action: `payment_intent.${to.toLowerCase()}`, entity: "PaymentIntent", entityId: intentId,
        metadata: { from: from.join(","), reason: extra.failureReason ?? null },
        tx,
      });
    });
    return { ok: true, data: true };
  } catch {
    return { ok: false, error: "INVALID_STATE" };
  }
}

/** Change le scénario sandbox d'une intention en cours (recette). */
export async function setSandboxOutcome(
  ctx: Ctx,
  intentId: string,
  outcome: SandboxScript["outcome"],
  afterChecks?: number,
): Promise<Res<true>> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, schoolId: ctx.schoolId },
    include: { provider: { select: { mode: true } } },
  });
  if (!intent) return { ok: false, error: "NOT_FOUND" };
  if (intent.provider.mode !== "SANDBOX") return { ok: false, error: "NOT_SANDBOX" };
  if (!ACTIVE_STATUSES.includes(intent.status as never)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  const script: SandboxScript = {
    outcome, afterChecks: afterChecks ?? 2, checks: 0,
  };
  await prisma.paymentIntent.updateMany({
    where: { id: intent.id },
    data: { sandboxScript: script as unknown as Prisma.InputJsonValue },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "payment_intent.sandbox_script", entity: "PaymentIntent", entityId: intent.id,
    metadata: { outcome },
  });
  return { ok: true, data: true };
}

// ─── Lectures ───────────────────────────────────────────────────────

export async function listPaymentIntents(
  ctx: Ctx,
  filter: { status?: string; providerId?: string; studentId?: string; limit?: number } = {},
) {
  return prisma.paymentIntent.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: filter.status as never,
      providerId: filter.providerId || undefined,
      studentId: filter.studentId || undefined,
    },
    include: {
      student: { select: { firstName: true, lastName: true, matricule: true } },
      provider: { select: { code: true, label: true, mode: true } },
      academicYear: { select: { name: true } },
      payment: { select: { receiptNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 100, 200),
  });
}

export async function getPaymentIntent(ctx: Ctx, intentId: string) {
  return prisma.paymentIntent.findFirst({
    where: { id: intentId, schoolId: ctx.schoolId },
    include: {
      student: { select: { firstName: true, lastName: true, matricule: true } },
      provider: {
        select: {
          id: true, code: true, label: true, mode: true, status: true,
          minAmount: true, maxAmount: true, merchantRef: true,
        },
      },
      academicYear: { select: { name: true } },
      initiatedBy: { select: { firstName: true, lastName: true } },
      payment: { select: { id: true, receiptNumber: true, method: true, status: true } },
      feeInstallment: {
        select: { id: true, amount: true, dueDate: true, charge: { select: { category: { select: { label: true } } } } },
      },
      transactions: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function paymentIntentStats(ctx: Ctx) {
  const rows = await prisma.paymentIntent.groupBy({
    by: ["status"],
    where: { schoolId: ctx.schoolId },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count._all, amount: r._sum.amount ?? 0 }));
}


/**
 * G3-D — recalcul du solde réellement imputable au moment du posting.
 * - Allocations explicites : chaque échéance visée doit avoir un reste
 *   à payer ≥ l'allocation (allocations validées déduites).
 * - Sans allocations (FIFO F3) : le solde global de l'élève doit
 *   couvrir le montant confirmé.
 * Ne modifie rien : vérification pure avant appel à `recordPayment`.
 */
async function checkPostingBalance(
  schoolId: string,
  intent: { studentId: string; academicYearId: string; amount: number; allocations: unknown },
): Promise<{ ok: true } | { ok: false; detail: { kind: string; message: string } }> {
  const allocs = (intent.allocations as { installmentId: string; amount: number }[] | null) ?? [];
  if (allocs.length > 0) {
    const insts = await prisma.feeInstallment.findMany({
      where: { id: { in: allocs.map((a) => a.installmentId) }, schoolId },
      select: {
        id: true,
        amount: true,
        status: true,
        allocations: {
          where: { payment: { status: "VALIDATED" } },
          select: { amount: true },
        },
      },
    });
    for (const a of allocs) {
      const inst = insts.find((i) => i.id === a.installmentId);
      const paid = inst?.allocations.reduce((s, x) => s + x.amount, 0) ?? 0;
      const remaining = inst ? Math.max(0, inst.amount - paid) : 0;
      if (!inst || inst.status !== "ACTIVE" || a.amount > remaining) {
        return {
          ok: false,
          detail: {
            kind: "INSTALLMENT",
            message: `échéance ${a.installmentId.slice(0, 8)}… : allocation ${a.amount} > reste ${remaining}`,
          },
        };
      }
    }
    return { ok: true };
  }
  // Sans allocations explicites : même calcul de solde global que F3.
  const [chargesSum, paidSum, discounts] = await Promise.all([
    prisma.studentFeeCharge.aggregate({
      where: {
        schoolId, studentId: intent.studentId,
        academicYearId: intent.academicYearId, status: "ACTIVE",
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        schoolId, studentId: intent.studentId,
        academicYearId: intent.academicYearId, status: "VALIDATED",
      },
      _sum: { amount: true },
    }),
    prisma.feeDiscount.findMany({
      where: {
        schoolId, studentId: intent.studentId,
        academicYearId: intent.academicYearId, status: "ACTIVE",
      },
      select: { type: true, value: true },
    }),
  ]);
  const total = chargesSum._sum.amount ?? 0;
  const disc = discounts.reduce(
    (s, d) =>
      s + (d.type === "PERCENT" ? Math.floor((total * d.value) / 100) : d.type === "EXEMPTION" ? total : d.value),
    0,
  );
  const remainingDue = Math.max(0, total - disc - (paidSum._sum.amount ?? 0));
  if (intent.amount > remainingDue) {
    return {
      ok: false,
      detail: { kind: "GLOBAL", message: `montant ${intent.amount} > solde restant ${remainingDue}` },
    };
  }
  return { ok: true };
}

/**
 * G3-D — intention confirmée non imputable : la preuve prestataire est
 * conservée (CONFIRMED), aucune allocation n'est créée, la divergence
 * part dans la file d'anomalies avec notification. Remboursement ou
 * régularisation manuelle ensuite. Le posting reste relançable si le
 * solde se libère (CONFIRMED sans paymentId).
 */
async function blockUnallocatableIntent(
  ctx: Ctx,
  intent: {
    id: string; schoolId: string; amount: number; currency: string;
    providerTxId: string | null; providerRef: string | null;
  },
  detail: { kind: string; message: string },
) {
  await prisma.$transaction(async (tx) => {
    await tx.paymentIntent.updateMany({
      where: { id: intent.id, paymentId: null },
      data: { status: "CONFIRMED", failureReason: "OVERPAYMENT_BLOCKED" },
    });
    await tx.paymentTransaction.create({
      data: {
        intentId: intent.id, schoolId: ctx.schoolId,
        kind: "POSTING",
        providerTxId: intent.providerTxId ?? intent.providerRef,
        payload: { status: "UNALLOCATABLE", reason: detail.message },
      },
    });
    await ensureDiscrepancy(tx, {
      schoolId: ctx.schoolId,
      type: "OVERPAYMENT_BLOCKED",
      intentId: intent.id,
      expectedAmount: intent.amount,
      description: `Confirmation prestataire non imputable : ${detail.message} — trop-perçu à traiter (remboursement ou régularisation)`,
    });
    await ensureReconciliation(tx, intent.id);
    await logAudit({
      actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "payment_intent.unallocatable", entity: "PaymentIntent", entityId: intent.id,
      metadata: { amount: intent.amount, reason: detail.message },
      tx,
    });
  });
  await notifyReconcileAdmins(ctx.schoolId, {
    title: "Paiement Mobile Money confirmé non imputable",
    body: `${intent.amount} ${intent.currency} — ${detail.message}. Traitement via la file d'anomalies.`,
    link: "/app/paiements-mobile?tab=anomalies",
  });
}
