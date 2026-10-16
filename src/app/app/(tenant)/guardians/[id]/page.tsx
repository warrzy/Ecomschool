import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getGuardian } from "@/lib/services/guardians";
import { prisma } from "@/lib/db/prisma";
import {
  setGuardianConsentAction,
  unlinkGuardianAction,
  updateGuardianAction,
} from "@/app/app/(tenant)/guardians/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";

export const instant = false;

const RELATIONS: Record<string, string> = {
  FATHER: "Père",
  MOTHER: "Mère",
  GUARDIAN: "Tuteur",
  FINANCIAL: "Responsable financier",
  EMERGENCY: "Contact d'urgence",
};

export default async function GuardianDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("guardian.read");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const guardian = await getGuardian(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!guardian) notFound();

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "guardian.manage",
  });
  const consent = await prisma.guardianCommConsent.findUnique({
    where: { guardianId: guardian.id },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Parent / tuteur</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {guardian.lastName} {guardian.firstName}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              {statusLabel("guardian", guardian.status)}
            </div>
          </div>
          <Link
            href="/app/guardians"
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
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">Coordonnées</div>
          {canManage ? (
            <form action={updateGuardianAction} className="mt-4 space-y-4">
              <input type="hidden" name="id" value={guardian.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Nom
                  </label>
                  <input
                    name="lastName"
                    defaultValue={guardian.lastName}
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
                    defaultValue={guardian.firstName}
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Téléphone
                  </label>
                  <input
                    name="phone"
                    defaultValue={guardian.phone ?? ""}
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
                    defaultValue={guardian.email ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium text-zinc-800">
                    Adresse
                  </label>
                  <input
                    name="address"
                    defaultValue={guardian.address ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Statut
                  </label>
                  <select
                    name="status"
                    defaultValue={guardian.status}
                    className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Enregistrer
              </button>
            </form>
          ) : (
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-zinc-500">
                  Téléphone
                </dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {guardian.phone ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Email</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {guardian.email ?? "—"}
                </dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-xs font-medium text-zinc-500">Adresse</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {guardian.address ?? "—"}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Enfants rattachés
          </div>
          {guardian.students.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucun élève rattaché. Le rattachement se fait depuis la fiche
              élève.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {guardian.students.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <Link
                      href={`/app/students/${l.student.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {l.student.lastName} {l.student.firstName}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      ({l.student.matricule}) — {RELATIONS[l.relation]}
                    </span>
                  </span>
                  {canManage ? (
                    <form action={unlinkGuardianAction}>
                      <input type="hidden" name="linkId" value={l.id} />
                      <input
                        type="hidden"
                        name="studentId"
                        value={l.student.id}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Détacher
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">
          Consentement SMS / WhatsApp
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Requis pour les envois SMS et WhatsApp vers ce tuteur (hors compte
          utilisateur). Les messages transactionnels (sécurité, convocations)
          restent autorisés sauf opposition totale.
        </p>
        {canManage ? (
          <form action={setGuardianConsentAction} className="mt-4 space-y-3 text-sm">
            <input type="hidden" name="id" value={guardian.id} />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="smsOptIn"
                defaultChecked={consent?.smsOptIn ?? false}
              />
              <span>Consentement SMS</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="whatsappOptIn"
                defaultChecked={consent?.whatsappOptIn ?? false}
              />
              <span>Consentement WhatsApp Business</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="optOutAll"
                defaultChecked={consent?.optOutAll ?? false}
              />
              <span className="text-red-700">
                Opposition à toute communication (y compris transactionnelle)
              </span>
            </label>
            <button
              type="submit"
              className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enregistrer le consentement
            </button>
          </form>
        ) : (
          <div className="mt-3 text-sm text-zinc-600">
            SMS : {consent?.smsOptIn ? "accepté" : "non consenti"} · WhatsApp :{" "}
            {consent?.whatsappOptIn ? "accepté" : "non consenti"}
            {consent?.optOutAll ? " · opposition totale" : ""}
          </div>
        )}
        {consent ? (
          <div className="mt-2 text-xs text-zinc-400">
            Mis à jour le {consent.updatedAt.toLocaleString("fr-FR")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
