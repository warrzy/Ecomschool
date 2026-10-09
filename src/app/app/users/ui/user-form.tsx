"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUser, updateUser } from "@/app/app/users/actions";

type Mode = "create" | "edit";

export default function UserForm(props: {
  mode: Mode;
  initial?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    status: "ACTIVE" | "DISABLED";
  };
}) {
  const router = useRouter();
  const [email, setEmail] = useState(props.initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState(props.initial?.firstName ?? "");
  const [lastName, setLastName] = useState(props.initial?.lastName ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(
    props.initial?.status ?? "ACTIVE",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (props.mode === "create") {
        const res = await createUser({
          email,
          password,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          status,
        });

        if (!res.ok) {
          setError(res.error);
          return;
        }

        router.push("/app/users");
        router.refresh();
        return;
      }

      const res = await updateUser({
        id: props.initial!.id,
        email,
        password: password || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        status,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      router.push("/app/users");
      router.refresh();
    } catch {
      setError("UNKNOWN_ERROR");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-800">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-800">
          Mot de passe{props.mode === "edit" ? " (optionnel)" : ""}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
          required={props.mode === "create"}
          minLength={8}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800">Prénom</label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800">Nom</label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-800">Statut</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "ACTIVE" | "DISABLED")}
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
        >
          <option value="ACTIVE">ACTIF</option>
          <option value="DISABLED">DÉSACTIVÉ</option>
        </select>
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
        {loading
          ? "Enregistrement..."
          : props.mode === "create"
            ? "Créer"
            : "Mettre à jour"}
      </button>
    </form>
  );
}
