import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getStudent } from "@/lib/services/students";
import { updateStudentAction } from "@/app/app/(tenant)/students/actions";

export const instant = false;

function PendingSection({
  title,
  module,
}: {
  title: string;
  module: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-5">
      <div className="text-sm font-medium text-zinc-800">{title}</div>
      <p className="mt-1 text-sm text-zinc-600">
        Sera disponible avec le module {module}.
      </p>
    </div>
  );
}

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("student.read");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const student = await getStudent(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!student) notFound();

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "student.manage",
  });

  const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Élève</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {student.lastName} {student.firstName}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              Matricule {student.matricule} · {student.status}
              {student.sex
                ? ` · ${student.sex === "MALE" ? "Masculin" : "Féminin"}`
                : ""}
            </div>
          </div>
          <Link
            href="/app/students"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Retour
          </Link>
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Identité</div>
        {canManage ? (
          <form action={updateStudentAction} className="mt-4">
            <input type="hidden" name="id" value={student.id} />
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Matricule
                </label>
                <input
                  name="matricule"
                  defaultValue={student.matricule}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Nom</label>
                <input
                  name="lastName"
                  defaultValue={student.lastName}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Prénom
                </label>
                <input
                  name="firstName"
                  defaultValue={student.firstName}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Sexe</label>
                <select
                  name="sex"
                  defaultValue={student.sex ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">—</option>
                  <option value="M">Masculin</option>
                  <option value="F">Féminin</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Date de naissance
                </label>
                <input
                  name="birthDate"
                  type="date"
                  defaultValue={d(student.birthDate)}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Lieu de naissance
                </label>
                <input
                  name="birthPlace"
                  defaultValue={student.birthPlace ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Téléphone
                </label>
                <input
                  name="phone"
                  defaultValue={student.phone ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  defaultValue={student.email ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Adresse
                </label>
                <input
                  name="address"
                  defaultValue={student.address ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Photo (URL)
                </label>
                <input
                  name="photoUrl"
                  type="url"
                  defaultValue={student.photoUrl ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Statut
                </label>
                <select
                  name="status"
                  defaultValue={student.status}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enregistrer
            </button>
          </form>
        ) : (
          <dl className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-zinc-500">Matricule</dt>
              <dd className="mt-1 text-sm text-zinc-900">{student.matricule}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Naissance</dt>
              <dd className="mt-1 text-sm text-zinc-900">
                {d(student.birthDate) || "—"} · {student.birthPlace ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Contact</dt>
              <dd className="mt-1 text-sm text-zinc-900">
                {student.phone ?? "—"} · {student.email ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Adresse</dt>
              <dd className="mt-1 text-sm text-zinc-900">
                {student.address ?? "—"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PendingSection
          title="Parcours scolaire / classe actuelle"
          module="Inscriptions"
        />
        <PendingSection title="Parents et tuteurs" module="Parents" />
        <PendingSection title="Notes" module="Notes" />
        <PendingSection title="Bulletins" module="Bulletins" />
        <PendingSection title="Absences et retards" module="Présences" />
        <PendingSection title="Paiements" module="Finances" />
        <PendingSection title="Documents" module="Documents" />
      </div>
    </div>
  );
}
