import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { platformMonitoring } from "@/lib/services/platform/monitoring";
import { prisma } from "@/lib/db/prisma";

export const instant = false;

const STATUS: Record<string, string> = {
  TRIALING: "Essai",
  ACTIVE: "Actif",
  PAST_DUE: "Impayé",
  GRACE: "Grâce",
  SUSPENDED: "Suspendu",
  EXPIRED: "Expiré",
  CANCELLED: "Résilié",
};

export default async function MonitoringPage() {
  await requirePlatformPermission("platform.monitoring.read");
  const m = await platformMonitoring();
  const audit = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { createdAt: true, action: true, entity: true, schoolId: true },
  });

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/platform" className="hover:underline">Plateforme</Link> / Supervision
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Supervision technique — mesures réelles
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={card}>
          <div className="text-xs uppercase text-zinc-500">Base de données</div>
          <div className={`mt-1 text-xl font-semibold ${m.db.ok ? "text-emerald-700" : "text-red-700"}`}>
            {m.db.ok ? "Joignable" : "Injoignable"}
          </div>
          <div className="mt-1 text-xs text-zinc-500">latence mesurée : {m.db.latencyMs} ms</div>
        </div>
        <div className={card}>
          <div className="text-xs uppercase text-zinc-500">Application</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">v{m.app.version}</div>
          <div className="mt-1 text-xs text-zinc-500">uptime {Math.floor(m.app.nodeUptimeSec / 60)} min</div>
        </div>
        <div className={card}>
          <div className="text-xs uppercase text-zinc-500">Audit (24 h)</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">{m.auditLast24h}</div>
          <div className="mt-1 text-xs text-zinc-500">événements enregistrés</div>
        </div>
        <div className={card}>
          <div className="text-xs uppercase text-zinc-500">Erreurs récentes</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">{m.recentErrors.length}</div>
          <div className="mt-1 text-xs text-zinc-500">actions « error » dans le journal</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Utilisation globale</div>
          <table className="w-full text-left text-sm">
            <tbody>
              {[
                ["Établissements", `${m.usage.activeSchools} actifs / ${m.usage.schools}`],
                ["Comptes utilisateurs", m.usage.users],
                ["Élèves", m.usage.students],
                ["Inscriptions actives", m.usage.enrollments],
                ["Paiements scolaires validés", m.usage.payments],
                ["Factures SaaS", m.usage.invoices],
              ].map(([k, v]) => (
                <tr key={String(k)} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{k}</td>
                  <td className="py-2 text-right font-medium">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Abonnements par statut</div>
          <table className="w-full text-left text-sm">
            <tbody>
              {Object.entries(m.subscriptions).map(([k, v]) => (
                <tr key={k} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{STATUS[k] ?? k}</td>
                  <td className="py-2 text-right font-medium">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Migrations déployées</div>
          <ul className="space-y-1 font-mono text-xs text-zinc-700">
            {m.migrations.map((mg) => (
              <li key={mg.name}>
                {mg.finishedAt ? mg.finishedAt.toISOString().slice(0, 10) : "…"} · {mg.name}
              </li>
            ))}
          </ul>
        </div>
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Audit plateforme récent</div>
          <ul className="space-y-1 text-xs text-zinc-700">
            {audit.map((a, i) => (
              <li key={i}>
                {a.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {a.action}
                {a.entity ? ` · ${a.entity}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
