import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listStudents } from "@/lib/services/students";
import { findPotentialDuplicates } from "@/lib/services/registration";
import {
  registerExistingStudentAction,
  registerNewStudentAction,
} from "@/app/app/(tenant)/fees/registration/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
const input =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200";
const label = "text-sm font-medium text-zinc-800";

export default async function RegistrationDeskPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("enrollment.read");
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" && sp[k] !== "" ? (sp[k] as string) : undefined;

  const mode = str("mode") === "new" ? "new" : "existing";
  const q = str("q");
  const yearId = str("year");
  const error = str("error");
  const dupLast = str("dupLast");
  const dupFirst = str("dupFirst");
  const dupBirth = str("dupBirth");

  const [canEnroll, canCreateStudent] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "enrollment.create",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "student.create",
    }),
  ]);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true, status: true },
  });
  const effectiveYear =
    years.find((y) => y.id === yearId) ?? years.find((y) => y.isCurrent) ?? years[0];
  const classrooms = effectiveYear
    ? await prisma.classroom.findMany({
        where: { schoolId: tenant.schoolId, academicYearId: effectiveYear.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, level: { select: { name: true } } },
      })
    : [];

  // Parcours B : recherche + état d'inscription sur l'année choisie.
  const results =
    mode === "existing"
      ? await listStudents(
          { userId: tenant.userId, schoolId: tenant.schoolId },
          { status: "ACTIVE", q, pageSize: 25 },
        )
      : null;
  const enrolledIds = new Set<string>();
  if (results && effectiveYear && results.items.length) {
    const rows = await prisma.enrollment.findMany({
      where: {
        schoolId: tenant.schoolId,
        academicYearId: effectiveYear.id,
        status: "ENROLLED",
        studentId: { in: results.items.map((s) => s.id) },
      },
      select: { studentId: true },
    });
    for (const r of rows) enrolledIds.add(r.studentId);
  }

  // Parcours A : alerte doublon (non bloquante — homonymes possibles).
  const duplicates =
    mode === "new" && dupLast && dupFirst
      ? await findPotentialDuplicates(
          { userId: tenant.userId, schoolId: tenant.schoolId },
          { lastName: dupLast, firstName: dupFirst, birthDate: dupBirth },
        )
      : [];

  const tabHref = (m: string) =>
    `/app/fees/registration?mode=${m}${effectiveYear ? `&year=${effectiveYear.id}` : ""}`;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">
            Finances
          </Link>{" "}
          / Guichet
        </div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Inscriptions & encaissements
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Accueil des familles : fiche élève, inscription annuelle, créances et
          encaissement facultatif.
        </p>
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {errorMessage(error)}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <nav className="flex gap-2" aria-label="Parcours">
            <Link
              href={tabHref("existing")}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                mode === "existing"
                  ? "bg-brand-600 text-white"
                  : "border border-zinc-200 hover:bg-mist"
              }`}
            >
              Élève existant
            </Link>
            {canCreateStudent && canEnroll ? (
              <Link
                href={tabHref("new")}
                className={`rounded-xl px-4 py-2 text-sm font-medium ${
                  mode === "new"
                    ? "bg-brand-600 text-white"
                    : "border border-zinc-200 hover:bg-mist"
                }`}
              >
                Nouvel élève
              </Link>
            ) : null}
          </nav>
          <form method="GET" className="flex items-end gap-2">
            <input type="hidden" name="mode" value={mode} />
            {mode === "existing" && q ? (
              <input type="hidden" name="q" value={q} />
            ) : null}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500" htmlFor="fld-year">
                Année scolaire
              </label>
              <select id="fld-year" name="year" defaultValue={effectiveYear?.id} className={`${input} w-48`}>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (courante)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-11 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist">
              Changer
            </button>
          </form>
        </div>
      </div>

      {mode === "existing" ? (
        <>
          <div className={card}>
            <form method="GET" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="mode" value="existing" />
              {effectiveYear ? (
                <input type="hidden" name="year" value={effectiveYear.id} />
              ) : null}
              <div className="grow space-y-1">
                <label className="text-xs font-medium text-zinc-500" htmlFor="fld-q">
                  Rechercher un élève (nom, prénom ou matricule)
                </label>
                <input
                  id="fld-q"
                  name="q"
                  type="search"
                  defaultValue={q ?? ""}
                  placeholder="Ex. Diallo, Awa ou DEMO-001"
                  className={input}
                />
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                Rechercher
              </button>
            </form>
          </div>

          <div className={card}>
            <div className="overflow-x-auto">
              <table aria-label="Élèves" className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500">
                    <th scope="col" className="py-2 pr-4">Élève</th>
                    <th scope="col" className="py-2 pr-4">Matricule</th>
                    <th scope="col" className="py-2 pr-4">
                      Inscription {effectiveYear ? `— ${effectiveYear.name}` : ""}
                    </th>
                    {canEnroll ? <th scope="col" className="py-2 pr-4">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {(results?.items ?? []).map((s) => (
                    <tr key={s.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-zinc-900">
                        {s.lastName} {s.firstName}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-zinc-600">
                        {s.matricule}
                      </td>
                      <td className="py-2 pr-4">
                        {enrolledIds.has(s.id) ? (
                          <span className="text-xs font-medium text-emerald-700">
                            {statusLabel("enrollment", "ENROLLED")}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-700">
                            Non inscrit
                          </span>
                        )}
                      </td>
                      {canEnroll ? (
                        <td className="py-2 pr-4">
                          {enrolledIds.has(s.id) ? (
                            <Link
                              href={`/app/fees/accounts/${s.id}?year=${effectiveYear!.id}`}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                            >
                              Dossier / encaisser
                            </Link>
                          ) : (
                            <form
                              action={registerExistingStudentAction}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <input type="hidden" name="studentId" value={s.id} />
                              <input
                                type="hidden"
                                name="academicYearId"
                                value={effectiveYear?.id ?? ""}
                              />
                              <select
                                aria-label="Classe"
                                name="classroomId"
                                required
                                className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
                              >
                                <option value="">Classe…</option>
                                {classrooms.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} — {c.level.name}
                                  </option>
                                ))}
                              </select>
                              <SubmitButton
                                pendingLabel="Inscription…"
                                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                              >
                                Inscrire
                              </SubmitButton>
                            </form>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {results && results.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-zinc-500">
                        {q
                          ? `Aucun élève ne correspond à « ${q} ».`
                          : "Saisissez un nom, un prénom ou un matricule pour rechercher."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {mode === "new" && canCreateStudent && canEnroll ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Nouvelle fiche élève + inscription
          </div>

          {/* Vérification des doublons — alerte non bloquante. */}
          <form method="GET" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <input type="hidden" name="mode" value="new" />
            {effectiveYear ? (
              <input type="hidden" name="year" value={effectiveYear.id} />
            ) : null}
            <input
              aria-label="Nom (doublons)"
              name="dupLast"
              defaultValue={dupLast ?? ""}
              placeholder="Nom"
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
            />
            <input
              aria-label="Prénom (doublons)"
              name="dupFirst"
              defaultValue={dupFirst ?? ""}
              placeholder="Prénom"
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
            />
            <input
              aria-label="Naissance (doublons)"
              name="dupBirth"
              type="date"
              defaultValue={dupBirth ?? ""}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
            />
            <button type="submit" className="h-9 rounded-lg border border-amber-300 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100">
              Vérifier les doublons
            </button>
            {duplicates.length > 0 ? (
              <div className="w-full text-xs text-amber-900">
                <strong>
                  {duplicates.length} fiche{duplicates.length > 1 ? "s" : ""}{" "}
                  potentiellement similaire{duplicates.length > 1 ? "s" : ""}
                </strong>{" "}
                — vérifiez avant de créer une nouvelle fiche :
                <ul className="mt-1 list-inside list-disc">
                  {duplicates.map((dd) => (
                    <li key={dd.id}>
                      <Link
                        href={`/app/fees/registration?mode=existing&q=${encodeURIComponent(dd.matricule)}&year=${effectiveYear?.id}`}
                        className="font-medium underline"
                      >
                        {dd.lastName} {dd.firstName} ({dd.matricule})
                      </Link>
                      {dd.status !== "ACTIVE" ? " — archivé" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : dupLast && dupFirst ? (
              <div className="w-full text-xs text-emerald-800">
                Aucune fiche similaire trouvée — vous pouvez créer l&apos;élève.
              </div>
            ) : null}
          </form>

          <form action={registerNewStudentAction}>
            <p className="w-full text-xs text-zinc-500">
              Les champs marqués d’un astérisque (*) sont obligatoires.
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label className={label} htmlFor="fld-mat">Matricule *</label>
                <input id="fld-mat" name="matricule" required className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-ln">Nom *</label>
                <input id="fld-ln" name="lastName" required defaultValue={dupLast ?? ""} className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-fn">Prénom *</label>
                <input id="fld-fn" name="firstName" required defaultValue={dupFirst ?? ""} className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-sex">Sexe</label>
                <select id="fld-sex" name="sex" className={input}>
                  <option value="">—</option>
                  <option value="MALE">Masculin</option>
                  <option value="FEMALE">Féminin</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-bd">Date de naissance</label>
                <input id="fld-bd" name="birthDate" type="date" defaultValue={dupBirth ?? ""} className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-bp">Lieu de naissance</label>
                <input id="fld-bp" name="birthPlace" className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-ph">Téléphone du parent</label>
                <input id="fld-ph" name="phone" className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-ad">Adresse</label>
                <input id="fld-ad" name="address" className={input} />
              </div>
              <div className="space-y-1">
                <label className={label} htmlFor="fld-cl">Classe *</label>
                <select id="fld-cl" name="classroomId" required className={input}>
                  <option value="">Choisir…</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.level.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <input type="hidden" name="academicYearId" value={effectiveYear?.id ?? ""} />
            <div className="mt-4 flex items-center gap-3">
              <SubmitButton
                pendingLabel="Inscription…"
                className="h-11 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Créer et inscrire
              </SubmitButton>
              <span className="text-xs text-zinc-500">
                Les créances applicables seront générées automatiquement ; le
                paiement reste facultatif.
              </span>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
