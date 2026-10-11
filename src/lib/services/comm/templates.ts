import { prisma } from "@/lib/db/prisma";
import type { MessageChannel } from "@prisma/client";

/** Rendu simple {{variable}} sur les templates persistés. */
export function renderTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
}

export async function getTemplate(code: string, channel: MessageChannel = "EMAIL") {
  return prisma.messageTemplate.findFirst({
    where: { code, channel, status: "ACTIVE" },
  });
}

export async function renderByCode(
  code: string,
  vars: Record<string, string | number | null | undefined>,
  channel: MessageChannel = "EMAIL",
) {
  const t = await getTemplate(code, channel);
  if (!t) return null;
  return {
    subject: t.subject ? renderTemplate(t.subject, vars) : undefined,
    body: renderTemplate(t.body, vars),
  };
}

export async function listTemplates(channel?: MessageChannel) {
  return prisma.messageTemplate.findMany({
    where: channel ? { channel } : {},
    orderBy: { code: "asc" },
  });
}
