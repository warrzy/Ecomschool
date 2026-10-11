"use server";

import { requireSchoolContext } from "@/lib/tenant/context";
import { setUserPreference } from "@/lib/services/comm/preferences";
import { redirect } from "next/navigation";
import type { CommTopic, MessageChannel } from "@prisma/client";

const CHANNELS: MessageChannel[] = ["EMAIL", "SMS", "WHATSAPP"];
const TOPICS: CommTopic[] = [
  "ACADEMIC",
  "FINANCE",
  "ANNOUNCEMENT",
  "OPTIONAL",
];

export async function setPreferenceAction(formData: FormData) {
  const tenant = await requireSchoolContext();
  const channel = String(formData.get("channel") ?? "") as MessageChannel;
  const topic = String(formData.get("topic") ?? "") as CommTopic;
  if (!CHANNELS.includes(channel) || !TOPICS.includes(topic)) {
    redirect("/app/preferences?error=INVALID" as never);
  }
  const res = await setUserPreference({
    userId: tenant.userId,
    channel,
    topic,
    enabled: formData.get("enabled") === "true",
    actorId: tenant.userId,
  });
  redirect(
    (res.ok
      ? "/app/preferences?ok=1"
      : `/app/preferences?error=${res.error}`) as never,
  );
}
