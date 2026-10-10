import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { platformGetSchool } from "@/lib/services/schools";
import { listAuditLogs } from "@/lib/services/audit";
import {
  createSchoolAdminAction,
  setSchoolStatusAction,
  updateSchoolAction,
} from "@/app/platform/schools/actions";

export const instant = false;

const TYPES = ["PRIMARY", "MIDDLE", "HIGH", "MIXED", "OTHER"] as const;
const SYSTEMS = ["TRIMESTER", "SEMESTER", "OTHER"] as const;

function Field({ label, name, value, type = "text", required = false }: {
  label: string;
  name: string;
  value?: string | null;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-zinc-800">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        required={required}
        className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
      />
    </div>
  );
}

export default async function PlatformSchoolDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.schools.read");

  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const school = await platformGetSchool(id);
  if (!school) redirect("/platform/schools");

  const { rows: audit } = await listAuditLogs({ schoolId: id, pageSize: 10 });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Établissement</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {school.name}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              {school.code} · {school.city ?? "-"} · {school.status}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <form action={setSchoolStatusAction}>
              <input type="hidden" name="id" value={school.id} />
              <input
                type="hidden"
                name="status"
                value={school.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
              />
              <button
                type="submit"
                className={
                  school.status === "ACTIVE"
                    ? "rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    : "rounded-lg border border-emerald-200 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50"
                }
              >
                {school.status === "ACTIVE" ? "Suspendre" : "Activer"}
              </button>
            </form>
            <Link
              href="/platform/schools"
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Retour
            </Link>
          </div>
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Membres</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">
            {school._count.memberships}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Comptes rattachés</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">
            {school._count.users}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Années scolaires</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">
            {school._count.academicYears}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Informations</div>
        <form action={updateSchoolAction} className="mt-4">
          <input type="hidden" name="id" value={school.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom" name="name" value={school.name} required />
            <Field label="Code" name="code" value={school.code} required />
            <Field label="Ville" name="city" value={school.city} />
            <Field label="Pays" name="country" value={school.country} />
            <Field label="Adresse" name="address" value={school.address} />
            <Field label="Téléphone" name="phone" value={school.phone} />
            <Field label="Email" name="email" type="email" value={school.email} />
            <Field label="Site web" name="website" type="url" value={school.website} />
            <Field label="Logo (URL)" name="logoUrl" type="url" value={school.logoUrl} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Type</label>
              <select
                name="type"
                defaultValue={school.type ?? ""}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none"
              >
                <option value="">-</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">
                Système scolaire
              </label>
              <select
                name="schoolSystem"
                defaultValue={school.schoolSystem ?? ""}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none"
              >
                <option value="">-</option>
                {SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
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
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">
          Membres ({school.memberships.length})
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Rôle</th>
                <th className="py-2 pr-4">Membership</th>
                <th className="py-2 pr-4">Compte</th>
              </tr>
            </thead>
            <tbody>
              {school.memberships.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {m.user.email}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {[m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || "-"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{m.role.name}</td>
                  <td className="py-2 pr-4 text-zinc-700">{m.status}</td>
                  <td className="py-2 pr-4 text-zinc-700">{m.user.status}</td>
                </tr>
              ))}
              {school.memberships.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={5}>
                    Aucun membre
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">
          Créer un administrateur
        </div>
        <form action={createSchoolAdminAction} className="mt-4">
          <input type="hidden" name="schoolId" value={school.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Email" name="email" type="email" required />
            <Field label="Mot de passe" name="password" type="password" required />
            <Field label="Prénom" name="firstName" required />
            <Field label="Nom" name="lastName" required />
          </div>
          <button
            type="submit"
            className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Créer l&apos;administrateur
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">
          Années scolaires ({school.academicYears.length})
        </div>
        <ul className="mt-3 space-y-1 text-sm text-zinc-700">
          {school.academicYears.map((y) => (
            <li key={y.id}>
              {y.name} · {y.status}
              {y.isCurrent ? " · courante" : ""}
            </li>
          ))}
          {school.academicYears.length === 0 ? (
            <li className="text-zinc-500">Aucune</li>
          ) : null}
        </ul>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">
          Audit récent ({audit.length})
        </div>
        <ul className="mt-3 space-y-1 text-sm text-zinc-700">
          {audit.map((a) => (
            <li key={a.id}>
              {a.createdAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
              {a.action} · {a.entity}
              {a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ""} ·{" "}
              {a.actor?.email ?? "système"}
            </li>
          ))}
          {audit.length === 0 ? (
            <li className="text-zinc-500">Aucun événement</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
