"use client";

import { useState } from "react";
import { createSchoolOnboarding } from "@/app/app/onboarding/actions";

export default function OnboardingSchoolForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    });

    setLoading(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setSuccess("Établissement créé avec succès");
    (e.target as HTMLFormElement).reset();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Onboarding</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Créer un établissement
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Nom</label>
            <input
              name="name"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Code</label>
            <input
              name="code"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm uppercase outline-none focus:border-zinc-900"
              placeholder="WEND-PANGA"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Slug</label>
            <input
              name="slug"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              placeholder="wend-panga"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Ville</label>
            <input
              name="city"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              placeholder="Ouagadougou"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Téléphone</label>
            <input
              name="phone"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Email</label>
            <input
              name="email"
              type="email"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Année</label>
            <input
              name="academicYearName"
              defaultValue="2026-2027"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Périodes</label>
            <select
              name="periodType"
              defaultValue="TRIMESTER"
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="TRIMESTER">Trimestres</option>
              <option value="SEMESTER">Semestres</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Début</label>
            <input
              name="startDate"
              type="date"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Fin</label>
            <input
              name="endDate"
              type="date"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">
              Email admin établissement
            </label>
            <input
              name="adminEmail"
              type="email"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">
              Mot de passe admin
            </label>
            <input
              name="adminPassword"
              type="password"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Prénom</label>
            <input
              name="adminFirstName"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Nom</label>
            <input
              name="adminLastName"
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              required
            />
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
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
