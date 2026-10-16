import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { commDashboard, listMessages } from "@/lib/services/comm/messages";
import { channelsStatus } from "@/lib/services/comm/providers";
import { createMessageAction, sendMessageAction } from "./actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmé",
  SENT: "Envoyé",
  PARTIAL: "Partiel",
  FAILED: "Échec",
  CANCELLED: "Annulé",
};
const AUDIENCE_LABELS: Record<string, string> = {
  ALL_PARENTS: "Tous les parents",
  CLASS_PARENTS: "Parents d'une classe",
  GUARDIAN: "Un parent",
  STUDENTS: "Élèves",
  TEACHERS: "Enseignants",
  STAFF: "Personnel",
};

export default async function MessagesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("messages.manage");
  const sp = (await props.searchParams) ?? {};
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;
  const [messages, stats, classrooms, channels] = await Promise.all([
    listMessages(
      { userId: tenant.userId, schoolId: tenant.schoolId },
      { status: typeof sp.status === "string" ? sp.status : undefined },
    ),
    commDashboard(tenant.schoolId),
    prisma.classroom.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    channelsStatus(),
  ]);

  const confirmMessage =
    sp.confirm === "send" && confirmId
      ? messages.find((m) => m.id === confirmId)
      : undefined;

  return (
    <div className="space-y-4">
      {confirmMessage ? (
        <ConfirmPanel
          title="Confirmer l'envoi du message"
          tone="danger"
          action={sendMessageAction}
          fields={{ id: confirmMessage.id }}
          confirmLabel="Envoyer le message"
          cancelHref="/app/messages"
        >
          Envoyer <strong>« {confirmMessage.subject} »</strong> à{" "}
          <strong>
            {AUDIENCE_LABELS[confirmMessage.audience] ?? confirmMessage.audience}
          </strong>{" "}
          via {confirmMessage.channels.join(", ")}.{" "}
          <strong>Cette action est irréversible</strong> : les SMS, emails et
          messages WhatsApp partent immédiatement et ne peuvent pas être
          rappelés.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Communication</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Messagerie de l&apos;établissement
        </h1>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
          <span>{stats.messages.SENT ?? 0} envoyés</span>
          <span>{stats.messages.DRAFT ?? 0} brouillons</span>
          <span>{stats.scheduled} programmés</span>
          <span>
            {stats.deliveries
              .filter((d) => d.status === "FAILED")
              .reduce((s, d) => s + d.count, 0)}{" "}
            échecs
          </span>
          {channels.map((c) => (
            <span key={c.channel}>
              {c.channel} :{" "}
              <span
                className={c.configured ? "text-emerald-600" : "text-red-500"}
              >
                {c.configured ? "configuré" : "indisponible"}
              </span>
            </span>
          ))}
        </div>
        {sp.error ? (
          <div className="mt-2 text-sm text-red-600">{typeof sp.error === "string" ? errorMessage(sp.error) : null}</div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Nouveau message
        </div>
        <form action={createMessageAction} className="grid gap-3 md:grid-cols-2">
          <p className="col-span-full w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
          <input
            aria-label="Objet du message" name="subject"
            required
            placeholder="Objet"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <select
                  aria-label="Audience du message"
            name="audience"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            {Object.entries(AUDIENCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <textarea
            aria-label="Contenu du message" name="body"
            required
            placeholder="Contenu du message"
            rows={3}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm md:col-span-2"
          />
          <div className="grid gap-2 md:grid-cols-2 md:col-span-2">
            <label className="text-xs text-zinc-500">
              Classe (audience « parents d&apos;une classe »)
              <select
                name="classroomId"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              ID parent (audience « un parent »)
              <input
                name="guardianId"
                placeholder="ID du parent"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Programmation (optionnel, UTC)
              <input
                type="datetime-local"
                name="scheduledAt"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-zinc-700 md:col-span-2">
            <label>
              <input type="checkbox" name="ch_INTERNAL" defaultChecked /> Interne
            </label>
            <label>
              <input type="checkbox" name="ch_EMAIL" /> Email
            </label>
            <label>
              <input type="checkbox" name="ch_SMS" /> SMS
            </label>
            <label>
              <input type="checkbox" name="ch_WHATSAPP" /> WhatsApp
            </label>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <SubmitButton
              name="mode"
              value="draft"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
            >
              Enregistrer (brouillon/programmé)
            </SubmitButton>
            <SubmitButton
              name="mode"
              value="send"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Envoyer
            </SubmitButton>
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between">
          <div className="text-sm font-medium text-zinc-900">Historique</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {["", "DRAFT", "SCHEDULED", "SENT", "FAILED"].map((s) => (
              <a
                key={s}
                href={`/app/messages${s ? `?status=${s}` : ""}` as never}
                className="rounded-full border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
              >
                {s ? STATUS_LABELS[s] : "Tous"}
              </a>
            ))}
          </div>
        </div>
        {messages.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    {m.subject}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {AUDIENCE_LABELS[m.audience]} ·{" "}
                    {m.channels.join(", ")} · {m._count.deliveries} livraisons
                    {m.scheduledAt
                      ? ` · programmé ${m.scheduledAt.toLocaleString("fr-FR")}`
                      : ""}
                  </div>
                </div>
                <div className="ml-4 flex flex-wrap shrink-0 items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
                    {STATUS_LABELS[m.status] ?? m.status}
                  </span>
                  {m.status === "DRAFT" ? (
                    <a
                      href={`/app/messages?confirm=send&id=${m.id}`}
                      className="rounded-lg bg-zinc-900 px-2 py-1 text-xs text-white"
                    >
                      Envoyer
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Aucun message.</p>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Statistiques par canal
        </div>
        <div className="overflow-x-auto">
        <table aria-label="Messagerie de l&apos;établissement" className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th scope="col" className="py-1">Canal</th>
              <th scope="col" className="py-1">Statut</th>
              <th scope="col" className="py-1">Nombre</th>
              <th scope="col" className="py-1">Coût (unités)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {stats.deliveries.length > 0 ? (
              stats.deliveries.map((d, i) => (
                <tr key={`${d.channel}-${d.status}-${i}`}>
                  <td className="py-2">{d.channel}</td>
                  <td className="py-2">{statusLabel("delivery", d.status)}</td>
                  <td className="py-2">{d.count}</td>
                  <td className="py-2">{d.cost}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-3 text-sm text-zinc-500">
                  Aucune livraison enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
