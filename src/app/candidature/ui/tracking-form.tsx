"use client";

import { useState } from "react";
import Link from "next/link";
import {
  applicantReplyAction,
  applicantReplaceAction,
  applicantUploadAction,
  lookupTrackingAction,
  withdrawApplicationAction,
} from "@/app/candidature/actions";

const input =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "Dossier reçu",
  UNDER_REVIEW: "En cours d'instruction",
  ADDITIONAL_INFO_REQUIRED: "Complément demandé",
  WAITLISTED: "Liste d'attente",
  ACCEPTED: "Admis",
  CONDITIONALLY_ACCEPTED: "Admis sous condition",
  REJECTED: "Refusé",
  CONVERTED: "Inscription finalisée",
  WITHDRAWN: "Retiré",
};

type TrackingView = Awaited<ReturnType<typeof lookupTrackingAction>>;
type View = Extract<TrackingView, { ok: true }>["result"];

export default function TrackingForm(props: { schoolSlug: string }) {
  const [fileNumber, setFileNumber] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh(fn = fileNumber, sc = secret) {
    const res = await lookupTrackingAction({ fileNumber: fn, secret: sc });
    if (!res.ok) {
      setError(res.message);
      return false;
    }
    setView(res.result);
    return true;
  }

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    await refresh();
    setLoading(false);
  }

  async function onUpload(e: React.FormEvent<HTMLFormElement>, appId: string) {
    e.preventDefault();
    setBusy(`up-${appId}`);
    const fd = new FormData(e.currentTarget);
    fd.set("fileNumber", fileNumber);
    fd.set("secret", secret);
    fd.set("applicationId", appId);
    const res = await applicantUploadAction(fd);
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await refresh();
  }

  async function onReplace(e: React.FormEvent<HTMLFormElement>, docId: string) {
    e.preventDefault();
    setBusy(`re-${docId}`);
    const fd = new FormData(e.currentTarget);
    fd.set("fileNumber", fileNumber);
    fd.set("secret", secret);
    fd.set("documentId", docId);
    const res = await applicantReplaceAction(fd);
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await refresh();
  }

  async function onReply(e: React.FormEvent<HTMLFormElement>, appId: string) {
    e.preventDefault();
    setBusy(`rp-${appId}`);
    const fd = new FormData(e.currentTarget);
    const res = await applicantReplyAction({
      fileNumber,
      secret,
      applicationId: appId,
      body: String(fd.get("body") ?? ""),
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await refresh();
  }

  async function onWithdraw(appId: string) {
    if (!window.confirm("Retirer définitivement ce dossier ?")) return;
    setBusy(`wd-${appId}`);
    const res = await withdrawApplicationAction({
      fileNumber,
      secret,
      applicationId: appId,
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await refresh();
  }

  if (!view) {
    return (
      <form
        onSubmit={onLookup}
        className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft"
      >
        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}
        <label className="block text-sm font-medium text-zinc-800">
          Numéro de dossier
          <input
            aria-label="Numéro de dossier"
            required
            value={fileNumber}
            onChange={(e) => setFileNumber(e.target.value)}
            className={`mt-1 ${input}`}
            placeholder="DOS-2026-00001"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          Code de suivi
          <input
            aria-label="Code de suivi"
            required
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className={`mt-1 ${input}`}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? "Vérification…" : "Consulter mon dossier"}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      {view.applications.map((a) => (
        <section
          key={a.id}
          aria-label={`Dossier ${a.fileNumber}`}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-mono text-sm font-semibold">
                {a.fileNumber}
              </div>
              <div className="text-sm text-zinc-700">{a.candidate}</div>
              {a.targetLevel ? (
                <div className="text-xs text-zinc-500">
                  Niveau demandé : {a.targetLevel}
                </div>
              ) : null}
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              {STATUS_LABELS[a.status] ?? a.status}
            </span>
          </div>

          {a.status === "ADDITIONAL_INFO_REQUIRED" && a.infoRequestNote ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <span className="font-semibold">Complément demandé : </span>
              {a.infoRequestNote}
            </div>
          ) : null}

          {/* Résultat de la décision — visible par la famille */}
          {["ACCEPTED", "CONDITIONALLY_ACCEPTED", "WAITLISTED", "REJECTED", "CONVERTED"].includes(
            a.status,
          ) ? (
            <div
              className={`mt-3 rounded-xl border p-3 text-sm ${
                a.status === "ACCEPTED" || a.status === "CONVERTED"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : a.status === "CONDITIONALLY_ACCEPTED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : a.status === "WAITLISTED"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <span className="font-semibold">
                Décision : {STATUS_LABELS[a.status] ?? a.status}
              </span>
              {a.decisionReason ? ` — ${a.decisionReason}` : ""}
              {a.decisionConditions ? (
                <div className="mt-1">
                  Conditions à satisfaire : {a.decisionConditions}
                </div>
              ) : null}
              {a.status === "WAITLISTED" && a.waitlistRank ? (
                <div className="mt-1">
                  Rang en liste d&apos;attente : {a.waitlistRank}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Convocations — consignes visibles, résultats internes exclus */}
          {a.interviews.length ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Convocations
              </div>
              <ul className="mt-2 space-y-2">
                {a.interviews.map((iv) => (
                  <li
                    key={iv.id}
                    className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
                  >
                    <span className="font-medium">
                      {iv.type === "INTERVIEW"
                        ? "Entretien"
                        : iv.type === "WRITTEN_TEST"
                          ? "Test écrit"
                          : iv.type === "EVALUATION"
                            ? "Évaluation"
                            : "Convocation"}
                    </span>{" "}
                    — le {new Date(iv.scheduledAt).toLocaleString("fr-FR")}
                    {iv.location ? ` · ${iv.location}` : ""}
                    {iv.status === "CANCELLED" ? (
                      <span className="ml-2 font-semibold text-red-700">
                        Annulé
                      </span>
                    ) : null}
                    {iv.previousScheduledAt &&
                    iv.status === "PLANNED" ? (
                      <span className="ml-1 text-xs">
                        (reprogrammé — initialement le{" "}
                        {new Date(iv.previousScheduledAt).toLocaleString(
                          "fr-FR",
                        )}
                        )
                      </span>
                    ) : null}
                    {iv.instructions ? (
                      <div className="mt-1 text-xs">{iv.instructions}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Échanges avec l'établissement */}
          {a.messages.length ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Messages
              </div>
              <ul className="mt-2 space-y-1">
                {a.messages.map((m, i) => (
                  <li
                    key={i}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      m.kind === "APPLICANT_REPLY"
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-zinc-200 bg-mist/50"
                    }`}
                  >
                    <span className="text-xs text-zinc-500">
                      {new Date(m.createdAt).toISOString().slice(0, 10)} ·{" "}
                      {m.kind === "APPLICANT_REPLY" ? "Vous" : "Établissement"}
                    </span>
                    <div>{m.body}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Réponse du candidat */}
          {a.canReply ? (
            <form
              onSubmit={(e) => onReply(e, a.id)}
              className="mt-3 flex items-end gap-2"
            >
              <label className="flex-1 text-xs font-medium text-zinc-700">
                Répondre à l&apos;établissement
                <textarea
                  aria-label="Réponse à l'établissement"
                  name="body"
                  required
                  rows={2}
                  maxLength={4000}
                  placeholder="Votre réponse à la demande de complément…"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={busy === `rp-${a.id}`}
                className="h-9 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                Envoyer
              </button>
            </form>
          ) : null}

          {/* Pièces */}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase text-zinc-500">
              Pièces jointes
            </div>
            <ul className="mt-2 space-y-2">
              {a.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2 text-sm"
                >
                  <span>
                    {d.label ?? d.originalName}
                    <span className="ml-2 text-xs text-zinc-500">
                      {d.status === "ACTIVE"
                        ? `v${d.version}`
                        : d.status === "REPLACED"
                          ? "remplacée"
                          : "supprimée"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {d.ticket ? (
                      <a
                        href={`/candidature/piece/${d.ticket}`}
                        className="text-xs text-brand-700 underline"
                      >
                        Télécharger
                      </a>
                    ) : null}
                    {a.canEditDocs && d.status === "ACTIVE" ? (
                      <form
                        onSubmit={(e) => onReplace(e, d.id)}
                        className="flex items-center gap-1"
                      >
                        <input
                          aria-label={`Remplacer ${d.label ?? d.originalName}`}
                          name="file"
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          required
                          className="w-32 text-xs"
                        />
                        <button
                          type="submit"
                          disabled={busy === `re-${d.id}`}
                          className="text-xs text-brand-700 underline"
                        >
                          Remplacer
                        </button>
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
              {a.documents.length === 0 ? (
                <li className="text-xs text-zinc-500">Aucune pièce.</li>
              ) : null}
            </ul>

            {a.canEditDocs ? (
              <form
                onSubmit={(e) => onUpload(e, a.id)}
                className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-300 p-3"
              >
                <label className="text-xs font-medium text-zinc-700">
                  Ajouter une pièce
                  <input
                    aria-label="Nouvelle pièce"
                    name="file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    required
                    className="mt-1 block w-48 text-xs"
                  />
                </label>
                <label className="text-xs font-medium text-zinc-700">
                  Libellé
                  <input
                    aria-label="Libellé de la pièce"
                    name="label"
                    className="mt-1 h-8 rounded-lg border border-zinc-300 px-2 text-xs"
                    placeholder="Ex. bulletin"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy === `up-${a.id}`}
                  className="h-8 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Déposer
                </button>
              </form>
            ) : null}
          </div>

          {/* Chronologie */}
          <ol className="mt-4 space-y-1 border-l-2 border-zinc-200 pl-3">
            {a.events.map((ev, i) => (
              <li key={i} className="text-xs text-zinc-600">
                <span className="font-medium">
                  {STATUS_LABELS[ev.toStatus] ?? ev.toStatus}
                </span>{" "}
                — {new Date(ev.createdAt).toISOString().slice(0, 10)}
                {ev.note ? ` · ${ev.note}` : ""}
              </li>
            ))}
          </ol>

          {a.canWithdraw ? (
            <button
              type="button"
              onClick={() => onWithdraw(a.id)}
              disabled={busy === `wd-${a.id}`}
              className="mt-4 text-xs text-red-700 underline"
            >
              Retirer ce dossier
            </button>
          ) : null}
        </section>
      ))}

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-center text-sm shadow-soft">
        <Link
          href={`/candidature/${props.schoolSlug}`}
          className="text-brand-700 underline"
        >
          Déposer une candidature pour un autre enfant
        </Link>
      </div>
    </div>
  );
}
