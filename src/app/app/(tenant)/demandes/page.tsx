import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  getSchoolRequest,
  listSchoolRequests,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
  REQUEST_TYPE_LABELS,
} from "@/lib/services/parent-requests";
import { respondRequestAction } from "@/app/app/(tenant)/demandes/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { AdminRequestStatus } from "@prisma/client";

export const instant = false;

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Toutes" },
  { value: "SUBMITTED", label: "Déposées" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "RESOLVED", label: "Traitées" },
  { value: "REJECTED", label: "Refusées" },
  { value: "CANCELLED", label: "Annulées" },
];

export default async function DemandesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission(
    "administrative-requests.manage",
  );
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const statusFilter = str("status") || undefined;
  const detailId = str("id");

  const [requests, detail] = await Promise.all([
    listSchoolRequests(ctx, {
      status: statusFilter as AdminRequestStatus | undefined,
    }),
    detailId ? getSchoolRequest(ctx, detailId) : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-bold">Demandes des parents</h1>
      <p className="mt-1 text-sm text-gray-600">
        Demandes administratives déposées depuis le portail parent
        (documents, justificatifs d&rsquo;absence, informations,
        rendez-vous). Le traitement est manuel — chaque réponse notifie
        le parent et est tracée dans l&rsquo;audit.
      </p>

      {ok && (
        <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">
          {okMessage(ok)}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          {errorMessage(error)}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `/app/demandes?status=${f.value}` : "/app/demandes"}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              (statusFilter ?? "") === f.value
                ? "bg-brand-600 text-white"
                : "border border-zinc-300 text-zinc-700 hover:bg-mist"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {detail && (
        <section className="mt-6 rounded border border-brand-200 bg-white p-4">
          <h2 className="font-semibold">Demande — {detail.subject}</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex flex-wrap justify-between">
              <dt className="text-gray-500">Parent</dt>
              <dd>
                {detail.guardian.lastName} {detail.guardian.firstName}
                {detail.guardian.phone ? ` — ${detail.guardian.phone}` : ""}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between">
              <dt className="text-gray-500">Type</dt>
              <dd>{REQUEST_TYPE_LABELS[detail.type]}</dd>
            </div>
            <div className="flex flex-wrap justify-between">
              <dt className="text-gray-500">Élève</dt>
              <dd>
                {detail.student
                  ? `${detail.student.lastName} ${detail.student.firstName} (${detail.student.matricule})`
                  : "—"}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between">
              <dt className="text-gray-500">Déposée le</dt>
              <dd>{detail.createdAt.toLocaleDateString("fr-FR")}</dd>
            </div>
            <div className="flex flex-wrap justify-between">
              <dt className="text-gray-500">Statut</dt>
              <dd>{REQUEST_STATUS_LABELS[detail.status]}</dd>
            </div>
          </dl>
          <p className="mt-3 whitespace-pre-line rounded bg-zinc-50 p-3 text-sm">
            {detail.body}
          </p>
          {detail.contextRef && (
            <p className="mt-2 text-xs text-gray-500">
              Référence interne : <span className="font-mono">{detail.contextRef}</span>
            </p>
          )}
          {detail.response && (
            <p className="mt-2 rounded bg-blue-50 p-3 text-sm text-blue-900">
              <span className="font-medium">Réponse envoyée :</span>{" "}
              {detail.response}
            </p>
          )}
          {(detail.status === "SUBMITTED" || detail.status === "IN_PROGRESS") && (
            <form action={respondRequestAction} className="mt-4 space-y-2">
              <input type="hidden" name="id" value={detail.id} />
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  Décision
                  <select
                    name="status"
                    required
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="IN_PROGRESS">En cours de traitement</option>
                    <option value="RESOLVED">Traitée</option>
                    <option value="REJECTED">Refusée (motif requis)</option>
                  </select>
                </label>
                <label className="min-w-64 flex-1 text-sm">
                  Réponse au parent
                  <textarea
                    name="response"
                    rows={2}
                    maxLength={4000}
                    placeholder="Obligatoire en cas de refus — transmise au parent et tracée."
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <SubmitButton>Enregistrer la réponse</SubmitButton>
              </div>
            </form>
          )}
          <p className="mt-3">
            <Link href="/app/demandes" className="text-blue-700 underline">
              ← Retour à la file
            </Link>
          </p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold">File des demandes</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-600">
              <th className="py-2">Déposée le</th>
              <th>Parent</th>
              <th>Type</th>
              <th>Objet</th>
              <th>Élève</th>
              <th>Statut</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-gray-500">
                  Aucune demande.
                </td>
              </tr>
            )}
            {requests.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2">{r.createdAt.toLocaleDateString("fr-FR")}</td>
                <td>
                  {r.guardian.lastName} {r.guardian.firstName}
                </td>
                <td>{REQUEST_TYPE_LABELS[r.type]}</td>
                <td className="max-w-56 truncate">{r.subject}</td>
                <td>
                  {r.student
                    ? `${r.student.lastName} ${r.student.firstName}`
                    : "—"}
                </td>
                <td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${REQUEST_STATUS_TONES[r.status]}`}
                  >
                    {REQUEST_STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="text-right">
                  <Link
                    href={`/app/demandes?id=${r.id}`}
                    className="text-blue-700 underline"
                  >
                    Traiter
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
