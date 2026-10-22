"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  addReenrollmentInternalNote,
  batchFinalizeReenrollments,
  cancelReenrollmentRequest,
  createReenrollmentCampaign,
  decideReenrollmentRequest,
  finalizeReenrollment,
  requestReenrollmentInfo,
  reviewReenrollmentRequest,
  setReenrollmentCampaignStatus,
  submitAdminReenrollment,
  updateReenrollmentCampaign,
} from "@/lib/services/reenrollment";
import type { ReenrollmentCampaignStatus, ReenrollmentProgression } from "@prisma/client";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}
const back = (path: string): never => redirect(path as never);

const CAMPAIGN_STATUSES: ReenrollmentCampaignStatus[] = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
];
const PROGRESSIONS: ReenrollmentProgression[] = [
  "PROMOTION",
  "REPETITION",
  "SAME_LEVEL",
  "CLASS_CHANGE",
  "CYCLE_CHANGE",
  "RETURN",
];

const campaignSchema = z.object({
  campaignId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  sourceYearId: z.string().optional(),
  targetYearId: z.string().optional(),
  opensAt: z.string().optional(),
  closesAt: z.string().optional(),
  familyMessage: z.string().optional(),
  instructions: z.string().optional(),
  blockOnUnpaid: z.string().optional(),
});

export async function createReenrollCampaignAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.manage");
  const p = campaignSchema.safeParse(Object.fromEntries(formData));
  if (!p.success || !p.data.name || !p.data.sourceYearId || !p.data.targetYearId || !p.data.opensAt || !p.data.closesAt) {
    return back("/app/reinscriptions?error=INVALID_INPUT");
  }
  const res = await createReenrollmentCampaign(ctx(t), {
    name: p.data.name,
    sourceYearId: p.data.sourceYearId,
    targetYearId: p.data.targetYearId,
    familyMessage: p.data.familyMessage,
    instructions: p.data.instructions,
    opensAt: new Date(p.data.opensAt),
    closesAt: new Date(p.data.closesAt),
    blockOnUnpaid: p.data.blockOnUnpaid === "on",
  });
  return back(
    res.ok ? "/app/reinscriptions?ok=campaign" : `/app/reinscriptions?error=${res.error}`,
  );
}

export async function setReenrollCampaignStatusAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.manage");
  const campaignId = String(formData.get("campaignId") ?? "");
  const status = String(formData.get("status") ?? "") as ReenrollmentCampaignStatus;
  if (!campaignId || !CAMPAIGN_STATUSES.includes(status)) {
    return back("/app/reinscriptions?error=INVALID_INPUT");
  }
  const res = await setReenrollmentCampaignStatus(ctx(t), campaignId, status);
  return back(
    res.ok ? "/app/reinscriptions?ok=status" : `/app/reinscriptions?error=${res.error}`,
  );
}

export async function submitAdminReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.manage");
  const campaignId = String(formData.get("campaignId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const kind = String(formData.get("kind") ?? "REENROLL") === "DEPARTURE" ? "DEPARTURE" : "REENROLL";
  if (!campaignId || !studentId) return back("/app/reinscriptions?error=INVALID_INPUT");
  const res = await submitAdminReenrollment(ctx(t), {
    campaignId,
    studentId,
    kind,
    desiredLevelId: String(formData.get("desiredLevelId") ?? "") || undefined,
    note: String(formData.get("note") ?? "") || undefined,
  });
  return back(
    res.ok
      ? `/app/reinscriptions?camp=${campaignId}&ok=submitted`
      : `/app/reinscriptions?camp=${campaignId}&error=${res.error}`,
  );
}

export async function reviewReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.review");
  const reqId = String(formData.get("requestId") ?? "");
  if (!reqId) return back("/app/reinscriptions?error=INVALID_INPUT");
  const res = await reviewReenrollmentRequest(ctx(t), reqId);
  return back(
    res.ok
      ? `/app/reinscriptions?req=${reqId}&ok=review`
      : `/app/reinscriptions?req=${reqId}&error=${res.error}`,
  );
}

export async function requestReenrollInfoAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.review");
  const reqId = String(formData.get("requestId") ?? "");
  const message = String(formData.get("message") ?? "");
  if (!reqId || !message.trim()) return back("/app/reinscriptions?error=INVALID_INPUT");
  const res = await requestReenrollmentInfo(ctx(t), reqId, message);
  return back(
    res.ok
      ? `/app/reinscriptions?req=${reqId}&ok=info`
      : `/app/reinscriptions?req=${reqId}&error=${res.error}`,
  );
}

export async function addReenrollNoteAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.review");
  const reqId = String(formData.get("requestId") ?? "");
  const message = String(formData.get("note") ?? "");
  if (!reqId || !message.trim()) return back("/app/reinscriptions?error=INVALID_INPUT");
  const res = await addReenrollmentInternalNote(ctx(t), reqId, message);
  return back(
    res.ok
      ? `/app/reinscriptions?req=${reqId}&ok=note`
      : `/app/reinscriptions?req=${reqId}&error=${res.error}`,
  );
}

export async function decideReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.decide");
  const reqId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const targetClassroomId = String(formData.get("targetClassroomId") ?? "");
  const progressionRaw = String(formData.get("progression") ?? "");
  if (!reqId || !["APPROVED", "REJECTED"].includes(decision)) {
    return back("/app/reinscriptions?error=INVALID_INPUT");
  }
  const res = await decideReenrollmentRequest(ctx(t), reqId, {
    decision: decision as "APPROVED" | "REJECTED",
    reason: reason || undefined,
    targetClassroomId: targetClassroomId || undefined,
    progression: PROGRESSIONS.includes(progressionRaw as ReenrollmentProgression)
      ? (progressionRaw as ReenrollmentProgression)
      : undefined,
  });
  return back(
    res.ok
      ? `/app/reinscriptions?req=${reqId}&ok=decision`
      : `/app/reinscriptions?req=${reqId}&error=${res.error}`,
  );
}

export async function cancelReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.review");
  const reqId = String(formData.get("requestId") ?? "");
  if (!reqId) return back("/app/reinscriptions?error=INVALID_INPUT");
  const res = await cancelReenrollmentRequest(ctx(t), reqId);
  return back(
    res.ok ? "/app/reinscriptions?ok=cancel" : `/app/reinscriptions?error=${res.error}`,
  );
}

export async function finalizeReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.decide");
  const reqId = String(formData.get("requestId") ?? "");
  if (!reqId) return back("/app/reinscriptions?error=INVALID_INPUT");
  const res = await finalizeReenrollment(ctx(t), reqId);
  if (!res.ok) return back(`/app/reinscriptions?req=${reqId}&error=${res.error}`);
  if (res.result.chargesError) {
    return back(`/app/reinscriptions?req=${reqId}&error=CHARGES_FAILED`);
  }
  return back(`/app/reinscriptions?req=${reqId}&ok=finalized`);
}

export async function batchFinalizeReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.decide");
  const camp = String(formData.get("campaignId") ?? "");
  const ids = formData.getAll("requestIds").map(String).filter(Boolean);
  if (!ids.length) return back(`/app/reinscriptions?camp=${camp}&error=INVALID_INPUT`);
  const res = await batchFinalizeReenrollments(ctx(t), ids);
  if (!res.ok) return back(`/app/reinscriptions?camp=${camp}&error=${res.error}`);
  const summary = res.result
    .map((r) => `${r.outcome}:${r.requestId}${r.error ? ":" + r.error : ""}`)
    .join(",");
  return back(`/app/reinscriptions?camp=${camp}&ok=batch&report=${encodeURIComponent(summary)}`);
}

export async function updateReenrollCampaignAction(formData: FormData) {
  const t = await requireSchoolPermission("reenrollments.manage");
  const p = campaignSchema.safeParse(Object.fromEntries(formData));
  if (!p.success || !p.data.campaignId) {
    return back("/app/reinscriptions?error=INVALID_INPUT");
  }
  const res = await updateReenrollmentCampaign(ctx(t), p.data.campaignId, {
    ...(p.data.name !== undefined ? { name: p.data.name } : {}),
    ...(p.data.familyMessage !== undefined ? { familyMessage: p.data.familyMessage } : {}),
    ...(p.data.instructions !== undefined ? { instructions: p.data.instructions } : {}),
    ...(p.data.opensAt ? { opensAt: new Date(p.data.opensAt) } : {}),
    ...(p.data.closesAt ? { closesAt: new Date(p.data.closesAt) } : {}),
    ...(p.data.blockOnUnpaid !== undefined ? { blockOnUnpaid: p.data.blockOnUnpaid === "on" } : {}),
  });
  return back(
    res.ok
      ? `/app/reinscriptions?camp=${p.data.campaignId}&ok=campaign`
      : `/app/reinscriptions?camp=${p.data.campaignId}&error=${res.error}`,
  );
}
