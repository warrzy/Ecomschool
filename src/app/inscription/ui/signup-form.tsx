"use client";

import { useState } from "react";
import { submitSignupRequest } from "@/app/inscription/actions";

export type SignupPlanOption = {
  code: string;
  name: string;
  monthlyPrice: number;
};

const input =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900";
const label = "text-sm font-medium text-zinc-800";

export default function SignupForm(props: {
  plans: SignupPlanOption[];
  selectedPlanCode?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const res = await submitSignupRequest({
      schoolName: String(f.get("schoolName") ?? ""),
      city: String(f.get("city") ?? "") || undefined,
      country: String(f.get("country") ?? "") || undefined,
      phone: String(f.get("phone") ?? "") || undefined,
      email: String(f.get("email") ?? "") || undefined,
      website: String(f.get("website") ?? "") || undefined,
      contactName: String(f.get("contactName") ?? ""),
      contactEmail: String(f.get("contactEmail") ?? ""),
      contactPhone: String(f.get("contactPhone") ?? "") || undefined,
      planCode: String(f.get("planCode") ?? "") || undefined,
      note: String(f.get("note") ?? "") || undefined,
      companyUrl: String(f.get("companyUrl") ?? ""),
    });

    setLoading(false);
    if (!res.ok) {
      setError(
        res.message
          ? `${res.message}${res.field ? ` (champ : ${res.field})` : ""}`
          : res.error,
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl text-white">
          ✓
        </div>
        <h2 className="mt-4 text-lg font-semibold text-emerald-900">
          Demande envoyée
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-emerald-800">
          Votre demande d&apos;inscription a bien été enregistrée. L&apos;équipe
          ECOM-TOUCH vous contactera pour confirmer les conditions commerciales
          et activer votre établissement.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <legend className="px-1 text-sm font-semibold text-zinc-900">
          Votre établissement
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="schoolName" className={label}>
              Nom de l&apos;établissement *
            </label>
            <input id="schoolName" name="schoolName" required className={input} />
          </div>
          <div className="space-y-1">
            <label htmlFor="city" className={label}>Ville</label>
            <input id="city" name="city" className={input} placeholder="Ouagadougou" />
          </div>
          <div className="space-y-1">
            <label htmlFor="country" className={label}>Pays</label>
            <input id="country" name="country" className={input} defaultValue="Burkina Faso" />
          </div>
          <div className="space-y-1">
            <label htmlFor="phone" className={label}>Téléphone</label>
            <input id="phone" name="phone" className={input} />
          </div>
          <div className="space-y-1">
            <label htmlFor="email" className={label}>Email de l&apos;établissement</label>
            <input id="email" name="email" type="email" className={input} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="website" className={label}>Site web (optionnel)</label>
            <input id="website" name="website" className={input} placeholder="https://ecole.bf" />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <legend className="px-1 text-sm font-semibold text-zinc-900">
          Responsable à contacter
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="contactName" className={label}>Nom complet *</label>
            <input id="contactName" name="contactName" required className={input} />
          </div>
          <div className="space-y-1">
            <label htmlFor="contactEmail" className={label}>Email *</label>
            <input id="contactEmail" name="contactEmail" type="email" required className={input} />
          </div>
          <div className="space-y-1">
            <label htmlFor="contactPhone" className={label}>Téléphone</label>
            <input id="contactPhone" name="contactPhone" className={input} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <legend className="px-1 text-sm font-semibold text-zinc-900">
          Formule souhaitée
        </legend>
        <div className="space-y-1">
          <label htmlFor="planCode" className={label}>Abonnement</label>
          <select
            id="planCode"
            name="planCode"
            defaultValue={props.selectedPlanCode ?? ""}
            className={input}
          >
            <option value="">À définir avec ECOM-TOUCH</option>
            {props.plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} — {p.monthlyPrice.toLocaleString("fr-FR")} F CFA/mois
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 space-y-1">
          <label htmlFor="note" className={label}>Message (optionnel)</label>
          <textarea
            id="note"
            name="note"
            rows={3}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
            placeholder="Effectifs, besoins particuliers, calendrier souhaité…"
          />
        </div>
      </fieldset>

      {/* Honeypot : invisible pour les humains, les bots le remplissent. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
        <label htmlFor="companyUrl">Ne pas remplir</label>
        <input
          id="companyUrl"
          name="companyUrl"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="h-12 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
      >
        {loading ? "Envoi en cours…" : "Envoyer ma demande"}
      </button>
      <p className="text-center text-xs text-zinc-500">
        Aucun compte n&apos;est créé à cette étape. ECOM-TOUCH vous recontacte
        pour finaliser l&apos;ouverture de votre établissement.
      </p>
    </form>
  );
}
