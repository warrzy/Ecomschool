import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { userHasPlatformPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { platformGetSchool } from "@/lib/services/schools";
import { listAuditLogs } from "@/lib/services/audit";
import {
  getCurrentSubscription,
  listModules,
  getEntitlements,
  usageSnapshot,
} from "@/lib/services/platform/modules";
import { listPlans } from "@/lib/services/platform/plans";
import { listSchoolInvoices } from "@/lib/services/platform/billing";
import {
  assignSubscriptionAction,
  changePlanAction,
  extendTrialAction,
  renewSubscriptionAction,
  suspendSubscriptionAction,
  reactivateSubscriptionAction,
  cancelSubscriptionAction,
  setModuleOverrideAction,
  generateInvoiceAction,
} from "@/app/platform/actions";
import {
  createSchoolAdminAction,
  setSchoolStatusAction,
  updateSchoolAction,
} from "@/app/platform/schools/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const SUB_STATUS: Record<string, string> = {
  TRIALING: "Essai",
  ACTIVE: "Actif",
  PAST_DUE: "Impayé",
  GRACE: "Période de grâce",
  SUSPENDED: "Suspendu",
  EXPIRED: "Expiré",
  CANCELLED: "Résilié",
};

const INV_STATUS: Record<string, string> = {
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partielle",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

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
  const tenant = await requirePlatformPermission("platform.schools.read");

  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  // Présélection du plan demandé lors d'une conversion de demande d'inscription
  // (?plan=<id>) — l'attribution reste manuelle et confirmée par l'admin.
  const preselectPlan = typeof sp.plan === "string" ? sp.plan : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const selfHref = `/platform/schools/${id}`;

  const school = await platformGetSchool(id);
  if (!school) redirect("/platform/schools");

  const canManageSchool = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.schools.manage",
  });
  const canSubs = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.subscriptions.manage",
  });
  const canModules = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.modules.manage",
  });
  const canInvoices = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.invoices.manage",
  });

  const [
    { rows: audit },
    subscription,
    plans,
    catalog,
    entitlements,
    usage,
    invoices,
    subEvents,
    overrides,
  ] = await Promise.all([
    listAuditLogs({ schoolId: id, pageSize: 10 }),
    getCurrentSubscription(id),
    listPlans(),
    listModules(),
    getEntitlements(id),
    usageSnapshot(id),
    listSchoolInvoices(id),
    prisma.subscriptionEvent.findMany({
      where: { subscription: { schoolId: id } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.schoolModuleOverride.findMany({
      where: { schoolId: id },
      include: { module: { select: { code: true, name: true } } },
    }),
  ]);
  const overrideByCode = new Map(overrides.map((o) => [o.module.code, o.enabled]));
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      {canManageSchool && confirm === "school-status" ? (
        <ConfirmPanel
          title={
            school.status === "ACTIVE"
              ? "Confirmer la suspension de l'établissement"
              : "Confirmer la réactivation de l'établissement"
          }
          tone={school.status === "ACTIVE" ? "danger" : "warning"}
          action={setSchoolStatusAction}
          fields={{
            id: school.id,
            status: school.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
          }}
          confirmLabel={
            school.status === "ACTIVE"
              ? "Suspendre l'établissement"
              : "Réactiver l'établissement"
          }
          cancelHref={selfHref}
        >
          {school.status === "ACTIVE" ? (
            <>
              Suspendre <strong>{school.name}</strong> ({school.code}) coupe
              l&apos;accès de{" "}
              <strong>{school._count.memberships} membre(s)</strong> à tous les
              espaces de l&apos;établissement. Les données sont conservées ; la
              réactivation reste possible.
            </>
          ) : (
            <>
              Réactiver <strong>{school.name}</strong> ({school.code}) rend
              l&apos;accès à ses {school._count.memberships} membre(s).
            </>
          )}
        </ConfirmPanel>
      ) : null}
      {canSubs && confirm === "sub-suspend" && subscription ? (
        <ConfirmPanel
          title="Confirmer la suspension de l'abonnement"
          tone="danger"
          action={suspendSubscriptionAction}
          fields={{
            subscriptionId: subscription.id,
            schoolId: school.id,
            note: "Suspension manuelle ECOM-TOUCH",
          }}
          confirmLabel="Suspendre l'abonnement"
          cancelHref={selfHref}
        >
          Suspendre l&apos;abonnement <strong>{subscription.plan.name}</strong> de{" "}
          <strong>{school.name}</strong> bloque les fonctionnalités souscrites
          pour l&apos;ensemble de l&apos;établissement (les lectures restent
          possibles). Réversible via « Réactiver ».
        </ConfirmPanel>
      ) : null}
      {canSubs && confirm === "sub-cancel" && subscription ? (
        <ConfirmPanel
          title="Confirmer la résiliation de l'abonnement"
          tone="danger"
          action={cancelSubscriptionAction}
          fields={{
            subscriptionId: subscription.id,
            schoolId: school.id,
            note: "Résiliation ECOM-TOUCH",
          }}
          confirmLabel="Résilier l'abonnement"
          cancelHref={selfHref}
          requireText="RÉSILIER"
        >
          Résilier l&apos;abonnement <strong>{subscription.plan.name}</strong> de{" "}
          <strong>{school.name}</strong> met fin à la facturation et coupe
          l&apos;accès aux modules souscrits.{" "}
          <strong>Cette action est définitive</strong> : une nouvelle
          souscription serait nécessaire.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Établissement</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {school.name}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              {school.code} · {school.city ?? "-"} · {statusLabel("school", school.status)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canManageSchool ? (
              <Link
                href={`${selfHref}?confirm=school-status`}
                className={
                  school.status === "ACTIVE"
                    ? "rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    : "rounded-lg border border-emerald-200 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50"
                }
              >
                {school.status === "ACTIVE" ? "Suspendre" : "Activer"}
              </Link>
            ) : null}
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
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
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
          <SubmitButton
            className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Enregistrer
          </SubmitButton>
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
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("membership", m.status)}</td>
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("user", m.user.status)}</td>
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
          <SubmitButton
            className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Créer l&apos;administrateur
          </SubmitButton>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">
          Années scolaires ({school.academicYears.length})
        </div>
        <ul className="mt-3 space-y-1 text-sm text-zinc-700">
          {school.academicYears.map((y) => (
            <li key={y.id}>
              {y.name} · {statusLabel("academicYear", y.status)}
              {y.isCurrent ? " · courante" : ""}
            </li>
          ))}
          {school.academicYears.length === 0 ? (
            <li className="text-zinc-500">Aucune</li>
          ) : null}
        </ul>
      </div>

      {/* Abonnement SaaS */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-900">Abonnement ECOM-TOUCH</div>
            {subscription ? (
              <div className="mt-2 text-sm text-zinc-700">
                <span className="font-medium">{subscription.plan.name}</span>
                {" · "}{SUB_STATUS[subscription.status] ?? subscription.status}
                {" · "}{subscription.cycle === "YEARLY" ? "annuel" : "mensuel"}
                {" · échéance "}{subscription.currentPeriodEnd?.toISOString().slice(0, 10) ?? "—"}
                {subscription.status === "TRIALING" && subscription.trialEndsAt
                  ? ` (fin d'essai ${subscription.trialEndsAt.toISOString().slice(0, 10)})`
                  : ""}
                {subscription.status === "GRACE" && subscription.graceEndsAt
                  ? ` (grâce jusqu'au ${subscription.graceEndsAt.toISOString().slice(0, 10)})`
                  : ""}
              </div>
            ) : (
              <div className="mt-2 text-sm text-zinc-500">
                Aucun abonnement — accès complet historique.
              </div>
            )}
            <div className="mt-1 text-xs text-zinc-500">
              Usage : {usage.students} élève(s){usage.maxStudents != null ? ` / ${usage.maxStudents}` : ""}
              {" · "}{usage.users} utilisateur(s){usage.maxUsers != null ? ` / ${usage.maxUsers}` : ""}
            </div>
          </div>
          {canSubs && subscription ? (
            <div className="flex flex-wrap gap-2">
              {subscription.status === "TRIALING" ? (
                <form action={extendTrialAction} className="flex gap-1">
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <input type="hidden" name="schoolId" value={school.id} />
                  <input name="days" type="number" min="1" max="365" defaultValue="7" className={`${input} w-16`} />
                  <SubmitButton className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">+ jours essai</SubmitButton>
                </form>
              ) : null}
              {["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"].includes(subscription.status) ? (
                <>
                  <form action={renewSubscriptionAction}>
                    <input type="hidden" name="subscriptionId" value={subscription.id} />
                    <input type="hidden" name="schoolId" value={school.id} />
                    <SubmitButton className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">Renouveler</SubmitButton>
                  </form>
                  <Link
                    href={`${selfHref}?confirm=sub-suspend`}
                    className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
                  >
                    Suspendre
                  </Link>
                </>
              ) : null}
              {subscription.status === "SUSPENDED" ? (
                <form action={reactivateSubscriptionAction}>
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <input type="hidden" name="schoolId" value={school.id} />
                  <SubmitButton className="rounded-lg border border-emerald-300 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50">Réactiver</SubmitButton>
                </form>
              ) : null}
              {subscription.status !== "CANCELLED" && subscription.status !== "EXPIRED" ? (
                <Link
                  href={`${selfHref}?confirm=sub-cancel`}
                  className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                >
                  Résilier
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        {canSubs ? (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4">
            {subscription ? (
              <form action={changePlanAction} className="flex items-end gap-2">
                <input type="hidden" name="subscriptionId" value={subscription.id} />
                <input type="hidden" name="schoolId" value={school.id} />
                <select name="planId" required className={input}>
                  {plans.filter((p) => p.id !== subscription.planId).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {fmt(p.monthlyPrice)}/m</option>
                  ))}
                </select>
                <SubmitButton className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">Changer d&apos;offre</SubmitButton>
              </form>
            ) : (
              <form action={assignSubscriptionAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="schoolId" value={school.id} />
                <select
                  name="planId"
                  required
                  className={input}
                  defaultValue={
                    preselectPlan && plans.some((p) => p.id === preselectPlan)
                      ? preselectPlan
                      : ""
                  }
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {fmt(p.monthlyPrice)}/m</option>
                  ))}
                </select>
                <select name="cycle" className={input}>
                  <option value="MONTHLY">Mensuel</option>
                  <option value="YEARLY">Annuel</option>
                </select>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="startTrial" defaultChecked /> Essai
                </label>
                <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Attribuer</SubmitButton>
              </form>
            )}
          </div>
        ) : null}
      </div>

      {/* Modules effectifs */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Modules ({catalog.length})</div>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2">Module</th>
              <th className="py-2">Offre</th>
              <th className="py-2">Effectif</th>
              <th className="py-2">Override</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((m) => {
              const inPlan = entitlements.planModules?.has(m.code) ?? null;
              const enabled = entitlements.isModuleEnabled(m.code);
              const ov = overrideByCode.get(m.code);
              return (
                <tr key={m.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">
                    <span className="font-mono text-xs">{m.code}</span> {m.name}
                  </td>
                  <td className="py-2 text-xs">{inPlan === null ? "—" : inPlan ? "inclus" : "non inclus"}</td>
                  <td className={`py-2 text-xs font-medium ${enabled ? "text-emerald-700" : "text-zinc-400"}`}>
                    {enabled ? "activé" : "désactivé"}
                  </td>
                  <td className="py-2">
                    {canModules && subscription ? (
                      <form action={setModuleOverrideAction} className="flex gap-1">
                        <input type="hidden" name="schoolId" value={school.id} />
                        <input type="hidden" name="moduleCode" value={m.code} />
                        {ov === true ? (
                          <button name="enabled" value="0" className="text-xs text-red-700 underline">retirer override (+)</button>
                        ) : ov === false ? (
                          <button name="enabled" value="1" className="text-xs text-emerald-700 underline">retirer override (−)</button>
                        ) : (
                          <>
                            <button name="enabled" value="1" className="text-xs text-emerald-700 underline">activer</button>
                            <button name="enabled" value="0" className="ml-2 text-xs text-red-700 underline">bloquer</button>
                          </>
                        )}
                      </form>
                    ) : (
                      <span className="text-xs text-zinc-400">{ov === true ? "forcé" : ov === false ? "bloqué" : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Facturation SaaS */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-zinc-900">Facturation SaaS ({invoices.length})</div>
          {canInvoices ? (
            <form action={generateInvoiceAction} className="flex items-end gap-2">
              <input type="hidden" name="schoolId" value={school.id} />
              {subscription ? <input type="hidden" name="subscriptionId" value={subscription.id} /> : null}
              <select name="cycle" className={input}>
                <option value="MONTHLY">Mensuelle</option>
                <option value="YEARLY">Annuelle</option>
              </select>
              <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Générer une facture</button>
            </form>
          ) : null}
        </div>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 font-mono text-xs">
                  <Link href={`/platform/invoices/${i.id}`} className="hover:underline">{i.invoiceNumber}</Link>
                </td>
                <td className="py-2 text-xs">{i.issueDate.toISOString().slice(0, 10)}</td>
                <td className="py-2 text-right">{fmt(i.total)}</td>
                <td className="py-2 text-right">{i.balance > 0 ? `solde ${fmt(i.balance)}` : "soldée"}</td>
                <td className="py-2">{INV_STATUS[i.status] ?? i.status}</td>
                <td className="py-2 text-right text-xs">
                  <a href={`/platform/invoices/${i.id}/pdf`} className="underline">PDF</a>
                </td>
              </tr>
            ))}
            {invoices.length === 0 ? (
              <tr><td colSpan={6} className="py-3 text-zinc-500">Aucune facture SaaS.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Historique abonnement */}
      {subEvents.length > 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">Historique d&apos;abonnement</div>
          <ul className="mt-3 space-y-1 text-sm text-zinc-700">
            {subEvents.map((e) => (
              <li key={e.id}>
                {e.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {e.type}
                {e.note ? ` — ${e.note}` : ""} · {e.actorId ? e.actorId.slice(0, 8) : "système"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
