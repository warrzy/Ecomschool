"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  prepareSession,
  upsertRule,
  archiveRule,
} from "@/lib/services/deliberations";

const back = (path: string): never => redirect(path as never);

const createSchema = z.object({
  scope: z.enum(["PERIOD", "ANNUAL"]),
  classroomId: z.string().min(1),
  academicPeriodId: z.string().min(1).optional().or(z.literal("")),
  note: z.string().trim().max(1000).optional(),
});

/** Préparation d'une session de délibération + propositions calculées. */
export async function createSessionAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.manage");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return back("/app/deliberations?error=INVALID_INPUT");

  const res = await prepareSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      scope: parsed.data.scope,
      classroomId: parsed.data.classroomId,
      academicPeriodId: parsed.data.academicPeriodId || undefined,
      note: parsed.data.note,
    },
  );
  return back(
    res.ok
      ? `/app/deliberations/${res.result.id}?ok=deliberation`
      : `/app/deliberations?error=${res.error}`,
  );
}

const ruleSchema = z.object({
  scope: z.enum(["PERIOD", "ANNUAL"]),
  label: z.string().trim().min(1).max(100),
  progression: z
    .enum(["PROMOTION", "REPETITION", "SAME_LEVEL", "CLASS_CHANGE", "CYCLE_CHANGE", "RETURN"])
    .optional()
    .or(z.literal("")),
  minAverage: z.coerce.number().min(0).max(100).optional().or(z.literal("")),
  maxAverage: z.coerce.number().min(0).max(100).optional().or(z.literal("")),
  requiresComplete: z.literal("on").optional(),
  order: z.coerce.number().int().min(0).max(9999).optional(),
  academicYearId: z.string().optional().or(z.literal("")),
  levelId: z.string().optional().or(z.literal("")),
});

/** Création d'une règle de décision (ordonnée, bande de moyenne). */
export async function createRuleAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.manage");
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return back("/app/deliberations?tab=regles&error=INVALID_INPUT");
  }
  const d = parsed.data;
  const res = await upsertRule(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      scope: d.scope,
      label: d.label,
      progression: d.progression || null,
      minAverage: d.minAverage === "" ? null : (d.minAverage ?? null),
      maxAverage: d.maxAverage === "" ? null : (d.maxAverage ?? null),
      requiresComplete: d.requiresComplete === "on",
      order: d.order ?? 0,
      academicYearId: d.academicYearId || null,
      levelId: d.levelId || null,
    },
  );
  return back(
    res.ok
      ? "/app/deliberations?tab=regles&ok=rule"
      : `/app/deliberations?tab=regles&error=${res.error}`,
  );
}

/** Archivage d'une règle (les décisions passées gardent leur libellé). */
export async function archiveRuleAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) return back("/app/deliberations?tab=regles&error=INVALID_INPUT");
  const res = await archiveRule(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  return back(
    res.ok
      ? "/app/deliberations?tab=regles&ok=rule_archived"
      : `/app/deliberations?tab=regles&error=${res.error}`,
  );
}
