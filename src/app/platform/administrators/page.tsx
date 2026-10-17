import { requirePlatformPermission } from "@/lib/permissions/guard";
import { platformListAdministrators } from "@/lib/services/users";
import { statusLabel } from "@/lib/ui/statusLabels";
import { roleLabel } from "@/lib/ui/roleLabels";
import { HelpLink, Notice, NoticeSection } from "@/components/ui/Notice";

export const instant = false;

export default async function PlatformAdministratorsPage() {
  await requirePlatformPermission("platform.users.manage");

  const admins = await platformListAdministrators();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Plateforme</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Administrateurs ECOM-TOUCH
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Comptes détenant un rôle <code>PLATFORM</code>. La gestion de ces
          comptes reste réservée à ECOM-TOUCH.
        </p>
        <div className="mt-3">
          <HelpLink>Rôles plateforme</HelpLink>
        </div>
      </div>

      <Notice title="Notice — rôles et permissions de la plateforme">
        <NoticeSection title="Deux mondes étanches">
          Les rôles <strong>plateforme</strong> (cette page) donnent accès à
          l&apos;administration ECOM-TOUCH : offres, abonnements, facturation,
          supervision, demandes d&apos;inscription. Ils ne donnent{" "}
          <strong>aucun</strong> accès aux données des établissements.
          Réciproquement, les rôles d&apos;établissement n&apos;ouvrent aucune
          page plateforme.
        </NoticeSection>
        <NoticeSection title="Rôles existants">
          <strong>Propriétaire plateforme</strong> : toutes les permissions,
          y compris la gestion des comptes administrateurs.{" "}
          <strong>Commercial plateforme</strong> : consultation des offres,
          gestion des abonnements, des factures et des paiements, gestion des
          modules — il reçoit en outre les notifications des nouvelles
          demandes d&apos;inscription (interne et, s&apos;il l&apos;active,
          WhatsApp depuis son profil).
        </NoticeSection>
        <NoticeSection title="Restrictions">
          Un compte plateforme ne peut pas être créé, modifié ni désactivé
          depuis un espace établissement, et n&apos;apparaît pas dans les
          listes d&apos;utilisateurs des écoles. Les pages plateforme exigent
          chacune une permission précise : un menu ou une action absents
          signifient que la permission n&apos;est pas détenue.
        </NoticeSection>
      </Notice>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
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
