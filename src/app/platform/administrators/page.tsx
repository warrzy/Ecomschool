import { requirePlatformPermission } from "@/lib/permissions/guard";
import { platformListAdministrators } from "@/lib/services/users";
import { statusLabel } from "@/lib/ui/statusLabels";
import { roleLabel } from "@/lib/ui/roleLabels";

export const instant = false;

export default async function PlatformAdministratorsPage() {
  await requirePlatformPermission("platform.users.manage");

  const admins = await platformListAdministrators();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Plateforme</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Administrateurs ECOM-TOUCH
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Comptes détenant un rôle <code>PLATFORM</code>. La gestion de ces
          comptes reste réservée à ECOM-TOUCH.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table aria-label="Administrateurs ECOM-TOUCH" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Email</th>
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Rôle</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {a.user.email}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {[a.user.firstName, a.user.lastName]
                      .filter(Boolean)
                      .join(" ") || "-"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{roleLabel(a.role.name)}</td>
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("user", a.user.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
