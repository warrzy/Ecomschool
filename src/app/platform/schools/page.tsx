import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { userHasPlatformPermission } from "@/lib/permissions/rbac";
import { platformListSchools } from "@/lib/services/schools";
import { setSchoolStatusAction } from "@/app/platform/schools/actions";
import type { SchoolStatus } from "@prisma/client";
import { statusLabel } from "@/lib/ui/statusLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

export default async function PlatformSchoolsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatformPermission("platform.schools.read");
  const canManage = await userHasPlatformPermission({
    userId: ctx.userId,
    permissionKey: "platform.schools.manage",
  });

  const sp = (await props.searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status =
    sp.status === "ACTIVE" || sp.status === "INACTIVE"
      ? (sp.status as SchoolStatus)
      : undefined;
  const page = Number(typeof sp.page === "string" ? sp.page : "1") || 1;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;

  const { rows: schools, total, pageSize } = await platformListSchools({
    q: q || undefined,
    status,
    page,
  });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    params.set("page", String(p));
    return `/platform/schools?${params.toString()}`;
  };

  const confirmSchool = schools.find((s) => s.id === confirmId);

  return (
    <div className="space-y-4">
      {canManage && confirm === "status" && confirmSchool ? (
        <ConfirmPanel
          title={
            confirmSchool.status === "ACTIVE"
              ? "Confirmer la suspension de l'établissement"
              : "Confirmer la réactivation de l'établissement"
          }
          tone={confirmSchool.status === "ACTIVE" ? "danger" : "warning"}
          action={setSchoolStatusAction}
          fields={{
            id: confirmSchool.id,
            status:
              confirmSchool.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
          }}
          confirmLabel={
            confirmSchool.status === "ACTIVE"
              ? "Suspendre l'établissement"
              : "Réactiver l'établissement"
          }
          cancelHref="/platform/schools"
        >
          {confirmSchool.status === "ACTIVE" ? (
            <>
              Suspendre <strong>{confirmSchool.name}</strong> (
              {confirmSchool.code}) coupe l&apos;accès de{" "}
              <strong>{confirmSchool._count.memberships} membre(s)</strong> à
              tous les espaces de l&apos;établissement. Les données sont
              conservées ; la réactivation reste possible.
            </>
          ) : (
            <>
              Réactiver <strong>{confirmSchool.name}</strong> (
              {confirmSchool.code}) rend l&apos;accès à ses{" "}
              {confirmSchool._count.memberships} membre(s).
            </>
          )}
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Référentiel</div>
            <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
              Établissements
            </h1>
          </div>
          <Link
            href="/platform/onboarding"
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Créer un établissement
          </Link>
        </div>

        <form className="mt-4 flex flex-wrap gap-2" action="/platform/schools" method="get">
          <input
            aria-label="Recherche" name="q"
            defaultValue={q}
            className="h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            placeholder="Rechercher (nom, code, ville)"
          />
          <select
                  aria-label="Tous statuts"
            name="status"
            defaultValue={status ?? ""}
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">Tous statuts</option>
            <option value="ACTIVE">ACTIF</option>
            <option value="INACTIVE">SUSPENDU</option>
          </select>
          <button className="h-11 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist">
            Filtrer
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="overflow-x-auto">
          <table aria-label="Établissements" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Code</th>
                <th scope="col" className="py-2 pr-4">Type</th>
                <th scope="col" className="py-2 pr-4">Ville</th>
                <th scope="col" className="py-2 pr-4">Membres</th>
                <th scope="col" className="py-2 pr-4">Années</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
                <th scope="col" className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    <Link href={`/platform/schools/${s.id}`} className="hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{s.code}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.type ?? "-"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.city ?? "-"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s._count.memberships}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s._count.academicYears}</td>
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("school", s.status)}</td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/platform/schools/${s.id}`}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
                      >
                        Fiche
                      </Link>
                      {canManage ? (
                        <Link
                          href={`/platform/schools?confirm=status&id=${s.id}`}
                          className={
                            s.status === "ACTIVE"
                              ? "rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                              : "rounded-lg border border-emerald-200 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50"
                          }
                        >
                          {s.status === "ACTIVE" ? "Suspendre" : "Activer"}
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {schools.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={8}>
                    {q ? "Aucun établissement ne correspond à la recherche." : "Aucun établissement enregistré."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={pageLink(p)}
                className={
                  p === page
                    ? "rounded-lg bg-brand-600 px-3 py-1 text-white"
                    : "rounded-lg border border-zinc-200 px-3 py-1 hover:bg-mist"
                }
              >
                {p}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
