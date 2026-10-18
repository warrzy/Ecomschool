import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listLevels } from "@/lib/services/classes";
import { getSubject } from "@/lib/services/subjects";
import {
  removeLevelCoefficientAction,
  setLevelCoefficientAction,
  updateSubjectAction,
} from "@/app/app/(tenant)/subjects/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

export default async function SubjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("subject.read");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmLinkId = typeof sp.link === "string" ? sp.link : undefined;

  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const subject = await getSubject(ctx, id);
  if (!subject) notFound();

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "subject.manage",
  });

  const levels = await listLevels(ctx);
  const assignedLevelIds = new Set(
    subject.levelAssignments.map((l) => l.level.id),
  );
  const availableLevels = levels.filter((l) => !assignedLevelIds.has(l.id));
  const confirmLevel = subject.levelAssignments.find(
    (a) => a.id === confirmLinkId,
  );
  const selfHref = `/app/subjects/${subject.id}`;
  const activeDeps =
    subject.classAssignments.filter((a) => a.classroom.status === "ACTIVE")
      .length +
    subject.levelAssignments.filter((a) => a.level.status === "ACTIVE")
      .length;

  return (
    <div className="space-y-4">
      {canManage && confirm === "remove-coef" && confirmLevel ? (
        <ConfirmPanel
          title="Confirmer le retrait du coefficient"
          action={removeLevelCoefficientAction}
          fields={{ linkId: confirmLevel.id, subjectId: subject.id }}
          confirmLabel="Retirer le coefficient"
          cancelHref={selfHref}
        >
          Retirer la matière <strong>{subject.name}</strong> du niveau{" "}
          <strong>{confirmLevel.level.name}</strong> (coefficient{" "}
          {confirmLevel.coefficient}) la fait disparaître des calculs de
          moyennes pour ce niveau. Réversible en redéfinissant le coefficient.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Matière</div>
            <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
              {subject.name}
            </h1>
            <div className="mt-1 text-sm text-zinc-600">
              {subject.code ? `${subject.code} · ` : ""}
              {statusLabel("subject", subject.status)}
            </div>
          </div>
          <Link
            href="/app/subjects"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
          >
            Retour
          </Link>
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm font-medium text-zinc-900">Informations</div>
          <form action={updateSubjectAction} className="mt-4">
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <input type="hidden" name="id" value={subject.id} />
            <div className="grid items-end gap-4 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-subjects-id-page-tsx-1">Nom</label>
                <input id="fld-src-app-app-tenant-subjects-id-page-tsx-1"
                  name="name"
                  defaultValue={subject.name}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-subjects-id-page-tsx-2">
                  Code
                </label>
                <input id="fld-src-app-app-tenant-subjects-id-page-tsx-2"
                  name="code"
                  defaultValue={subject.code ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-subjects-id-page-tsx-3">
                  Statut
                </label>
                <select id="fld-src-app-app-tenant-subjects-id-page-tsx-3"
                  name="status"
                  defaultValue={subject.status}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
                {subject.status === "ACTIVE" && activeDeps > 0 ? (
                  <div className="mt-1 text-xs text-amber-700">
                    {activeDeps} dépendance(s) active(s) (classes ou niveaux) :
                    l&apos;archivage sera refusé.
                  </div>
                ) : null}
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm font-medium text-zinc-900">
            Coefficients par niveau
          </div>
          <div className="mt-3 overflow-x-auto">
            <table aria-label="Coefficients par niveau" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Niveau</th>
                  <th scope="col" className="py-2 pr-4">Coefficient</th>
                  {canManage ? <th scope="col" className="py-2 pr-4"></th> : null}
                </tr>
              </thead>
              <tbody>
                {subject.levelAssignments.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 text-zinc-900">{a.level.name}</td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {a.coefficient}
                    </td>
                    {canManage ? (
                      <td className="py-2 pr-4">
                        <Link
                          href={`${selfHref}?confirm=remove-coef&link=${a.id}`}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Retirer
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {subject.levelAssignments.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={3}>
                      Aucun coefficient par niveau
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={setLevelCoefficientAction} className="mt-4">
              <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
              <input type="hidden" name="subjectId" value={subject.id} />
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-subjects-id-page-tsx-4">
                    Niveau
                  </label>
                  <select id="fld-src-app-app-tenant-subjects-id-page-tsx-4"
                    name="levelId"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    {availableLevels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-28 space-y-1">
                  <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-subjects-id-page-tsx-5">
                    Coef.
                  </label>
                  <input id="fld-src-app-app-tenant-subjects-id-page-tsx-5"
                    name="coefficient"
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <button
                  type="submit"
                  className="h-10 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Définir
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm font-medium text-zinc-900">
            Affectations par classe
          </div>
          <div className="mt-3 overflow-x-auto">
            <table aria-label="Affectations par classe" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Classe</th>
                  <th scope="col" className="py-2 pr-4">Année</th>
                  <th scope="col" className="py-2 pr-4">Coef.</th>
                  <th scope="col" className="py-2 pr-4">Enseignant</th>
                </tr>
              </thead>
              <tbody>
                {subject.classAssignments.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 text-zinc-900">
                      <Link
                        href={`/app/classrooms/${a.classroom.id}?tab=subjects`}
                        className="hover:underline"
                      >
                        {a.classroom.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {a.classroom.academicYear.name}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">{a.coefficient}</td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {a.teacher
                        ? `${a.teacher.lastName} ${a.teacher.firstName}`
                        : "—"}
                    </td>
                  </tr>
                ))}
                {subject.classAssignments.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={4}>
                      Aucune affectation par classe. L&apos;affectation se fait
                      depuis la fiche classe (onglet Matières).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
