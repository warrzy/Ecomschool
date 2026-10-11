import { requirePlatformPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { jobStats, listJobs } from "@/lib/services/comm/queue";
import { listTaskRuns } from "@/lib/services/comm/automations";
import { channelsStatus } from "@/lib/services/comm/providers";
import { enqueueAutomationAction, runJobsAction } from "./actions";

export const instant = false;

const JOB_STATUS: Record<string, string> = {
  PENDING: "En attente",
  RUNNING: "En cours",
  DONE: "Terminé",
  FAILED: "Échec",
  DEAD: "Mort",
};

export default async function AutomationsPage() {
  await requirePlatformPermission("platform.monitoring.read");
  const [stats, jobs, runs, channels, deliveries, smsCost] = await Promise.all([
    jobStats(),
    listJobs({ take: 30 }),
    listTaskRuns(20),
    channelsStatus(),
    prisma.messageDelivery.groupBy({
      by: ["channel", "status"],
      _count: true,
    }),
    prisma.messageDelivery.aggregate({
      where: { channel: "SMS", status: "SENT" },
      _sum: { costUnits: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <div className="text-sm text-zinc-500">Plateforme</div>
          <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            Automatisations &amp; file de jobs
          </div>
        </div>
        <div className="flex gap-2">
          <form action={runJobsAction}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Exécuter les jobs dus
            </button>
          </form>
          <form action={enqueueAutomationAction}>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white"
            >
              Planifier le sweep SaaS
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["Jobs en attente", stats.pending],
          ["Jobs en cours", stats.running],
          ["Jobs terminés", stats.done],
          ["Jobs morts", stats.dead],
        ].map(([label, v]) => (
          <div
            key={label}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
          >
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {channels.map((c) => (
          <div
            key={c.channel}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
          >
            <div className="text-xs text-zinc-500">Canal {c.channel}</div>
            <div
              className={`mt-1 text-lg font-semibold ${c.configured ? "text-emerald-600" : "text-red-500"}`}
            >
              {c.configured ? "Configuré" : "Indisponible"}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Livraisons par canal (coût SMS cumulé :{" "}
          {smsCost._sum.costUnits ?? 0} unités)
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-zinc-600">
          {deliveries.length > 0 ? (
            deliveries.map((d, i) => (
              <span
                key={i}
                className="rounded-full border border-zinc-200 px-2 py-1"
              >
                {d.channel} / {d.status} : {d._count}
              </span>
            ))
          ) : (
            <span>Aucune livraison.</span>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Jobs récents
          </div>
          <ul className="divide-y divide-zinc-100 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex justify-between py-2">
                <span className="text-zinc-700">
                  {j.type}
                  {j.lastError ? (
                    <span className="ml-2 text-xs text-red-500">
                      {j.lastError.slice(0, 60)}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-400">
                  {JOB_STATUS[j.status]} · {j.attempts} essai
                  {j.attempts > 1 ? "s" : ""}
                </span>
              </li>
            ))}
            {jobs.length === 0 ? (
              <li className="py-2 text-zinc-500">Aucun job.</li>
            ) : null}
          </ul>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Exécutions planifiées
          </div>
          <ul className="divide-y divide-zinc-100 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex justify-between py-2">
                <span className="text-zinc-700">{r.task}</span>
                <span className="text-xs text-zinc-400">
                  {r.status} · {r.startedAt.toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
            {runs.length === 0 ? (
              <li className="py-2 text-zinc-500">Aucune exécution.</li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
