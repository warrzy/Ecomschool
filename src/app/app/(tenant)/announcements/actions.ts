"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  archiveAnnouncement,
  cancelSchedule,
  createAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  unarchiveAnnouncement,
  updateAnnouncement,
} from "@/lib/services/announcements";
import type { AnnouncementAudience } from "@prisma/client";
import { z } from "zod";
import { optionalDateField, requiredText } from "@/lib/validations/form";

const AUDIENCES = ["ALL", "PARENTS", "STUDENTS", "TEACHERS"];

const announcementSchema = z.object({
  title: requiredText,
  body: z.string().min(1),
  audience: z.enum(["ALL", "PARENTS", "STUDENTS", "TEACHERS"]),
  scheduledAt: optionalDateField,
});

const failUrl = (code: string) => `/app/announcements?error=${code}` as never;
const okUrl = (code: string) => `/app/announcements?ok=${code}` as never;

function parseAnnouncementForm(formData: FormData) {
  const audienceRaw = String(formData.get("audience") ?? "ALL");
  return announcementSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    audience: AUDIENCES.includes(audienceRaw) ? audienceRaw : "ALL",
    scheduledAt: String(formData.get("scheduledAt") ?? "") || undefined,
  });
}

/** scheduledAt doit être une date future pour une programmation. */
function parseSchedule(raw?: string) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function createAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const parsed = parseAnnouncementForm(formData);
  if (!parsed.success) return redirect(failUrl("INVALID_INPUT"));

  const intent = String(formData.get("intent") ?? "draft");
  const scheduledAt = parseSchedule(parsed.data.scheduledAt);

  if (intent === "schedule") {
    if (!scheduledAt) return redirect(failUrl("MISSING_SCHEDULE"));
    if (scheduledAt.getTime() <= Date.now()) {
      return redirect(failUrl("PAST_SCHEDULE"));
    }
  }
  const res = await createAnnouncement(c, {
    title: parsed.data.title,
    body: parsed.data.body,
    audience: parsed.data.audience as AnnouncementAudience,
    publish: intent === "publish",
    scheduledAt: intent === "schedule" ? scheduledAt : null,
  });
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(
    okUrl(
      intent === "publish"
        ? "published"
        : intent === "schedule"
          ? "scheduled"
          : "created",
    ),
  );
}

/**
 * Modification (brouillon ou programmée) : contenu, audience, date.
 * intent="reschedule" met à jour la date ; intent="save" conserve l'état.
 */
export async function updateAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return redirect(failUrl("INVALID_INPUT"));
  const parsed = parseAnnouncementForm(formData);
  if (!parsed.success) return redirect(failUrl("INVALID_INPUT"));

  const scheduledAt = parseSchedule(parsed.data.scheduledAt);
  if (parsed.data.scheduledAt && !scheduledAt) {
    return redirect(failUrl("MISSING_SCHEDULE"));
  }
  if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
    return redirect(failUrl("PAST_SCHEDULE"));
  }
  // Champ date vide → undefined : conserve la programmation existante.
  // L'annulation est exclusivement l'action « Annuler prog. » (explicite).
  const res = await updateAnnouncement(c, id.data, {
    title: parsed.data.title,
    body: parsed.data.body,
    audience: parsed.data.audience as AnnouncementAudience,
    scheduledAt: parsed.data.scheduledAt ? scheduledAt : undefined,
  });
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(okUrl("updated"));
}

/** Publication immédiate — la page affiche la confirmation ?confirm=publish. */
export async function publishAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return redirect(failUrl("INVALID_INPUT"));
  const res = await publishAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(okUrl("published"));
}

/** Annule la programmation : l'annonce redevient un brouillon. */
export async function cancelScheduleAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return redirect(failUrl("INVALID_INPUT"));
  const res = await cancelSchedule(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(okUrl("unscheduled"));
}

export async function archiveAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return redirect(failUrl("INVALID_INPUT"));
  const res = await archiveAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(okUrl("archived"));
}

/** Désarchive vers brouillon — refusé si l'annonce a déjà été publiée. */
export async function unarchiveAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return redirect(failUrl("INVALID_INPUT"));
  const res = await unarchiveAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(okUrl("unarchived"));
}

/** Suppression définitive — uniquement si jamais publiée. */
export async function deleteAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return redirect(failUrl("INVALID_INPUT"));
  const res = await deleteAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(okUrl("deleted"));
}
