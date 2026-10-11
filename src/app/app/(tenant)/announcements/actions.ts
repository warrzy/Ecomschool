"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  archiveAnnouncement,
  createAnnouncement,
  publishAnnouncement,
} from "@/lib/services/announcements";
import type { AnnouncementAudience } from "@prisma/client";
import { z } from "zod";
import { optionalDateField, requiredText } from "@/lib/validations/form";

const AUDIENCES = ["ALL", "PARENTS", "STUDENTS", "TEACHERS"];

const createSchema = z.object({
  title: requiredText,
  body: z.string(),
  audience: z.enum(["ALL", "PARENTS", "STUDENTS", "TEACHERS"]),
  scheduledAt: optionalDateField,
});

export async function createAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const audienceRaw = String(formData.get("audience") ?? "ALL");
  const parsed = createSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    audience: AUDIENCES.includes(audienceRaw) ? audienceRaw : "ALL",
    scheduledAt: String(formData.get("scheduledAt") ?? "") || undefined,
  });
  if (!parsed.success) {
    redirect("/app/announcements?error=INVALID_INPUT" as never);
  }
  const res = await createAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      title: parsed.data.title,
      body: parsed.data.body,
      audience: parsed.data.audience as AnnouncementAudience,
      publish: formData.get("publish") === "on",
      scheduledAt: parsed.data.scheduledAt
        ? new Date(parsed.data.scheduledAt)
        : null,
    },
  );
  redirect(
    (res.ok ? "/app/announcements?ok=created" : `/app/announcements?error=${res.error}`) as never,
  );
}

export async function publishAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) redirect("/app/announcements?error=INVALID_INPUT" as never);
  const res = await publishAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  redirect(
    (res.ok ? "/app/announcements?ok=published" : `/app/announcements?error=${res.error}`) as never,
  );
}

export async function archiveAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) redirect("/app/announcements?error=INVALID_INPUT" as never);
  const res = await archiveAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  redirect(
    (res.ok ? "/app/announcements?ok=deleted" : `/app/announcements?error=${res.error}`) as never,
  );
}
