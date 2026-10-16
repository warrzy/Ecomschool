import Link from "next/link";
import type { SignupRequestStatus } from "@prisma/client";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { listSignupRequests } from "@/lib/services/platform/signup-requests";
import { reviewSignupRequestAction } from "@/app/platform/signup-requests/actions";
import { errorMessage } from "@/lib/ui/errorLabels";

export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente",
  CONTACTED: "Contacté",
  APPROVED: "Approuvé",
  CONVERTED: "Converti",
  REJECTED: "Rejeté",
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  CONTACTED: "bg-sky-50 text-sky-800 border-sky-200",
  APPROVED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  CONVERTED: "bg-zinc-100 text-zinc-700 border-zinc-300",
  REJECTED: "bg-red-50 text-red-800 border-red-200",
};

const FILTERS: { value: SignupRequestStatus | ""; label: string }[] = [
  { value: "", label: "Toutes" },
  { value: "PENDING", label: "En attente" },
  { value: "CONTACTED", label: "Contactées" },
  { value: "APPROVED", label: "Approuvées" },
  { value: "CONVERTED", label: "Converties" },
  { value: "REJECTED", label: "Rejetées" },
];

export default async function SignupRequestsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.schools.manage");
  const sp = (await props.searchParams) ?? {};
  const filter = (typeof sp.status === "string" ? sp.status : "") as
    | SignupRequestStatus
    | "";
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const requests = await listSignupRequests(filter || undefined);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">
              <Link href="/platform" className="hover:underline">
                Plateforme
              </Link>{" "}
              / Demandes d’inscription
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Demandes d’inscription ({requests.length})
            </div>
            <div className="mt-1 text-sm text-zinc-500">
              Demandes reçues depuis le site public. Approuver permet ensuite la
              création de l’établissement via l’onboarding.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={
                f.value
                  ? `/platform/signup-requests?status=${f.value}`
                  : "/platform/signup-requests"
              }
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                filter === f.value
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Demande mise à jour ({STATUS_LABEL[ok.toUpperCase()] ?? ok}).
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Échec : {errorMessage(error)}
          </div>
        ) : null}
      </div>

      {requests.length === 0 ? (
        <div className={`${card} text-sm text-zinc-500`}>
          Aucune demande{filter ? ` avec le statut « ${STATUS_LABEL[filter]} »` : ""}.
        </div>
      ) : (
        requests.map((r) => (
          <div key={r.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-zinc-900">
                    {r.schoolName}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.requestedPlan ? (
                    <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                      {r.requestedPlan.name}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm text-zinc-600">
                  {r.contactName} · {r.contactEmail}
                  {r.contactPhone ? ` · ${r.contactPhone}` : ""}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {[r.city, r.country].filter(Boolean).join(", ") || "—"}
                  {r.email ? ` · ${r.email}` : ""}
                  {r.phone ? ` · ${r.phone}` : ""}
                  {" · reçue le "}
                  {r.createdAt.toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </div>
                {r.note ? (
                  <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                    {r.note}
                  </div>
                ) : null}
                {r.reviewNote ? (
                  <div className="mt-2 text-xs text-zinc-500">
                    Note de revue : {r.reviewNote}
                  </div>
                ) : null}
                {r.convertedSchool ? (
                  <div className="mt-2 text-sm">
                    Établissement créé :{" "}
                    <Link
                      href={`/platform/schools/${r.convertedSchool.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {r.convertedSchool.name} ({r.convertedSchool.code})
                    </Link>
                  </div>
                ) : null}
              </div>

              {r.status !== "CONVERTED" && r.status !== "REJECTED" ? (
                <div className="flex flex-col items-end gap-2">
                  <form
                    action={reviewSignupRequestAction}
                    className="flex flex-col items-end gap-2"
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      name="note"
                      type="text"
                      placeholder="Note de revue (motif, conditions…)"
                      className="h-9 w-64 rounded-lg border border-zinc-200 px-2 text-sm outline-none focus:border-zinc-900"
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      {r.status === "PENDING" ? (
                        <button
                          type="submit"
                          name="action"
                          value="CONTACTED"
                          className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm text-sky-800 hover:bg-sky-50"
                        >
                          Marquer contacté
                        </button>
                      ) : null}
                      <button
                        type="submit"
                        name="action"
                        value="APPROVED"
                        className="rounded-lg border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        Approuver
                      </button>
                      <button
                        type="submit"
                        name="action"
                        value="REJECTED"
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                      >
                        Rejeter
                      </button>
                    </div>
                  </form>
                  {r.status === "APPROVED" ? (
                    <Link
                      href={`/platform/onboarding?from=${r.id}`}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                      Créer l’établissement →
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
