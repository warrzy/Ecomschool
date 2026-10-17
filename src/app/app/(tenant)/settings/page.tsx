import { requireSchoolPermission } from "@/lib/permissions/guard";
import { getMySchool } from "@/lib/services/schools";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { updateSchoolSettingsAction } from "@/app/app/(tenant)/settings/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";

export const instant = false;

const TYPES = ["PRIMARY", "MIDDLE", "HIGH", "MIXED", "OTHER"] as const;
const SYSTEMS = ["TRIMESTER", "SEMESTER", "OTHER"] as const;

function Field({ label, name, value, type = "text" }: {
  label: string;
  name: string;
  value?: string | null;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-zinc-800" htmlFor={`fld-${name}`}>{label}</label>
      <input id={`fld-${name}`}
        name={name}
        type={name === "phone" ? "tel" : type}
        autoComplete={name === "phone" ? "tel" : undefined}
        defaultValue={value ?? ""}
        className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
      />
    </div>
  );
}

export default async function SettingsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("school.read");

  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "school.manage",
  });

  const school = await getMySchool(tenant.schoolId);
  if (!school) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Administration</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Paramètres de l&apos;établissement
        </h1>
        <div className="mt-1 text-sm text-zinc-600">
          {school.code} · {statusLabel("school", school.status)}
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Paramètres enregistrés
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <form
          action={updateSchoolSettingsAction}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom" name="name" value={school.name} />
            <Field label="Logo (URL)" name="logoUrl" type="url" value={school.logoUrl} />
            <Field label="Ville" name="city" value={school.city} />
            <Field label="Adresse" name="address" value={school.address} />
            <Field label="Téléphone" name="phone" value={school.phone} />
            <Field label="Email" name="email" type="email" value={school.email} />
            <Field label="Site web" name="website" type="url" value={school.website} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-settings-page-tsx-2">Type</label>
              <select id="fld-src-app-app-tenant-settings-page-tsx-2"
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
              <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-settings-page-tsx-3">
                Système scolaire
              </label>
              <select id="fld-src-app-app-tenant-settings-page-tsx-3"
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

          <div className="mt-4 space-y-1">
            <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-settings-page-tsx-4">
              Paramètres pédagogiques (JSON)
            </label>
            <textarea id="fld-src-app-app-tenant-settings-page-tsx-4"
              name="settings"
              rows={4}
              defaultValue={
                school.settings ? JSON.stringify(school.settings, null, 2) : ""
              }
              placeholder='{"periodesParDefaut":"TRIMESTER"}'
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            />
          </div>

          <button
            type="submit"
            className="mt-4 h-11 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            Enregistrer
          </button>
        </form>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm text-zinc-600">
            Consultation seule — la permission <code>school.manage</code> est
            requise pour modifier ces paramètres.
          </div>
        </div>
      )}
    </div>
  );
}
