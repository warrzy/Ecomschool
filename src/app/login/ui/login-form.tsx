"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("admin@ecom-school.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        callbackUrl,
        redirect: false,
      });

      if (!res) {
        setError("Erreur de connexion");
        return;
      }

      if (res.error) {
        setError(res.error === "CredentialsSignin" ? "Identifiants invalides" : res.error);
        return;
      }

      window.location.href = res.url ?? callbackUrl;
    } catch {
      setError("Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <div className="text-xs font-semibold tracking-wide text-zinc-500">
            ECOM-TOUCH
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            ECOM-SCHOOL
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Connectez-vous à votre espace scolaire
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
              placeholder="vous@ecole.bf"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
              required
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
            className="h-11 w-full rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>

        </form>
      </div>
    </div>
  );
}
