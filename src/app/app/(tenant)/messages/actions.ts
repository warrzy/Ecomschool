"use server";

import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createMessage, sendMessage } from "@/lib/services/comm/messages";
import { redirect } from "next/navigation";
import type { MessageAudience, MessageChannel } from "@prisma/client";

const AUDIENCES: MessageAudience[] = [
  "ALL_PARENTS",
  "CLASS_PARENTS",
  "GUARDIAN",
  "STUDENTS",
  "TEACHERS",
  "STAFF",
];
const CHANNELS: MessageChannel[] = ["INTERNAL", "EMAIL", "SMS", "WHATSAPP"];

export async function createMessageAction(formData: FormData) {
  const tenant = await requireSchoolPermission("messages.manage");
  const audience = String(formData.get("audience") ?? "") as MessageAudience;
  if (!AUDIENCES.includes(audience)) {
    redirect("/app/messages?error=INVALID_AUDIENCE" as never);
  }
  const channels = CHANNELS.filter((c) => formData.get(`ch_${c}`) === "on");
  const scheduledRaw = String(formData.get("scheduledAt") ?? "");
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : undefined;

  const res = await createMessage(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
      audience,
      classroomId: String(formData.get("classroomId") ?? "") || undefined,
      guardianId: String(formData.get("guardianId") ?? "") || undefined,
      channels: channels.length ? channels : ["INTERNAL"],
      topic: "OPTIONAL",
      scheduledAt,
    },
  );
  if (!res.ok) {
    redirect(`/app/messages?error=${res.error}` as never);
  }
  if (formData.get("mode") === "send") {
    await sendMessage(
      { userId: tenant.userId, schoolId: tenant.schoolId },
      res.result.id,
    );
    redirect("/app/messages?ok=sent" as never);
  }
  redirect("/app/messages?ok=created" as never);
}

export async function sendMessageAction(formData: FormData) {
  const tenant = await requireSchoolPermission("messages.manage");
  const res = await sendMessage(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    String(formData.get("id") ?? ""),
  );
  redirect(
    (res.ok ? "/app/messages?ok=sent" : `/app/messages?error=${res.error}`) as never,
  );
}
