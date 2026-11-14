/**
 * CG-4 — Immobilisations et dotations aux amortissements.
 * Une écriture OD par immobilisation et par mois (D 681 / C 281…),
 * idempotente via sourceType ASSET_DEPR + unique(assetId, periodStart).
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { postEntrySafe, openExercises, exerciseFor } from "@/lib/services/accounting";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

export async function createAsset(ctx: Ctx, input: {
  label: string; acquisitionDate: Date; acquisitionCost: number;
  durationMonths: number; accountAssetId: string;
  accountDepreciationId: string; accountChargeId: string;
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
  const a = await prisma.accountingAsset.create({ data: { schoolId: ctx.schoolId, ...input } });
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
    const created = await postEntrySafe(ctx, {
      journalId: journal.id, exerciseId: exercise.id, date: entryDate,
      description: `Dotation ${a.label} ${yyyymm}`,
      sourceType: "ASSET_DEPR", sourceId: `${a.id}:${yyyymm}`,
      lines: [
        { accountId: a.accountChargeId, debit: amount, label: `Dotation ${yyyymm}` },
        { accountId: a.accountDepreciationId, credit: amount, label: `Amort. ${a.label}` },
      ],
    });
    if (!created) { skipped++; continue; }
    const entry = await prisma.accountingEntry.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, sourceType: "ASSET_DEPR", sourceId: `${a.id}:${yyyymm}` },
      select: { id: true },
    });
    try {
      await prisma.assetSchedule.create({
        data: { assetId: a.id, periodStart, amount, entryId: entry.id },
      });
      posted++;
    } catch { skipped++; } // P2002 concurrence — écriture déjà lettrée
  }
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.asset.depreciation", entity: "AccountingAsset",
    metadata: { year, month, posted, skipped },
  });
  return ok({ posted, skipped });
}

export async function disposeAsset(ctx: Ctx, assetId: string, status: "SOLD" | "SCRAPPED") {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const r = await prisma.accountingAsset.updateMany({
    where: { id: assetId, schoolId: ctx.schoolId, status: "ACTIVE" },
    data: { status },
  });
  if (r.count === 0) return err("NOT_FOUND");
  return ok({ id: assetId });
}
