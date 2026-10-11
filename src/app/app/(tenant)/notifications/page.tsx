import { requireSchoolContext } from "@/lib/tenant/context";
import {
  listNotifications,
  markAllRead,
} from "@/lib/services/notifications";
import { redirect } from "next/navigation";

export const instant = false;

const TYPE_LABELS: Record<string, string> = {
  REPORT_CARD_PUBLISHED: "Résultats",
  ANNOUNCEMENT: "Annonce",
  ABSENCE_UNJUSTIFIED: "Absence",
  LATENESS: "Retard",
  ADMIN_MESSAGE: "Message",
};

export default async function NotificationsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolContext();
  const sp = (await props.searchParams) ?? {};
  if (sp.all === "read") {
    await markAllRead(tenant.userId);
    redirect("/app/notifications" as never);
  }

  const items = await listNotifications(tenant.userId, { take: 50 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <div className="text-sm text-zinc-500">Notifications</div>
          <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            Vos notifications ({items.filter((n) => !n.readAt).length} non lues)
          </div>
        </div>
        <a
          href="/app/notifications?all=read"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Tout marquer comme lu
        </a>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        {items.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {items.map((n) => (
              <li key={n.id} className="flex items-start justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    {!n.readAt ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500" /> : null}
                    {n.title}
                  </div>
                  {n.body ? <div className="mt-0.5 text-sm text-zinc-600">{n.body}</div> : null}
                </div>
                <div className="ml-4 shrink-0 text-xs text-zinc-400">
                  {TYPE_LABELS[n.type] ?? n.type}
                  <br />
                  {n.createdAt.toLocaleDateString("fr-FR")}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Aucune notification.</p>
        )}
      </div>
    </div>
  );
}
