import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { listSupportSessions } from "@/lib/services/platform/support";
import { endSupportSessionAction, startSupportSessionAction } from "@/app/platform/actions";

export const instant = false;

const STATUS: Record<string, string> = {
  ACTIVE: "Active",
  ENDED: "Terminée",
  EXPIRED: "Expirée",
};

export default async function SupportPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.support.access");
  const sp = (await props.searchParams) ?? {};
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const [sessions, schools] = await Promise.all([
    listSupportSessions(),
    prisma.school.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/platform" className="hover:underline">Plateforme</Link> / Assistance
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Assistance contrôlée ({sessions.filter((s) => s.status === "ACTIVE").length} active(s))
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Chaque session est motivée, limitée dans le temps (max 72 h), journalisée et visible par l&apos;établissement.
          Aucune permission scolaire n&apos;est contournée.
        </p>
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Ouvrir une session</div>
        <form action={startSupportSessionAction} className="flex flex-wrap items-end gap-2">
          <select name="schoolId" required className={input}>
            <option value="">Établissement…</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input name="reason" placeholder="Motif obligatoire" required className={input} />
          <input name="hours" type="number" min="1" max="72" defaultValue="2" title="Durée (h)" className={input} />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
            Démarrer
          </button>
        </form>
      </div>

      <div className={card}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2">École</th>
              <th className="py-2">Agent</th>
              <th className="py-2">Motif</th>
              <th className="py-2">Début</th>
              <th className="py-2">Expiration</th>
              <th className="py-2">Statut</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{s.school.name}</td>
                <td className="py-2 text-xs">{s.agent.email}</td>
                <td className="py-2 text-xs">{s.reason}</td>
                <td className="py-2 text-xs">{s.startedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td className="py-2 text-xs">{s.expiresAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td className="py-2">{STATUS[s.status] ?? s.status}</td>
                <td className="py-2 text-right">
                  {s.status === "ACTIVE" ? (
                    <form action={endSupportSessionAction} className="inline">
                      <button name="id" value={s.id} className="text-xs text-red-700 underline">
                        Terminer
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {sessions.length === 0 ? (
              <tr><td colSpan={7} className="py-4 text-zinc-500">Aucune session d&apos;assistance.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
