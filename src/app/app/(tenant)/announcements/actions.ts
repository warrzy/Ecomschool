"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  archiveAnnouncement,
  createAnnouncement,
  publishAnnouncement,
} from "@/lib/services/announcements";
import type { AnnouncementAudience } from "@prisma/client";

const AUDIENCES = ["ALL", "PARENTS", "STUDENTS", "TEACHERS"];

export async function createAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const audienceRaw = String(formData.get("audience") ?? "ALL");
  const audience = (AUDIENCES.includes(audienceRaw) ? audienceRaw : "ALL") as AnnouncementAudience;
  const res = await createAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      audience,
      publish: formData.get("publish") === "on",
      scheduledAt: String(formData.get("scheduledAt") ?? "")
        ? new Date(String(formData.get("scheduledAt")))
        : null,
    },
  );
  redirect(
    (res.ok ? "/app/announcements?ok=created" : `/app/announcements?error=${res.error}`) as never,
  );
}

export async function publishAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const res = await publishAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    String(formData.get("id") ?? ""),
  );
  redirect(
    (res.ok ? "/app/announcements?ok=published" : `/app/announcements?error=${res.error}`) as never,
  );
}

export async function archiveAnnouncementAction(formData: FormData) {
  const tenant = await requireSchoolPermission("announcements.manage");
  const res = await archiveAnnouncement(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    String(formData.get("id") ?? ""),
  );
  redirect(
    (res.ok ? "/app/announcements?ok=deleted" : `/app/announcements?error=${res.error}`) as never,
  );
}
