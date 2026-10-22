"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getGroupContactAction,
  submitApplicationAction,
} from "@/app/candidature/actions";
import type { RequiredDoc } from "@/lib/services/admissions";

const input =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200";
const label = "block text-sm font-medium text-zinc-800";

type Child = {
  firstName: string;
  lastName: string;
  birthDate: string;
  birthPlace: string;
  sex: string;
  previousSchool: string;
  targetLevelId: string;
  targetTraining: string;
};

const emptyChild = (): Child => ({
  firstName: "",
  lastName: "",
  birthDate: "",
  birthPlace: "",
  sex: "",
  previousSchool: "",
  targetLevelId: "",
  targetTraining: "",
});

type Done = {
  fileNumbers: string[];
  trackingSecret?: string;
  reusedGroup: boolean;
};

export default function ApplicationForm(props: {
  schoolSlug: string;
  campaignId: string;
  levels: { id: string; name: string }[];
  trainingOptions: string[];
  requiredDocs: RequiredDoc[];
}) {
  const [children, setChildren] = useState<Child[]>([emptyChild()]);
  const [selfApplicant, setSelfApplicant] = useState(false);
  const [guardian, setGuardian] = useState({
    firstName: "",
    lastName: "",
    relation: "",
    phone: "",
    email: "",
    address: "",
    secondary: "",
  });
  const [groupRef, setGroupRef] = useState({ fileNumber: "", secret: "" });
  const [groupLoaded, setGroupLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  function updateChild(i: number, patch: Partial<Child>) {
    setChildren((prev) =>
      prev.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    );
  }

  async function loadGroup() {
    setError(null);
    const res = await getGroupContactAction({
      fileNumber: groupRef.fileNumber,
      secret: groupRef.secret,
    });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const g = res.result;
    setGuardian({
      firstName: g.guardianFirstName ?? "",
      lastName: g.guardianLastName ?? "",
      relation: g.guardianRelation ?? "",
      phone: g.guardianPhone ?? "",
      email: g.guardianEmail ?? "",
      address: g.guardianAddress ?? "",
      secondary: g.secondaryContact ?? "",
    });
    setGroupLoaded(true);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = e.currentTarget;
    const f = new FormData();
    f.set("campaignId", props.campaignId);
    f.set("selfApplicant", selfApplicant ? "1" : "0");
    f.set("guardianFirstName", guardian.firstName);
    f.set("guardianLastName", guardian.lastName);
    f.set("guardianRelation", guardian.relation);
    f.set("guardianPhone", guardian.phone);
    f.set("guardianEmail", guardian.email);
    f.set("guardianAddress", guardian.address);
    f.set("secondaryContact", guardian.secondary);
    f.set("website", String(new FormData(form).get("website") ?? ""));
    if (groupLoaded) {
      f.set("groupFileNumber", groupRef.fileNumber);
      f.set("groupSecret", groupRef.secret);
    }
    f.set(
      "children",
      JSON.stringify(
        children.map((c) => ({
          ...c,
          firstName: c.firstName.trim(),
          lastName: c.lastName.trim(),
        })),
      ),
    );
    children.forEach((_, i) => {
      for (const d of props.requiredDocs) {
        const file = (
          form.querySelector(
            `input[name="file_${i}_${d.key}"]`,
          ) as HTMLInputElement | null
        )?.files?.[0];
        if (file) {
          f.set(`doc_${i}_${d.key}`, file);
          f.set(`cat_${i}_${d.key}`, d.category);
        }
      }
      const extra = (
        form.querySelector(
          `input[name="file_${i}_AUTRE"]`,
        ) as HTMLInputElement | null
      )?.files?.[0];
      if (extra) {
        f.set(`doc_${i}_AUTRE`, extra);
        f.set(`cat_${i}_AUTRE`, "AUTRE");
      }
    });

    const res = await submitApplicationAction(f);
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setDone(res.result);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-3xl border border-leaf-200 bg-mint p-8"
      >
        <h2 className="font-display text-lg font-semibold text-leaf-600">
          Candidature enregistrée
        </h2>
        <p className="mt-3 text-sm text-zinc-700">
          Numéro{done.fileNumbers.length > 1 ? "s" : ""} de dossier :{" "}
          {done.fileNumbers.map((n) => (
            <span key={n} className="font-mono font-semibold">
              {n}
            </span>
          ))}
        </p>
        {done.trackingSecret ? (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              Votre code de suivi — conservez-le précieusement, il ne sera
              affiché qu&apos;une seule fois :
            </p>
            <p
              aria-label="Code de suivi"
              className="mt-2 select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-sm"
            >
              {done.trackingSecret}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-700">
            Ce dossier est rattaché à votre code de suivi existant.
          </p>
        )}
        <Link
          href={`/candidature/${props.schoolSlug}/suivi`}
          className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Suivre ma candidature
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {/* Honeypot invisible — jamais rempli par un humain. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      {/* Déjà un dossier → rattacher un autre enfant */}
      <details className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          Vous avez déjà déposé un dossier pour un autre enfant ?
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className={label}>
            Numéro de dossier
            <input
              aria-label="Numéro de dossier existant"
              value={groupRef.fileNumber}
              onChange={(e) =>
                setGroupRef({ ...groupRef, fileNumber: e.target.value })
              }
              className={`mt-1 ${input}`}
              placeholder="DOS-2026-00001"
            />
          </label>
          <label className={label}>
            Code de suivi
            <input
              aria-label="Code de suivi existant"
              value={groupRef.secret}
              onChange={(e) =>
                setGroupRef({ ...groupRef, secret: e.target.value })
              }
              className={`mt-1 ${input}`}
            />
          </label>
          <button
            type="button"
            onClick={loadGroup}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-mist"
          >
            Charger mes coordonnées
          </button>
        </div>
        {groupLoaded ? (
          <p className="mt-2 text-xs text-emerald-700">
            Coordonnées chargées — le nouveau dossier sera suivi avec le même
            code.
          </p>
        ) : null}
      </details>

      {/* Responsable */}
      <fieldset className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <legend className="px-1 text-sm font-semibold text-zinc-900">
          Responsable / déposant
        </legend>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={selfApplicant}
            onChange={(e) => {
              setSelfApplicant(e.target.checked);
              if (e.target.checked && children.length > 1) {
                setChildren([children[0]!]);
              }
            }}
          />
          Je suis le candidat (majeur) — je dépose ma propre candidature
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {!selfApplicant ? (
            <>
              <label className={label}>
                Nom du responsable *
                <input
                  aria-label="Nom du responsable"
                  required
                  value={guardian.lastName}
                  onChange={(e) =>
                    setGuardian({ ...guardian, lastName: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className={label}>
                Prénom du responsable *
                <input
                  aria-label="Prénom du responsable"
                  required
                  value={guardian.firstName}
                  onChange={(e) =>
                    setGuardian({ ...guardian, firstName: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className={label}>
                Lien avec l&apos;enfant
                <select
                  aria-label="Lien avec l'enfant"
                  value={guardian.relation}
                  onChange={(e) =>
                    setGuardian({ ...guardian, relation: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                >
                  <option value="">—</option>
                  <option value="Père">Père</option>
                  <option value="Mère">Mère</option>
                  <option value="Tuteur / Tutrice">Tuteur / Tutrice</option>
                  <option value="Autre">Autre</option>
                </select>
              </label>
            </>
          ) : null}
          <label className={label}>
            Téléphone *
            <input
              aria-label="Téléphone"
              required
              type="tel"
              value={guardian.phone}
              onChange={(e) =>
                setGuardian({ ...guardian, phone: e.target.value })
              }
              className={`mt-1 ${input}`}
              placeholder="+226 XX XX XX XX"
            />
          </label>
          <label className={label}>
            Email (facultatif)
            <input
              aria-label="Email"
              type="email"
              value={guardian.email}
              onChange={(e) =>
                setGuardian({ ...guardian, email: e.target.value })
              }
              className={`mt-1 ${input}`}
            />
          </label>
          <label className={label}>
            Adresse
            <input
              aria-label="Adresse"
              value={guardian.address}
              onChange={(e) =>
                setGuardian({ ...guardian, address: e.target.value })
              }
              className={`mt-1 ${input}`}
            />
          </label>
          <label className={label}>
            Contact secondaire (facultatif)
            <input
              aria-label="Contact secondaire"
              value={guardian.secondary}
              onChange={(e) =>
                setGuardian({ ...guardian, secondary: e.target.value })
              }
              className={`mt-1 ${input}`}
            />
          </label>
        </div>
      </fieldset>

      {/* Enfants */}
      {children.map((c, i) => (
        <fieldset
          key={i}
          className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <legend className="px-1 text-sm font-semibold text-zinc-900">
            {selfApplicant ? "Candidat" : `Enfant ${i + 1}`}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Nom *
              <input
                aria-label={`Nom enfant ${i + 1}`}
                required
                value={c.lastName}
                onChange={(e) => updateChild(i, { lastName: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className={label}>
              Prénom *
              <input
                aria-label={`Prénom enfant ${i + 1}`}
                required
                value={c.firstName}
                onChange={(e) => updateChild(i, { firstName: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className={label}>
              Date de naissance
              <input
                aria-label={`Date de naissance enfant ${i + 1}`}
                type="date"
                value={c.birthDate}
                onChange={(e) => updateChild(i, { birthDate: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className={label}>
              Lieu de naissance
              <input
                aria-label={`Lieu de naissance enfant ${i + 1}`}
                value={c.birthPlace}
                onChange={(e) => updateChild(i, { birthPlace: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className={label}>
              Sexe
              <select
                aria-label={`Sexe enfant ${i + 1}`}
                value={c.sex}
                onChange={(e) => updateChild(i, { sex: e.target.value })}
                className={`mt-1 ${input}`}
              >
                <option value="">—</option>
                <option value="MALE">Masculin</option>
                <option value="FEMALE">Féminin</option>
              </select>
            </label>
            <label className={label}>
              Établissement précédent
              <input
                aria-label={`Établissement précédent enfant ${i + 1}`}
                value={c.previousSchool}
                onChange={(e) =>
                  updateChild(i, { previousSchool: e.target.value })
                }
                className={`mt-1 ${input}`}
              />
            </label>
            {props.levels.length ? (
              <label className={label}>
                Niveau souhaité
                <select
                  aria-label={`Niveau souhaité enfant ${i + 1}`}
                  value={c.targetLevelId}
                  onChange={(e) =>
                    updateChild(i, { targetLevelId: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                >
                  <option value="">—</option>
                  {props.levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {props.trainingOptions.length ? (
              <label className={label}>
                Formation souhaitée
                <select
                  aria-label={`Formation souhaitée enfant ${i + 1}`}
                  value={c.targetTraining}
                  onChange={(e) =>
                    updateChild(i, { targetTraining: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                >
                  <option value="">—</option>
                  {props.trainingOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {/* Pièces justificatives */}
          <div className="mt-4 space-y-2">
            {props.requiredDocs.map((d) => (
              <label key={d.key} className={label}>
                {d.label}
                {d.required !== false ? " *" : " (facultatif)"}
                <input
                  aria-label={`${d.label} enfant ${i + 1}`}
                  name={`file_${i}_${d.key}`}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  required={d.required !== false}
                  className="mt-1 block w-full text-sm"
                />
              </label>
            ))}
            <label className={label}>
              Pièce complémentaire (facultatif)
              <input
                aria-label={`Pièce complémentaire enfant ${i + 1}`}
                name={`file_${i}_AUTRE`}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="mt-1 block w-full text-sm"
              />
            </label>
            <p className="text-xs text-zinc-500">
              PDF, JPEG ou PNG — 5 Mo maximum par fichier.
            </p>
          </div>

          {children.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setChildren((prev) => prev.filter((_, j) => j !== i))
              }
              className="mt-3 text-xs text-red-700 underline"
            >
              Retirer cet enfant
            </button>
          ) : null}
        </fieldset>
      ))}

      {!selfApplicant && children.length < 5 ? (
        <button
          type="button"
          onClick={() => setChildren((prev) => [...prev, emptyChild()])}
          className="rounded-xl border border-dashed border-zinc-400 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
        >
          + Ajouter un autre enfant (mêmes coordonnées)
        </button>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="h-12 w-full rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? "Envoi en cours…" : "Soumettre la candidature"}
      </button>
      <p className="text-xs text-zinc-500">
        En soumettant, vous recevrez un numéro de dossier par enfant et un
        code de suivi unique. Conservez-les : ils sont nécessaires pour
        suivre votre candidature.
      </p>
    </form>
  );
}
