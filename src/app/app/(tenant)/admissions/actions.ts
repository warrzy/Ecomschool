"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  createCampaign,
  rotateTrackingSecret,
  setCampaignStatus,
  setPrivacyText,
  transitionApplication,
  updateCampaign,
  type CampaignInput,
} from "@/lib/services/admissions";
import {
  intNonNegative,
  requiredText,
  dateField,
} from "@/lib/validations/form";
import type {
  AdmissionApplicationStatus,
  AdmissionCampaignStatus,
} from "@prisma/client";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string): never => redirect(path as never);

const CAMPAIGN_STATUSES: AdmissionCampaignStatus[] = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
];
const APP_STATUSES: AdmissionApplicationStatus[] = [
  "UNDER_REVIEW",
  "ADDITIONAL_INFO_REQUIRED",
  "WAITLISTED",
  "ACCEPTED",
  "CONDITIONALLY_ACCEPTED",
  "REJECTED",
];

const campaignSchema = z.object({
  id: z.string().optional(),
  name: requiredText.max(120),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(2000).optional(),
  academicYearId: requiredText,
  opensAt: dateField,
  closesAt: dateField,
  capacity: intNonNegative.optional(),
  applicationFee: intNonNegative.optional(),
});

function readCampaignForm(formData: FormData): CampaignInput | null {
  const parsed = campaignSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    instructions: formData.get("instructions") || undefined,
    academicYearId: formData.get("academicYearId"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    capacity: formData.get("capacity") || undefined,
    applicationFee: formData.get("applicationFee") || undefined,
  });
  if (!parsed.success) return null;

  const targetLevelIds = formData
    .getAll("levelIds")
    .map(String)
    .filter(Boolean);
  const trainingOptions = String(formData.get("trainingOptions") ?? "")
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  const requiredDocs: CampaignInput["requiredDocs"] = [];
  for (let i = 1; i <= 5; i++) {
    const docLabel = String(formData.get(`doc${i}_label`) ?? "").trim();
    if (!docLabel) continue;
    const category = String(formData.get(`doc${i}_category`) ?? "JUSTIFICATIF");
    requiredDocs.push({
      key: `piece${i}`,
      label: docLabel.slice(0, 120),
      category,
      required: formData.get(`doc${i}_required`) === "on",
    });
  }

  return {
    name: parsed.data.name,
    description: parsed.data.description,
    instructions: parsed.data.instructions,
    academicYearId: parsed.data.academicYearId,
    opensAt: parsed.data.opensAt,
    closesAt: parsed.data.closesAt,
    targetLevelIds,
    trainingOptions,
    requiredDocs,
    capacity: parsed.data.capacity,
    applicationFee: parsed.data.applicationFee,
  };
}

export async function createCampaignAction(formData: FormData) {
  const tenant = await requireSchoolPermission("admissions.manage");
  const input = readCampaignForm(formData);
  if (!input) return back("/app/admissions/campaigns?error=INVALID_INPUT");
  const res = await createCampaign(ctx(tenant), input);
  back(
    res.ok
      ? "/app/admissions/campaigns?ok=campaign"
      : `/app/admissions/campaigns?error=${res.error}`,
  );
}

export async function updateCampaignAction(formData: FormData) {
  const tenant = await requireSchoolPermission("admissions.manage");
  const id = String(formData.get("id") ?? "");
  const input = readCampaignForm(formData);
  if (!id || !input) {
    return back("/app/admissions/campaigns?error=INVALID_INPUT");
  }
  const res = await updateCampaign(ctx(tenant), id, input);
  back(
    res.ok
      ? "/app/admissions/campaigns?ok=campaign"
      : `/app/admissions/campaigns?error=${res.error}`,
  );
}

export async function setCampaignStatusAction(formData: FormData) {
  const tenant = await requireSchoolPermission("admissions.manage");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "") as AdmissionCampaignStatus;
  if (!id || !CAMPAIGN_TRANSITION_STATUSES.includes(to)) {
    return back("/app/admissions/campaigns?error=INVALID_INPUT");
  }
  const res = await setCampaignStatus(ctx(tenant), id, to);
  back(
    res.ok
      ? "/app/admissions/campaigns?ok=status"
      : `/app/admissions/campaigns?error=${res.error}`,
  );
}
const CAMPAIGN_TRANSITION_STATUSES = CAMPAIGN_STATUSES;

export async function transitionApplicationAction(formData: FormData) {
  const tenant = await requireSchoolPermission("admissions.review");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "") as AdmissionApplicationStatus;
  const note = String(formData.get("note") ?? "") || undefined;
  if (!id || !APP_STATUSES.includes(to)) {
    return back("/app/admissions?error=INVALID_INPUT");
  }
  const res = await transitionApplication(ctx(tenant), id, to, note);
  back(
    res.ok
      ? `/app/admissions?id=${id}&ok=status`
      : `/app/admissions?id=${id}&error=${res.error}`,
  );
}

export async function updatePrivacyTextAction(formData: FormData) {
  const tenant = await requireSchoolPermission("admissions.manage");
  const res = await setPrivacyText(ctx(tenant), String(formData.get("privacyText") ?? ""));
  back(
    res.ok
      ? "/app/admissions/campaigns?ok=privacy"
      : `/app/admissions/campaigns?error=${res.error}`,
  );
}

/**
 * Régénère le code de suivi d'un dossier. Le nouveau code est renvoyé au
 * composant client et affiché UNE fois — jamais dans l'URL ni les logs.
 */
export async function rotateSecretAction(applicationId: string) {
  const tenant = await requireSchoolPermission("admissions.manage");
  if (!applicationId) return { ok: false as const, error: "INVALID_INPUT" };
  const res = await rotateTrackingSecret(ctx(tenant), applicationId);
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, secret: res.result.secret };
}
