"use client";

import { useState } from "react";
import { createSchoolOnboarding } from "@/app/platform/onboarding/actions";

export type OnboardingDefaults = {
  name?: string;
  city?: string;
  phone?: string;
  email?: string;
};

export default function OnboardingSchoolForm(props: {
  signupRequestId?: string;
  defaults?: OnboardingDefaults;
  prospect?: {
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    planName: string | null;
  };
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [converted, setConverted] = useState<{
    schoolId: string;
    planName: string | null;
    planId: string | null;
  } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const form = new FormData(e.currentTarget);

    const res = await createSchoolOnboarding({
      name: String(form.get("name") ?? ""),
      code: String(form.get("code") ?? ""),
      slug: String(form.get("slug") ?? ""),
      city: String(form.get("city") ?? "") || undefined,
      phone: String(form.get("phone") ?? "") || undefined,
      email: String(form.get("email") ?? "") || undefined,
      website: String(form.get("website") ?? "") || undefined,
      academicYearName: String(form.get("academicYearName") ?? ""),
      startDate: String(form.get("startDate") ?? ""),
      endDate: String(form.get("endDate") ?? ""),
      periodType: (String(form.get("periodType") ?? "TRIMESTER") as
        | "TRIMESTER"
        | "SEMESTER"),
      adminEmail: String(form.get("adminEmail") ?? ""),
      adminPassword: String(form.get("adminPassword") ?? ""),
      adminFirstName: String(form.get("adminFirstName") ?? ""),
      adminLastName: String(form.get("adminLastName") ?? ""),
      signupRequestId: props.signupRequestId,
    });

    setLoading(false);

    if (!res.ok) {
      setError(
        "message" in res && res.message
          ? `${res.message}${"field" in res && res.field ? ` (champ : ${res.field})` : ""}`
          : res.error,
      );
      return;
    }

    setSuccess("Établissement créé avec succès");
    if (props.signupRequestId) {
      setConverted({
        schoolId: res.result.schoolId,
        planName: res.result.requestedPlan?.name ?? null,
        planId: res.result.requestedPlan?.id ?? null,
      });
    }
    (e.target as HTMLFormElement).reset();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Onboarding</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Créer un établissement
        </h1>
      </div>

      {props.signupRequestId ? (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-medium">
            Conversion d’une demande d’inscription approuvée — l’établissement
            créé sera automatiquement rattaché à la demande.
          </div>
          {props.prospect ? (
            <div className="mt-1 text-emerald-700">
              Contact prospect : {props.prospect.contactName} ·{" "}
              {props.prospect.contactEmail}
              {props.prospect.contactPhone
                ? ` · ${props.prospect.contactPhone}`
                : ""}
              {props.prospect.planName
                ? ` — formule demandée : ${props.prospect.planName}`
                : ""}
            </div>
          ) : null}
          <div className="mt-1 text-xs text-emerald-700">
            Les identifiants du futur administrateur sont à définir ci-dessous
            (ils peuvent différer du contact prospect).
          </div>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="school-name" className="text-sm font-medium text-zinc-800">Nom</label>
            <input
              id="school-name"
              name="name"
              defaultValue={props.defaults?.name ?? ""}
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="school-code" className="text-sm font-medium text-zinc-800">Code</label>
            <input
              id="school-code"
              name="code"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm uppercase outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              placeholder="WEND-PANGA"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="school-slug" className="text-sm font-medium text-zinc-800">Slug</label>
            <input
              id="school-slug"
              name="slug"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              placeholder="wend-panga"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="school-city" className="text-sm font-medium text-zinc-800">Ville</label>
            <input
              id="school-city"
              name="city"
              defaultValue={props.defaults?.city ?? ""}
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              placeholder="Ouagadougou"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="school-phone" className="text-sm font-medium text-zinc-800">Téléphone</label>
            <input
              id="school-phone"
              type="tel" name="phone"
              defaultValue={props.defaults?.phone ?? ""}
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="school-email" className="text-sm font-medium text-zinc-800">Email</label>
            <input
              id="school-email"
              name="email"
              defaultValue={props.defaults?.email ?? ""}
              type="email"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="academic-year" className="text-sm font-medium text-zinc-800">Année</label>
            <input
              id="academic-year"
              name="academicYearName"
              defaultValue="2026-2027"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="period-type" className="text-sm font-medium text-zinc-800">Périodes</label>
            <select
              id="period-type"
              name="periodType"
              defaultValue="TRIMESTER"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              <option value="TRIMESTER">Trimestres</option>
              <option value="SEMESTER">Semestres</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="start-date" className="text-sm font-medium text-zinc-800">Début</label>
            <input
              id="start-date"
              name="startDate"
              type="date"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="end-date" className="text-sm font-medium text-zinc-800">Fin</label>
            <input
              id="end-date"
              name="endDate"
              type="date"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-email" className="text-sm font-medium text-zinc-800">
              Email admin établissement
            </label>
            <input
              id="admin-email"
              name="adminEmail"
              type="email"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="admin-password" className="text-sm font-medium text-zinc-800">
              Mot de passe admin
            </label>
            <input
              id="admin-password"
              name="adminPassword"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="admin-first-name" className="text-sm font-medium text-zinc-800">Prénom</label>
            <input
              id="admin-first-name"
              name="adminFirstName"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="admin-last-name" className="text-sm font-medium text-zinc-800">Nom</label>
            <input
              id="admin-last-name"
              name="adminLastName"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
              required
            />
          </div>
        </div>

        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {success ? (
          <div role="status" className="mt-4 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <div>{success}</div>
            {converted ? (
              <div>
                Demande convertie.
                {converted.planName
                  ? ` Formule demandée par le prospect : ${converted.planName} — `
                  : " "}
                <a
                  href={`/platform/schools/${converted.schoolId}${converted.planId ? `?plan=${converted.planId}` : ""}`}
                  className="font-medium underline"
                >
                  attribuer l’abonnement depuis la fiche établissement
                </a>
                .
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          <button
            type="submit"
            disabled={loading}
            className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "Création..." : "Créer"}
          </button>
        </div>
      </form>
    </div>
  );
}
