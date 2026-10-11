import { requireSchoolContext } from "@/lib/tenant/context";
import {
  listNotifications,
  markAllRead,
  markNotificationRead,
  unreadCount,
} from "@/lib/services/notifications";
import { redirect } from "next/navigation";
import type { NotificationType } from "@prisma/client";

export const instant = false;

const TYPE_LABELS: Record<string, string> = {
  REPORT_CARD_PUBLISHED: "Résultats",
  ANNOUNCEMENT: "Annonce",
  ABSENCE_UNJUSTIFIED: "Absence",
  LATENESS: "Retard",
  ADMIN_MESSAGE: "Message",
  FINANCE_REMINDER: "Finances",
};

const TYPE_FILTERS = [
  { value: "", label: "Tous" },
  { value: "ADMIN_MESSAGE", label: "Messages" },
  { value: "ANNOUNCEMENT", label: "Annonces" },
  { value: "ABSENCE_UNJUSTIFIED", label: "Absences" },
  { value: "FINANCE_REMINDER", label: "Finances" },
  { value: "REPORT_CARD_PUBLISHED", label: "Résultats" },
];

export default async function NotificationsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolContext();
  const sp = (await props.searchParams) ?? {};
  if (sp.all === "read") {
    await markAllRead(tenant.userId);
    redirect("/app/notifications" as never);
  }
  if (sp.read) {
    await markNotificationRead(tenant.userId, String(sp.read));
    const type = sp.type ? `?type=${sp.type}` : "";
    redirect(`/app/notifications${type}` as never);
  }

  const typeFilter = typeof sp.type === "string" && sp.type ? sp.type : undefined;
  const items = await listNotifications(tenant.userId, {
    take: 50,
    unreadOnly: sp.unread === "1",
    type: typeFilter as NotificationType | undefined,
  });
  const unread = await unreadCount(tenant.userId);

  const base = "/app/notifications";
  const q = (p: Record<string, string>) => {
    const s = new URLSearchParams(p).toString();
    return `${base}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <div className="text-sm text-zinc-500">Centre de notifications</div>
          <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            {unread} non lue{unread > 1 ? "s" : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href={"/app/preferences" as never}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Préférences
          </a>
          <a
            href={q({ all: "read" }) as never}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Tout marquer comme lu
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        {TYPE_FILTERS.map((f) => (
          <a
            key={f.value}
            href={
              q({
                ...(f.value ? { type: f.value } : {}),
                ...(sp.unread === "1" ? { unread: "1" } : {}),
              }) as never
            }
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              (typeFilter ?? "") === f.value
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {f.label}
          </a>
        ))}
        <a
          href={
            q({
              ...(typeFilter ? { type: typeFilter } : {}),
              ...(sp.unread === "1" ? {} : { unread: "1" }),
            }) as never
          }
          className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
            sp.unread === "1"
              ? "bg-amber-600 text-white"
              : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          Non lues
        </a>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        {items.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {items.map((n) => (
              <li key={n.id} className="flex items-start justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    {!n.readAt ? (
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
                    ) : null}
                    {n.title}
                  </div>
                  {n.body ? (
                    <div className="mt-0.5 text-sm text-zinc-600">{n.body}</div>
                  ) : null}
                  {n.link ? (
                    <a
                      href={n.link as never}
                      className="mt-0.5 inline-block text-xs text-zinc-500 underline"
                    >
                      Ouvrir
                    </a>
                  ) : null}
                </div>
                <div className="ml-4 shrink-0 text-right text-xs text-zinc-400">
                  {TYPE_LABELS[n.type] ?? n.type}
                  <br />
                  {n.createdAt.toLocaleDateString("fr-FR")}
                  {!n.readAt ? (
                    <>
                      <br />
                      <a
                        href={
                          q({
                            read: n.id,
                            ...(typeFilter ? { type: typeFilter } : {}),
                          }) as never
                        }
                        className="text-zinc-600 underline"
                      >
                        Marquer lu
                      </a>
                    </>
                  ) : null}
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
