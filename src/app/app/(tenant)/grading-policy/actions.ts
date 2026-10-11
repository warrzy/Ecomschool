"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { upsertPolicy } from "@/lib/services/grading/policy";
import { gradingPolicySchema } from "@/lib/validations/grading";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

function parseMentions(raw?: string) {
  if (!raw?.trim()) return undefined;
  return raw
    .split(";")
    .map((part) => {
      const [label, min] = part.split(":").map((p) => p.trim());
      const n = Number(min?.replace(",", "."));
      return label && Number.isFinite(n) ? { label, min: n } : null;
    })
    .filter((m): m is { label: string; min: number } => m != null);
}

export async function upsertPolicyAction(formData: FormData) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
  const parsed = gradingPolicySchema.safeParse({
    academicYearId: formData.get("academicYearId"),
    levelId: String(formData.get("levelId") ?? "") || undefined,
    maxScore: formData.get("maxScore"),
    minScore: formData.get("minScore"),
    precision: formData.get("precision"),
    rounding: formData.get("rounding"),
    passMark: formData.get("passMark"),
    missingGradePolicy: formData.get("missingGradePolicy"),
    absentPolicy: formData.get("absentPolicy"),
    exemptPolicy: formData.get("exemptPolicy"),
    tieRule: formData.get("tieRule"),
    perSubjectRank: formData.get("perSubjectRank") === "on" || formData.get("perSubjectRank") === "true",
    mentions: String(formData.get("mentions") ?? ""),
  });
  if (!parsed.success) redirect("/app/grading-policy?error=INVALID_INPUT" as never);

  const res = await upsertPolicy(ctx(tenant), {
    ...parsed.data,
    levelId: parsed.data.levelId ?? null,
    mentions: parseMentions(parsed.data.mentions),
  });
  redirect(
    (res.ok ? "/app/grading-policy?ok=saved" : `/app/grading-policy?error=${res.error}`) as never,
  );
}
