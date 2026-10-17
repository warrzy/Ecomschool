import { requireSchoolContext } from "@/lib/tenant/context";
import {
  consentHistory,
  listUserPreferences,
} from "@/lib/services/comm/preferences";
import { channelsStatus } from "@/lib/services/comm/providers";
import { setPreferenceAction } from "./actions";
import type { CommTopic, MessageChannel } from "@prisma/client";
import { errorMessage } from "@/lib/ui/errorLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const CHANNELS: { value: MessageChannel; label: string }[] = [
  { value: "EMAIL", label: "Email" },
  { value: "SMS", label: "SMS" },
  { value: "WHATSAPP", label: "WhatsApp" },
];
const TOPICS: { value: CommTopic; label: string }[] = [
  { value: "ACADEMIC", label: "Académique (bulletins, absences)" },
  { value: "FINANCE", label: "Finances (échéances, reçus)" },
  { value: "ANNOUNCEMENT", label: "Annonces" },
  { value: "OPTIONAL", label: "Informations facultatives" },
];

export default async function PreferencesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolContext();
  const sp = (await props.searchParams) ?? {};
  const prefs = await listUserPreferences(tenant.userId);
  const history = await consentHistory(tenant.userId);
  const status = channelsStatus();

  const enabled = (channel: MessageChannel, topic: CommTopic) =>
    prefs.find((p) => p.channel === channel && p.topic === topic)?.enabled ??
    true;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Préférences de communication</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Canaux facultatifs
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Les communications transactionnelles (sécurité, compte, convocations)
          sont toujours actives. Vous pouvez désactiver les autres sujets par
          canal. {sp.error ? (
            <span className="text-red-600">{typeof sp.error === "string" ? errorMessage(sp.error) : null}.</span>
          ) : null}
          {sp.ok ? <span className="text-emerald-600">Enregistré.</span> : null}
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="mb-3 flex gap-4 text-xs text-zinc-500">
          {status.map((s) => (
            <span key={s.channel}>
              {s.channel} :{" "}
              <span className={s.configured ? "text-emerald-600" : "text-zinc-500"}>
                {s.configured ? "configuré" : "indisponible"}
              </span>
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
        <table aria-label="Canaux facultatifs" className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th scope="col" className="py-2">Sujet</th>
              {CHANNELS.map((c) => (
                <th scope="col" key={c.value} className="py-2">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {TOPICS.map((t) => (
              <tr key={t.value}>
                <td className="py-2 pr-4 text-zinc-800">{t.label}</td>
                {CHANNELS.map((c) => {
                  const on = enabled(c.value, t.value);
                  return (
                    <td key={c.value} className="py-2">
                      <form action={setPreferenceAction}>
                        <input type="hidden" name="channel" value={c.value} />
                        <input type="hidden" name="topic" value={t.value} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={String(!on)}
                        />
                        <SubmitButton
                          pendingLabel="…"
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            on
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {on ? "Activé" : "Désactivé"}
                        </SubmitButton>
                      </form>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Historique des consentements
        </div>
        {history.length > 0 ? (
          <ul className="divide-y divide-zinc-100 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between py-2">
                <span className="text-zinc-700">
                  {h.action === "OPT_IN" ? "Réactivation" : "Désinscription"} —{" "}
                  {h.channel} / {h.topic}
                </span>
                <span className="text-xs text-zinc-500">
                  {h.createdAt.toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Aucun historique.</p>
        )}
      </div>
    </div>
  );
}
