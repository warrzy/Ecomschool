/**
 * CG-4 — Immobilisations et dotations aux amortissements.
 * Une écriture OD par immobilisation et par mois (D 681 / C 281…),
 * idempotente via sourceType ASSET_DEPR + unique(assetId, periodStart).
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { postEntrySafe, createEntry, openExercises, exerciseFor } from "@/lib/services/accounting";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

/** Contrepartie d'acquisition : SYSCOHADA 481/404, sinon trésorerie. */
async function assetCounterpart(schoolId: string) {
  return prisma.accountingAccount.findFirst({
    where: { schoolId, code: { in: ["481", "4811", "404", "521", "571"] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
}

export async function createAsset(ctx: Ctx, input: {
  label: string; acquisitionDate: Date; acquisitionCost: number;
  durationMonths: number; accountAssetId: string;
  accountDepreciationId: string; accountChargeId: string;
  counterpartAccountId?: string;
}): Promise<Res<{ id: string }>> {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  if (!input.label.trim() || input.acquisitionCost <= 0 || input.durationMonths <= 0)
    return err("INVALID_INPUT");
  const accs = await prisma.accountingAccount.count({
    where: {
      schoolId: ctx.schoolId,
      id: { in: [input.accountAssetId, input.accountDepreciationId, input.accountChargeId] },
    },
  });
  if (accs !== 3) return err("NOT_FOUND");
  // M4 : l'acquisition DOIT être comptabilisée (D2xx/C481x) dans la même
  // transaction — sinon l'actif immobilisé sort négatif au bilan.
  const counterpart = input.counterpartAccountId
    ? await prisma.accountingAccount.findFirst({
        where: { id: input.counterpartAccountId, schoolId: ctx.schoolId }, select: { id: true, code: true },
      })
    : await assetCounterpart(ctx.schoolId);
  if (!counterpart) return err("MISSING_ACCOUNTS");
  const exs = await openExercises(ctx.schoolId);
  const exercise = exerciseFor(exs, input.acquisitionDate);
  if (!exercise) return err("NO_OPEN_EXERCISE");
  const journal = await prisma.accountingJournal.findFirst({
    where: { schoolId: ctx.schoolId, code: "OD" }, select: { id: true },
  });
  if (!journal) return err("NO_OD_JOURNAL");
  const { counterpartAccountId, ...data } = input;
  void counterpartAccountId;
  const a = await prisma.$transaction(async (tx) => {
    const asset = await tx.accountingAsset.create({ data: { schoolId: ctx.schoolId, ...data } });
    await createEntry(ctx, tx, {
      journalId: journal.id, exerciseId: exercise.id, date: input.acquisitionDate,
      description: `Acquisition immobilisation — ${input.label}`,
      sourceType: "ASSET_ACQ", sourceId: asset.id,
      lines: [
        { accountId: input.accountAssetId, debit: input.acquisitionCost, label: input.label },
        { accountId: counterpart.id, credit: input.acquisitionCost, label: `Frs immo ${counterpart.code}` },
      ],
    });
    return asset;
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "accounting.asset.create", entity: "AccountingAsset", entityId: a.id });
  return ok({ id: a.id });
}

export async function listAssets(ctx: Ctx) {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const assets = await prisma.accountingAsset.findMany({
    where: { schoolId: ctx.schoolId },
    include: {
      accountAsset: { select: { code: true } },
      accountDepreciation: { select: { code: true } },
      schedules: { select: { amount: true, periodStart: true }, orderBy: { periodStart: "asc" } },
    },
    orderBy: { label: "asc" },
  });
  return ok(assets.map((a) => ({
    ...a,
    amortized: a.schedules.reduce((s, x) => s + x.amount, 0),
    remaining: a.acquisitionCost - a.schedules.reduce((s, x) => s + x.amount, 0),
  })));
}

/** Passe les dotations du mois (UTC). Rejouable : doublons ignorés, jamais de doublon d'écriture. */
export async function runDepreciation(
  ctx: Ctx, year: number, month: number,
): Promise<Res<{ posted: number; skipped: number }>> {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const entryDate = new Date(Date.UTC(year, month, 0)); // dernier jour du mois
  const exs = await openExercises(ctx.schoolId);
  const exercise = exerciseFor(exs, entryDate);
  if (!exercise) return err("NO_OPEN_EXERCISE");
  const journal = await prisma.accountingJournal.findFirst({
    where: { schoolId: ctx.schoolId, code: "OD" },
  });
  if (!journal) return err("NO_OD_JOURNAL");
  const assets = await prisma.accountingAsset.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    include: { schedules: { select: { periodStart: true, amount: true } } },
  });
  let posted = 0, skipped = 0;
  const yyyymm = `${year}${String(month).padStart(2, "0")}`;
  for (const a of assets) {
    if (a.acquisitionDate >= new Date(Date.UTC(year, month, 1))) { skipped++; continue; }
    const done = a.schedules.reduce((s, x) => s + x.amount, 0);
    const remaining = a.acquisitionCost - done;
    if (remaining <= 0 || a.schedules.some((s) => +s.periodStart === +periodStart)) { skipped++; continue; }
    const amount = Math.min(Math.round(a.acquisitionCost / a.durationMonths), remaining);
    // B3 : écriture + ligne de schedule dans UNE transaction — le registre
    // ne peut plus diverger du grand livre après un crash intermédiaire.
    const created = await postEntrySafe(ctx, {
      journalId: journal.id, exerciseId: exercise.id, date: entryDate,
      description: `Dotation ${a.label} ${yyyymm}`,
      sourceType: "ASSET_DEPR", sourceId: `${a.id}:${yyyymm}`,
      lines: [
        { accountId: a.accountChargeId, debit: amount, label: `Dotation ${yyyymm}` },
        { accountId: a.accountDepreciationId, credit: amount, label: `Amort. ${a.label}` },
      ],
    }, async (tx, entry) => {
      await tx.assetSchedule.create({
        data: { assetId: a.id, periodStart, amount, entryId: entry.id },
      });
    });
    if (!created) { skipped++; continue; }
    posted++;
  }
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.asset.depreciation", entity: "AccountingAsset",
    metadata: { year, month, posted, skipped },
  });
  return ok({ posted, skipped });
}

/** Sortie d'immobilisation : D28x (amort. cumulé) + D81x (VNC) / C2xx (coût). */
export async function disposeAsset(ctx: Ctx, assetId: string, status: "SOLD" | "SCRAPPED") {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const a = await prisma.accountingAsset.findFirst({
    where: { id: assetId, schoolId: ctx.schoolId },
    include: { schedules: { select: { amount: true } } },
  });
  if (!a || a.status !== "ACTIVE") return err("NOT_FOUND");
  const amortized = a.schedules.reduce((s, x) => s + x.amount, 0);
  const vna = a.acquisitionCost - amortized;
  // M4 : écriture de sortie + statut dans UNE transaction (idempotente
  // via ASSET_DISPOSAL:<assetId> ; rattrapage du statut si doublon).
  const lossAcc = vna > 0
    ? await prisma.accountingAccount.findFirst({
        where: { schoolId: ctx.schoolId, code: { in: ["81", "812", "816", "654", "675"] } },
        orderBy: { code: "asc" }, select: { id: true },
      })
    : null;
  if (vna > 0 && !lossAcc) return err("MISSING_ACCOUNTS");
  const exs = await openExercises(ctx.schoolId);
  const exercise = exerciseFor(exs, new Date());
  if (!exercise) return err("NO_OPEN_EXERCISE");
  const journal = await prisma.accountingJournal.findFirst({
    where: { schoolId: ctx.schoolId, code: "OD" }, select: { id: true },
  });
  if (!journal) return err("NO_OD_JOURNAL");
  const created = await postEntrySafe(ctx, {
    journalId: journal.id, exerciseId: exercise.id, date: new Date(),
    description: `Sortie immobilisation — ${a.label} (${status})`,
    sourceType: "ASSET_DISPOSAL", sourceId: a.id,
    lines: [
      ...(amortized > 0 ? [{ accountId: a.accountDepreciationId, debit: amortized, label: "Amort. cumulé" }] : []),
      ...(vna > 0 && lossAcc ? [{ accountId: lossAcc.id, debit: vna, label: "VNC" }] : []),
      { accountId: a.accountAssetId, credit: a.acquisitionCost, label: a.label },
    ],
  }, async (tx) => {
    await tx.accountingAsset.update({ where: { id: a.id }, data: { status } });
  });
  if (!created) {
    // Écriture déjà postée (rejeu) → s'assurer que le statut est bien à jour.
    await prisma.accountingAsset.updateMany({
      where: { id: a.id, schoolId: ctx.schoolId }, data: { status },
    });
    return ok({ id: assetId });
  }
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "accounting.asset.dispose", entity: "AccountingAsset", entityId: a.id, metadata: { status, vna } });
  return ok({ id: assetId });
}
