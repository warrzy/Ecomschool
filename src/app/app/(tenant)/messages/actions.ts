"use server";

import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createMessage, sendMessage } from "@/lib/services/comm/messages";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { MessageChannel } from "@prisma/client";
import {
  optionalDateField,
  optionalText,
  requiredText,
} from "@/lib/validations/form";

const CHANNELS: MessageChannel[] = ["INTERNAL", "EMAIL", "SMS", "WHATSAPP"];

const createSchema = z.object({
  subject: requiredText.max(200),
  body: requiredText.max(5000),
  audience: z.enum([
    "ALL_PARENTS",
    "CLASS_PARENTS",
    "GUARDIAN",
    "STUDENTS",
    "TEACHERS",
    "STAFF",
  ]),
  classroomId: optionalText,
  guardianId: optionalText,
  scheduledAt: optionalDateField,
});

export async function createMessageAction(formData: FormData) {
  const tenant = await requireSchoolPermission("messages.manage");
  const parsed = createSchema.safeParse({
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    classroomId: String(formData.get("classroomId") ?? "") || undefined,
    guardianId: String(formData.get("guardianId") ?? "") || undefined,
    scheduledAt: String(formData.get("scheduledAt") ?? "") || undefined,
  });
  if (!parsed.success) {
    redirect("/app/messages?error=INVALID_INPUT" as never);
  }
  const { audience, classroomId, guardianId, scheduledAt, subject, body } =
    parsed.data;
  const channels = CHANNELS.filter((c) => formData.get(`ch_${c}`) === "on");

  const res = await createMessage(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      subject,
      body,
      audience,
      classroomId,
      guardianId,
      channels: channels.length ? channels : ["INTERNAL"],
      topic: "OPTIONAL",
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    },
  );
  if (!res.ok) {
    redirect(`/app/messages?error=${res.error}` as never);
  }
  if (formData.get("mode") === "send") {
    // Le brouillon est créé ; l'envoi effectif passe par le panneau de
    // confirmation qui nomme le message, l'audience et les canaux.
    redirect(`/app/messages?confirm=send&id=${res.result.id}` as never);
  }
  redirect("/app/messages?ok=created" as never);
}

export async function sendMessageAction(formData: FormData) {
  const tenant = await requireSchoolPermission("messages.manage");
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) redirect("/app/messages?error=INVALID_INPUT" as never);
  const res = await sendMessage(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id.data,
  );
  redirect(
    (res.ok ? "/app/messages?ok=sent" : `/app/messages?error=${res.error}`) as never,
  );
}
